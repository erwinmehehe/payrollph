import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessDefinitions } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import { buildHcmGovernanceReadiness, type HcmGovernanceCounters } from "@/lib/hcm-governance-readiness";
import { WAGE_ORDERS } from "@/lib/wage-orders";

export const dynamic = "force-dynamic";

/** Tenant-scoped read-only aggregate inventory. Never includes employee names, IDs, payroll amounts or bank data. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only authorized People administrators may review HCM governance exceptions.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "HCM governance inspection requires company-wide People administration.",
    }, { status: 403 });
  }

  const asOf = philippineBusinessDate();
  const supportedRegions = [...new Set(WAGE_ORDERS.map(row => row.region.toUpperCase()))];
  if (supportedRegions.length < 1) throw new Error("Supported wage-region table is not configured.");

  // Aggregate in the database, never fetch individual payroll, identity,
  // bank or contract records into the endpoint response.
  const [definitions, aggregates] = await Promise.all([
    db.select({
      processType: hcmBusinessProcessDefinitions.processType,
      active: hcmBusinessProcessDefinitions.active,
      effectiveFrom: hcmBusinessProcessDefinitions.effectiveFrom,
      effectiveUntil: hcmBusinessProcessDefinitions.effectiveUntil,
      supervisoryOrgUnitId: hcmBusinessProcessDefinitions.supervisoryOrgUnitId,
    }).from(hcmBusinessProcessDefinitions).where(
      eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
    ),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM employees e
          WHERE e.organization_id = ${organizationId}) AS "employees",
        (SELECT count(*)::int FROM employees e
          WHERE e.organization_id = ${organizationId}
            AND e.status IN ('Active','On leave','Separating')) AS "activeWorkers",
        (SELECT count(*)::int FROM employees e
          WHERE e.organization_id = ${organizationId}
            AND e.status IN ('Active','On leave','Separating')
            AND e.start_date > ${asOf}::date) AS "futureStartDates",
        (SELECT count(*)::int FROM employees e
          WHERE e.organization_id = ${organizationId}
            AND e.status IN ('Active','On leave','Separating')
            AND e.rest_day IS NULL) AS "missingRestDays",
        (SELECT count(*)::int FROM employees e
          LEFT JOIN employee_pay_profiles pp
            ON pp.employee_id = e.id AND pp.organization_id = e.organization_id
          WHERE e.organization_id = ${organizationId}
            AND e.status IN ('Active','On leave','Separating') AND pp.id IS NULL) AS "missingPayProfiles",
        (SELECT count(*)::int FROM employees e
          WHERE e.organization_id = ${organizationId}
            AND upper(trim(e.region)) NOT IN (${sql.join(supportedRegions.map(region => sql`${region}`), sql`, `)})) AS "unsupportedWageRegions",
        (SELECT count(*)::int FROM (
          SELECT lower(trim(e.employee_no))
          FROM employees e WHERE e.organization_id = ${organizationId}
          GROUP BY lower(trim(e.employee_no)) HAVING count(*) > 1
        ) duplicate_employee_nos) AS "duplicateEmployeeNumbers",
        (SELECT count(*)::int FROM separation_records sr
          WHERE sr.organization_id = ${organizationId}
            AND sr.status IN ('approved','released')
            AND NOT (sr.it_cleared AND sr.admin_cleared AND sr.finance_cleared AND sr.hr_cleared)
        ) AS "approvedSeparationsWithoutClearance",
        (SELECT count(*)::int FROM separation_records sr
          WHERE sr.organization_id = ${organizationId}
            AND sr.status = 'released'
            AND (sr.release_reference IS NULL OR length(trim(sr.release_reference)) = 0)
        ) AS "releasedSeparationsWithoutReference",
        (SELECT count(*)::int FROM separation_records sr
          JOIN employees e ON e.id = sr.employee_id AND e.organization_id = sr.organization_id
          WHERE sr.organization_id = ${organizationId}
            AND sr.status = 'released' AND e.status <> 'Separated'
        ) AS "releasedSeparationsWorkerNotSeparated",
        (SELECT count(*)::int FROM position_assignments pa
          JOIN employees e ON e.id = pa.employee_id AND e.organization_id = pa.organization_id
          WHERE pa.organization_id = ${organizationId} AND pa.effective_until IS NULL
            AND pa.assignment_type = 'primary'
            AND e.status IN ('Separated','Inactive','Terminated')
        ) AS "separatedWorkersWithOpenAssignments",
        (SELECT count(*)::int FROM hcm_business_process_instances bp
          WHERE bp.organization_id = ${organizationId}
            AND bp.status = 'in_progress'
        ) AS "inProgressBusinessProcesses"
    `),
  ]);
  const row = aggregates.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("HCM aggregate query returned no evidence.");
  const fields: Array<keyof HcmGovernanceCounters> = [
    "employees", "activeWorkers", "futureStartDates", "missingRestDays",
    "missingPayProfiles", "unsupportedWageRegions", "duplicateEmployeeNumbers",
    "approvedSeparationsWithoutClearance", "releasedSeparationsWithoutReference",
    "releasedSeparationsWorkerNotSeparated", "separatedWorkersWithOpenAssignments",
    "inProgressBusinessProcesses",
  ];
  const counters = {} as HcmGovernanceCounters;
  for (const key of fields) {
    const count = Number(row[key]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid HCM count: ${key}`);
    counters[key] = count;
  }

  const report = buildHcmGovernanceReadiness({
    asOf,
    counters,
    definitions: definitions.map(definition => ({
      ...definition,
      effectiveFrom: String(definition.effectiveFrom),
      effectiveUntil: definition.effectiveUntil == null ? null : String(definition.effectiveUntil),
    })),
  });
  return Response.json(report, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
