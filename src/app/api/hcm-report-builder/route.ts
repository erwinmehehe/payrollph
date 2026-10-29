import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, legalEntities, orgUnits, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  REPORT_FIELDS,
  buildWhitelistedReport, validateReportDates, validateReportSpecification,
  type ReportDataset, type ReportRole, type ReportSpecification,
} from "@/lib/hcm-report-builder";
import { loadAuthorizedReportRows } from "@/lib/hcm-report-source";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function authorize(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId, organizationId, PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can build workforce reports.",
  );
  if (denied) return { denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { denied: Response.json({ error: "Report building requires company-wide access." }, { status: 403 }) };
  }
  // Current companyWide is an org-unit scope, NOT an entity grant.
  // Until the reviewed multi-entity permission model ships, fail closed for
  // any tenant with zero or multiple legal employers.
  const entities = await db.select({ id: legalEntities.id, active: legalEntities.active })
    .from(legalEntities).where(eq(legalEntities.organizationId, organizationId)).limit(2);
  if (entities.length !== 1 || entities[0].active !== true) {
    return { denied: Response.json({
      error: "This report builder requires a verified single-entity workspace. Multi-entity reporting is disabled pending entity-grant review.",
    }, { status: 409 }) };
  }
  const employerId = entities[0].id;
  // A single registered employer is insufficient if older employees, payroll
  // runs or units are unassigned or point at another legal employer. The
  // custom report uses company-wide rows: refuse both metadata and exports
  // until the legacy attribution is independently reconciled.
  const [unattributedWorkers, unattributedRuns, unattributedUnits] = await Promise.all([
    db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.organizationId, organizationId),
      or(isNull(employees.legalEntityId), ne(employees.legalEntityId, employerId)),
    )).limit(1),
    db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      or(isNull(payrollRuns.legalEntityId), ne(payrollRuns.legalEntityId, employerId)),
    )).limit(1),
    db.select({ id: orgUnits.id }).from(orgUnits).where(and(
      eq(orgUnits.organizationId, organizationId),
      or(isNull(orgUnits.legalEntityId), ne(orgUnits.legalEntityId, employerId)),
    )).limit(1),
  ]);
  if (unattributedWorkers.length || unattributedRuns.length || unattributedUnits.length) {
    return { denied: Response.json({
      error: "Historical legal-employer attribution requires independent review before custom reports are available.",
      code: "HCM_REPORT_ENTITY_ATTRIBUTION_REQUIRED",
    }, { status: 409, headers: { "Cache-Control": "no-store" } }) };
  }
  return { role: access.role as ReportRole };
}

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("tenantReportBuilder")) return Response.json({ error: "Not found." }, { status: 404 });
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const gate = await authorize(session.id, organizationId);
  if (gate.denied) return gate.denied;
  const canSeeSalary = ["admin", "hr", "payroll"].includes(gate.role!);
  return Response.json({
    datasets: ["people", "time", "payroll"],
    fields: REPORT_FIELDS.filter(field => !field.salary || canSeeSalary),
    constraints: { maxDays: 366, maxSourceRows: 50_000, singleEntityOnly: true },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("tenantReportBuilder")) return Response.json({ error: "Not found." }, { status: 404 });
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  }
  const gate = await authorize(session.id, organizationId);
  if (gate.denied) return gate.denied;

  const format = body.format === "csv" ? "csv" : body.format === "json" ? "json" : null;
  if (!format) return Response.json({ error: "format must be json or csv." }, { status: 400 });
  if (format === "csv") {
    const mfaDenied = requireSensitiveActionMfa(session);
    if (mfaDenied) return mfaDenied;
  }
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "hcm-report-builder",
    resourceId: organizationId, limit: 20, windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const spec: ReportSpecification = {
    dataset: body.dataset as ReportDataset,
    fields: body.fields as string[],
    groupBy: typeof body.groupBy === "string" ? body.groupBy : null,
    filters: body.filters as Record<string, string> | undefined,
  };
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");
  try {
    validateReportSpecification(spec, gate.role!);
    validateReportDates(startDate, endDate);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid report request." }, { status: 400 });
  }

  let result;
  try {
    const needsDepartment = spec.groupBy === "department"
      || spec.fields.includes("department")
      || Boolean(spec.filters?.department);
    const facts = await loadAuthorizedReportRows({
      organizationId, dataset: spec.dataset, startDate, endDate,
      requireDepartmentAttribution: needsDepartment,
    });
    result = buildWhitelistedReport(spec, gate.role!, facts);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Report source unavailable.";
    const sourceConflict = detail.includes("attribution");
    const tooMany = detail.includes("50,000");
    return Response.json({ error: sourceConflict || tooMany ? detail : "Report could not be generated from verified records." },
      { status: sourceConflict ? 409 : tooMany ? 413 : 500 });
  }

  if (format === "json") return Response.json({
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rows.length,
    startDate, endDate,
  }, { headers: { "Cache-Control": "no-store" } });

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "HCM custom report CSV exported",
    resource: spec.dataset,
    metadata: {
      actorUserId: session.id, fields: spec.fields, groupBy: spec.groupBy,
      filters: spec.filters ?? {}, startDate, endDate, rowCount: result.rows.length,
    },
  });
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=linaw-custom-report.csv",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
