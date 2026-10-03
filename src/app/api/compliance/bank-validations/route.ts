import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  getAccess,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import {
  listBankFileValidations,
  recordGeneratedBankFile,
} from "@/lib/bank-evidence-store";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can review bank validation evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Bank validation evidence requires company-wide payroll access.",
    }, { status: 403 });
  }

  return Response.json({ records: await listBankFileValidations(organizationId) });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Creating bank validation evidence");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const runId = Number(body.runId);
  const templateName = typeof body.templateName === "string" ? body.templateName.trim() : "";
  if (
    !Number.isInteger(organizationId)
    || organizationId <= 0
    || !Number.isInteger(runId)
    || runId <= 0
    || !templateName
  ) {
    return Response.json({
      error: "organizationId, runId and templateName are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can create bank validation evidence.",
  );
  if (denied) return denied;

  const [run] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, runId),
    eq(payrollRuns.organizationId, organizationId),
  )).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found in this workspace." }, { status: 404 });

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "bank-validation-generate",
    resourceId: runId,
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  try {
    const { record, created } = await recordGeneratedBankFile({
      organizationId,
      runId,
      templateName,
      actor: user.name,
    });
    if (created) {
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Bank validation file record created",
        resource: run.periodLabel,
        metadata: {
          runId,
          recordId: record.id,
          templateName: record.templateName,
          templateVersion: record.templateVersion,
          fileSha256: record.fileSha256,
          portalAccepted: false,
        },
      });
    }
    return Response.json({
      record,
      created,
      downloadHref: `/api/compliance/bank-validations/${record.id}/file?organizationId=${organizationId}`,
    }, { status: created ? 201 : 200 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The bank validation file could not be generated.",
    }, { status: 422 });
  }
}
