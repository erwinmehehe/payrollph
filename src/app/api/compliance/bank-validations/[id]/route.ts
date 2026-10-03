import {
  assertOrganizationRole,
  PAYROLL_DISBURSEMENT_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import {
  getBankFileValidation,
  parseBankPortalOutcome,
  recordBankPortalOutcome,
} from "@/lib/bank-evidence-store";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Recording bank portal validation evidence");
  if (demoDenied) return demoDenied;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid bank validation id." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_DISBURSEMENT_ROLES,
    "Only the workspace owner can record bank portal acceptance evidence.",
  );
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "bank-validation-outcome",
    resourceId: id,
    limit: 8,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const existing = await getBankFileValidation(organizationId, id);
  if (!existing) return Response.json({ error: "Bank validation record not found." }, { status: 404 });
  if (existing.status !== "generated") {
    return Response.json({
      error: `This bank validation is already ${existing.status} and is immutable. Generate a new file record for another portal test.`,
    }, { status: 409 });
  }

  const parsed = parseBankPortalOutcome(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const record = await recordBankPortalOutcome({
    organizationId,
    id,
    actor: user.name,
    outcome: parsed.value,
  });
  if (!record) {
    return Response.json({
      error: "This bank validation was already resolved by another user.",
    }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: `Bank validation file ${record.status}`,
    resource: record.templateName,
    metadata: {
      recordId: record.id,
      runId: record.payrollRunId,
      templateName: record.templateName,
      templateVersion: record.templateVersion,
      fileSha256: record.fileSha256,
      portalReference: record.portalReference,
      submittedAt: record.submittedAt?.toISOString() ?? null,
    },
  });

  return Response.json({ record });
}
