import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollRuns } from "@/db/schema";

/**
 * A tenant administrator must never receive deployment-wide operational data.
 * This endpoint exposes only counts queried with the authorized employer ID.
 * None of these observations is a production, bank, filing or pilot signoff.
 */
export async function buildTenantWorkspaceReadiness(organizationId: number): Promise<Response> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return tenantReadinessUnavailable(organizationId);
  }

  const [organization] = await db.select({ id: organizations.id })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return tenantReadinessUnavailable(organizationId);

  const [[employeeCount], [payrollRunCount], [missingRestDayCount]] = await Promise.all([
    db.select({ value: count() }).from(employees)
      .where(eq(employees.organizationId, organizationId)),
    db.select({ value: count() }).from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId)),
    db.select({ value: count() }).from(employees)
      .where(and(eq(employees.organizationId, organizationId), isNull(employees.restDay))),
  ]);

  const employeeRecords = Number(employeeCount.value);
  const draftOrHistoricalPayrollRuns = Number(payrollRunCount.value);
  const employeesWithoutRestDay = Number(missingRestDayCount.value);
  const gates = [
    {
      key: "employer-roster-observed",
      label: "Employer roster exists",
      ready: employeeRecords > 0,
      detail: employeeRecords + " employee record(s) exist for this employer only. This does not verify salary or identity data.",
      blocks: "launch" as const,
      manualWorkaround: null,
    },
    {
      key: "employee-rest-days-recorded",
      label: "Rest-day information recorded",
      ready: employeeRecords > 0 && employeesWithoutRestDay === 0,
      detail: employeesWithoutRestDay + " employee record(s) lack a designated rest day in this employer.",
      blocks: "launch" as const,
      manualWorkaround: null,
    },
    {
      key: "external-pilot-acceptance",
      label: "Independent payroll, bank and filing acceptance",
      ready: false,
      detail: "This endpoint does not evaluate external acceptance or production-pilot signoff. Review outside the tenant snapshot is required.",
      blocks: "launch" as const,
      manualWorkaround: null,
    },
    {
      key: "operational-scale-evidence",
      label: "Platform-scale operating evidence",
      ready: false,
      detail: "Platform-wide delivery, audit, and infrastructure metrics are restricted to the operations-token endpoint.",
      blocks: "scale" as const,
      manualWorkaround: null,
    },
  ];

  return Response.json({
    organizationId,
    status: "not-launch-ready",
    launchBlockersRemaining: gates.filter((g) => g.blocks === "launch" && !g.ready).length,
    scaleGapsRemaining: gates.filter((g) => g.blocks === "scale" && !g.ready).length,
    summary: "Employer-specific records were counted. Production readiness, external acceptance and launch approval remain unverified.",
    manualLaunch: {
      ready: false,
      summary: "A controlled payroll pilot has not been verified or approved by this employer-scoped snapshot.",
    },
    generatedAt: new Date().toISOString(),
    gates,
    evidence: {
      scope: "employer-only",
      employeeRecords,
      payrollRunRecords: draftOrHistoricalPayrollRuns,
      employeesWithoutRestDay,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Fail closed without disclosing database diagnostics or platform metrics. */
export function tenantReadinessUnavailable(organizationId: number): Response {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "A valid employer selection is required." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({
    code: "WORKSPACE_READINESS_UNAVAILABLE",
    error: "Employer readiness evidence is unavailable. No launch or pilot status has been verified.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
