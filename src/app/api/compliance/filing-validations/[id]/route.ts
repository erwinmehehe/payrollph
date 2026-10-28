import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, assertOrganizationUnitAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
// The filing outcome and immutable audit receipt must commit together.
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { findFilingForm, parseFilingOutcome } from "@/lib/filing-evidence";
import { getFilingValidation, recordFilingOutcome } from "@/lib/filing-evidence-store";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";

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
  const scope = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!scope.ok) return scope.response;
  const entityDenied = assertEntityResource(scope.context, existing.legalEntityId);
  if (entityDenied) return entityDenied;
  if (existing.status !== "generated") {
    return Response.json({
      error: `This record is already ${existing.status} and cannot be changed. Generate a new record to file again.`,
    }, { status: 409 });
  }
  if (!existing.payrollRunId) {
    return Response.json({ error: "A filing outcome requires a linked payroll run." }, { status: 409 });
  }
  const [run] = await db.select({ scopeOrgUnitId: payrollRuns.scopeOrgUnitId })
    .from(payrollRuns).where(and(
      eq(payrollRuns.id, existing.payrollRunId),
      eq(payrollRuns.organizationId, organizationId),
    )).limit(1);
  if (!run) return Response.json({ error: "Linked payroll run not found." }, { status: 409 });
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id, organizationId, run.scopeOrgUnitId,
    "This filing belongs to a payroll run outside your authorized organization unit.",
  );
  if (scopeDenied) return scopeDenied;


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

  let record;
  try {
    // The status transition and its actor-bound audit receipt must succeed or
    // roll back together. A rejected audit insert must not leave a filing
    // decision committed without the evidence of who recorded it.
    record = await db.transaction(async (tx) => {
      const updated = await recordFilingOutcome({ organizationId, id, actor: user.name, outcome: parsed.value }, tx);
      if (!updated) return null;
      await tx.insert(auditEvents).values({
        organizationId,
        actor: user.name,
        action: `${updated.agency} ${updated.form} filing ${updated.status}`,
        resource: updated.periodLabel,
        metadata: {
          recordId: updated.id,
          runId: updated.payrollRunId,
          fileSha256: updated.fileSha256,
          submissionMethod: updated.submissionMethod,
          agencyReference: updated.agencyReference,
          submittedAt: updated.submittedAt?.toISOString() ?? null,
        },
      });
      return updated;
    });
  } catch {
    // Do not reveal SQL or sensitive filing metadata on failed audit or source
    // validation. Transaction rollback preserves the original filing state.
    return Response.json({
      error: "Filing acceptance could not be verified against the released source. Refresh and regenerate the filing evidence before retrying.",
    }, { status: 409 });
  }
  if (!record) {
    return Response.json({ error: "This record was already resolved by someone else." }, { status: 409 });
  }

  return Response.json({ record });
}
