import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { assertOrganizationRole, assertOrganizationUnitAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { FILING_FORMS, findFilingForm } from "@/lib/filing-evidence";
import { resolveComplianceLegalEntity } from "@/lib/legal-entity";
import { listFilingValidations, recordGeneratedFiling } from "@/lib/filing-evidence-store";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const DENIED = "Only People or payroll administrators can manage government filing evidence.";

/** Records for one workspace, newest first, plus the forms Linaw can track. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const requestedLegalEntityId = Number(url.searchParams.get("legalEntityId") ?? 0);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES, DENIED);
  if (denied) return denied;

  try {
    const legalEntity = await resolveComplianceLegalEntity({
      organizationId,
      legalEntityId: requestedLegalEntityId || null,
    });
    return Response.json({
      forms: FILING_FORMS,
      legalEntity: { id: legalEntity.id, code: legalEntity.code, displayName: legalEntity.displayName },
      records: await listFilingValidations(organizationId, legalEntity.id),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Legal employer could not be resolved." }, { status: 409 });
  }
}

/**
 * Generates the filing file for a payroll run and records it by hash. Nothing
 * is submitted anywhere: the person downloads the file from the record, submits
 * it to the agency themselves, then records the agency's answer.
 */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Recording government filing evidence");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const runId = Number(body.runId);
  if (!Number.isInteger(organizationId) || organizationId <= 0 || !Number.isInteger(runId) || runId <= 0) {
    return Response.json({ error: "organizationId and runId are required." }, { status: 400 });
  }

  const definition = findFilingForm(body.agency, body.form);
  if (!definition) {
    return Response.json({
      error: "Unsupported filing. Linaw tracks evidence only for the forms listed by GET.",
      supported: FILING_FORMS.map((item) => ({ agency: item.agency, form: item.form })),
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES, DENIED);
  if (denied) return denied;

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.organizationId, organizationId)))
    .limit(1);
  if (!run) return Response.json({ error: "Payroll run not found in this workspace." }, { status: 404 });

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  try {
    const { record, created } = await recordGeneratedFiling({
      organizationId,
      runId,
      definition,
      actor: user.name,
    });
    if (created) {
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: `${definition.agency} ${definition.form} filing record created`,
        resource: run.periodLabel,
        metadata: {
          runId,
          legalEntityId: record.legalEntityId,
          recordId: record.id,
          fileSha256: record.fileSha256,
          generatorVersion: record.generatorVersion,
          applicableMonth: record.applicableMonth,
          employeeCount: record.employeeCount,
          reportedTotal: record.reportedTotal == null ? null : Number(record.reportedTotal),
          submittedToAgency: false,
        },
      });
    }
    return Response.json({ record, created }, { status: created ? 201 : 200 });
  } catch (error) {
    // Generation fails on incomplete data (for example a missing SSS number).
    return Response.json({
      error: error instanceof Error ? error.message : "The filing file could not be generated.",
    }, { status: 422 });
  }
}
