import { createHash } from "node:crypto";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, legalEntities, orgUnits, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import {
  BUILDER_FIELD_CATALOG, canUseBuilderField, validateBuilderSpec, runWhitelistedBuilder,
  builderRowsToCsv, builderRequiresEntityRole,
} from "@/lib/tenant-report-builder";
import { getBuilderFacts } from "@/lib/tenant-report-builder-server";

export const dynamic = "force-dynamic";

async function authorize(organizationId: number) {
  if (!criticalReleaseFlagEnabled("tenantReportBuilder")) {
    return { error: Response.json({ error: "Report builder unavailable." }, { status: 404 }) };
  }
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (!Number.isSafeInteger(organizationId) || organizationId < 1) {
    return { error: Response.json({ error: "Valid organizationId required." }, { status: 400 }) };
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES,
    "Only authorized People or payroll roles can use reports.");
  if (denied) return { error: denied };
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({ error: "Reports require company-wide scope." }, { status: 403 }) };
  }
  // Count ALL employer registrations, including inactive historical ones.
  // One active employer is not proof that earlier rows belong to it.
  const employers = await db.select({ id: legalEntities.id, active: legalEntities.active })
    .from(legalEntities).where(eq(legalEntities.organizationId, organizationId)).limit(2);
  if (builderRequiresEntityRole(employers.length) || employers[0].active !== true) {
    return { error: Response.json({
      error: "Reports require a single verified legal employer and explicitly reviewed entity grants.",
    }, { status: 403 }) };
  }
  const employerId = employers[0].id;
  // No tenant-level report may silently incorporate unattributed, legacy, or
  // foreign-employer records. Do not assume the sole active employer owns them.
  const [unverifiedPeople, unverifiedRuns, unverifiedUnits] = await Promise.all([
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
  if (unverifiedPeople.length || unverifiedRuns.length || unverifiedUnits.length) {
    return { error: Response.json({
      error: "Historical legal-employer attribution requires review before report exports.",
      code: "ENTITY_ATTRIBUTION_REQUIRED",
    }, { status: 409 }) };
  }
  return { user, role: access.role };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await authorize(Number(params.get("organizationId")));
  if (auth.error) return auth.error;
  return Response.json({
    fields: Object.fromEntries(Object.entries(BUILDER_FIELD_CATALOG).map(([dataset, fields]) =>
      [dataset, fields.filter(field => canUseBuilderField(auth.role!, dataset as keyof typeof BUILDER_FIELD_CATALOG, field))])),
    maxRows: 5_000, maxDays: 366, formats: ["json", "csv"],
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const payload = await request.json().catch(() => ({}));
  const organizationId = Number(payload.organizationId);
  const auth = await authorize(organizationId);
  if (auth.error) return auth.error;
  const mfa = requireSensitiveActionMfa(auth.user!);
  if (mfa) return mfa;
  const rateLimit = await enforceSensitiveActionRateLimit(request, {
    userId: auth.user!.id, action: "tenant-report-builder",
    resourceId: organizationId, limit: 15, windowMs: 5 * 60_000,
  });
  if (rateLimit) return rateLimit;
  const startDate = String(payload.startDate ?? "");
  const endDate = String(payload.endDate ?? "");
  const format = payload.format === "csv" ? "csv" : payload.format === "json" ? "json" : null;
  if (!format) return Response.json({ error: "format must be csv or json." }, { status: 400 });
  try {
    const spec = validateBuilderSpec(payload.spec, auth.role!);
    const facts = await getBuilderFacts({ organizationId, dataset: spec.dataset, startDate, endDate });
    const rows = runWhitelistedBuilder(facts, spec);
    if (format === "csv") {
      const csv = builderRowsToCsv(spec, rows);
      await recordAuditEvent({
        organizationId, actor: auth.user!.name, action: "Tenant report builder CSV exported",
        resource: spec.dataset, metadata: {
          fields: spec.fields, groupBy: spec.groupBy ?? null,
          filters: spec.filters ?? {}, startDate, endDate, rows: rows.length,
          sha256: createHash("sha256").update(csv).digest("hex"),
        },
      });
      return new Response(csv, { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=linaw-tenant-report.csv",
        "Cache-Control": "no-store",
      } });
    }
    return Response.json({ columns: spec.fields, rows, source: spec.dataset,
      note: spec.dataset === "people"
        ? "Headcount and separated counts are as-of snapshots, not window turnover rates."
        : spec.dataset === "payroll"
          ? "OT cost covers the stored OT line only, not other overtime premiums. Department is the payroll-run scope."
          : "Department is the employee's current unit; historical transfers may need attribution review.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Report failed." }, { status: 400 });
  }
}
