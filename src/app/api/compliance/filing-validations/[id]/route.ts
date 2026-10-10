import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { findFilingForm, parseFilingOutcome } from "@/lib/filing-evidence";
import { getFilingValidation, recordFilingOutcome } from "@/lib/filing-evidence-store";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

/**
 * Records the agency's answer for a filing record: accepted (with the agency's
 * own reference) or rejected (with what was wrong). An accepted record is what
 * lets readiness call a filing validated, so it needs a recent MFA check like
 * other sensitive payroll actions, and it can be recorded only once.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid record id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Recording government filing evidence");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage government filing evidence.",
  );
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const parsed = parseFilingOutcome(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const existing = await getFilingValidation(organizationId, id);
  if (!existing) return Response.json({ error: "Filing record not found." }, { status: 404 });
  if (existing.status !== "generated") {
    return Response.json({
      error: `This record is already ${existing.status} and cannot be changed. Generate a new record to file again.`,
    }, { status: 409 });
  }

  const definition = findFilingForm(existing.agency, existing.form);
  if (!definition) {
    return Response.json({ error: "This filing form is no longer supported." }, { status: 409 });
  }
  if (existing.agency === "BIR" && existing.form === "1604-C" && parsed.value.outcome === "accepted") {
    return Response.json({
      error: "This historical BIR 1604-C source CSV is not an official DAT and cannot establish current BIR filing acceptance. Use the annual BIR source preflight and retain the official ADES/file-submission acknowledgement separately.",
    }, { status: 409 });
  }
  if (!definition.submissionMethods.includes(parsed.value.submissionMethod)) {
    return Response.json({
      error: `${existing.agency} ${existing.form} does not accept "${parsed.value.submissionMethod}" as evidence in PayrollPH.`,
    }, { status: 400 });
  }

  const record = await recordFilingOutcome({ organizationId, id, actor: user.name, outcome: parsed.value });
  // Lost a race with another person recording the same record.
  if (!record) {
    return Response.json({ error: "This record was already resolved by someone else." }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: `${record.agency} ${record.form} filing ${record.status}`,
    resource: record.periodLabel,
    metadata: {
      recordId: record.id,
      runId: record.payrollRunId,
      fileSha256: record.fileSha256,
      submissionMethod: record.submissionMethod,
      agencyReference: record.agencyReference,
      submittedAt: record.submittedAt?.toISOString() ?? null,
    },
  });

  return Response.json({ record });
}
