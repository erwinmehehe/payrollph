import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { authorizeAssignedTreasuryOperator } from "@/lib/treasury-controls";
import { decidePayoutDestinationChange } from "@/lib/payout-destination-controls";
import { maskBankAccount } from "@/lib/bank-account-crypto";
import { runAutomationEventSafely } from "@/lib/automation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Payout destination dual control");
  if (demoDenied) return demoDenied;

  const { id } = await params;
  const requestId = Number(id);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;

  if (!Number.isInteger(requestId) || !Number.isInteger(organizationId) || !decision) {
    return Response.json({ error: "A valid request, organization and decision are required." }, { status: 400 });
  }

  const treasuryDenied = await authorizeAssignedTreasuryOperator({
    organizationId,
    userId: user.id,
  });
  if (treasuryDenied) return treasuryDenied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `payout-destination-${decision}`,
    resourceId: requestId,
    limit: 12,
    windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const outcome = await decidePayoutDestinationChange({
    organizationId,
    requestId,
    decidedByUserId: user.id,
    decidedByName: user.name,
    decision,
    decisionNote: String(body.decisionNote ?? "").trim() || null,
  });

  if (outcome.kind === "not_found") {
    return Response.json({ error: "Payout destination change request not found." }, { status: 404 });
  }
  if (outcome.kind === "forbidden") {
    return Response.json({ error: outcome.message }, { status: 403 });
  }
  if (outcome.kind === "conflict") {
    return Response.json({ error: outcome.message }, { status: 409 });
  }
  if (outcome.kind === "stale") {
    return Response.json({
      error: "The employee payout destination changed after this request was created. The stale request was cancelled; create a new request from the current state.",
      request: outcome.request,
    }, { status: 409 });
  }

  let automation: unknown[] = [];
  if (outcome.kind === "approved") {
    automation = await runAutomationEventSafely({
      organizationId,
      employeeId: outcome.employee.id,
      trigger: "employee.updated",
      eventKey: `payout-destination-approved:${requestId}`,
      context: {
        orgUnitId: outcome.employee.orgUnitId,
        employmentType: outcome.employee.employmentType,
        title: outcome.employee.title,
        changedFields: ["bankAccount", "bankCode", "mobile"],
        payoutDestinationChangeRequestId: requestId,
        approvedByUserId: user.id,
      },
    });
  }

  return Response.json({
    decision: outcome.kind,
    request: outcome.request,
    employee: outcome.kind === "approved"
      ? { ...outcome.employee, bankAccount: maskBankAccount(outcome.employee.bankAccount) }
      : undefined,
    automation,
  });
}
