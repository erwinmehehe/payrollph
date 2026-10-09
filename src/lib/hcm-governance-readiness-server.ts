import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessDefinitions } from "@/db/schema";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import { buildHcmGovernanceReadiness, type HcmGovernanceCounters } from "@/lib/hcm-governance-readiness";
import { WAGE_ORDERS } from "@/lib/wage-orders";

/** Evidence loader, intentionally SELECT-only. Authorization belongs to the API route. */
export async function loadHcmGovernanceReadiness(organizationId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Valid organizationId is required.");
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
        ) AS "inProgressBusinessProcesses",
        (SELECT count(*)::int FROM hcm_business_process_instance_steps step
          JOIN hcm_business_process_instances bp
            ON bp.id = step.instance_id AND bp.organization_id = step.organization_id
          WHERE step.organization_id = ${organizationId}
            AND bp.status = 'in_progress' AND step.status = 'pending'
        ) AS "pendingHcmSteps",
        (SELECT count(*)::int FROM hcm_business_process_instance_steps step
          JOIN hcm_business_process_instances bp
            ON bp.id = step.instance_id AND bp.organization_id = step.organization_id
          WHERE step.organization_id = ${organizationId}
            AND bp.status = 'in_progress' AND step.status = 'pending'
            AND step.due_at IS NOT NULL AND step.due_at < now()
        ) AS "overdueHcmSteps",
        (SELECT count(*)::int FROM hcm_business_process_instance_steps step
          JOIN hcm_business_process_instances bp
            ON bp.id = step.instance_id AND bp.organization_id = step.organization_id
          LEFT JOIN approval_tasks task ON task.id = step.approval_task_id
          WHERE step.organization_id = ${organizationId}
            AND bp.status = 'in_progress' AND step.status = 'pending'
            AND step.step_type = 'approval'
            AND (step.approval_task_id IS NULL OR task.id IS NULL
              OR task.organization_id <> step.organization_id OR task.status <> 'Pending')
        ) AS "pendingHcmApprovalTaskMismatch",
        (SELECT count(*)::int FROM hcm_business_process_instances bp
          WHERE bp.organization_id = ${organizationId} AND bp.status = 'in_progress'
            AND NOT EXISTS (
              SELECT 1 FROM hcm_business_process_instance_steps step
              WHERE step.instance_id = bp.id AND step.organization_id = bp.organization_id
                AND step.step_index = bp.current_step_index AND step.status = 'pending'
            )
        ) AS "hcmProcessesWithoutPendingCurrentStep"
    `),
  ]);
  const row = aggregates.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("HCM aggregate query returned no evidence.");
  const fields: Array<keyof HcmGovernanceCounters> = [
    "employees", "activeWorkers", "futureStartDates", "missingRestDays",
    "missingPayProfiles", "unsupportedWageRegions", "duplicateEmployeeNumbers",
    "approvedSeparationsWithoutClearance", "releasedSeparationsWithoutReference",
    "releasedSeparationsWorkerNotSeparated", "separatedWorkersWithOpenAssignments",
    "inProgressBusinessProcesses", "pendingHcmSteps", "overdueHcmSteps",
    "pendingHcmApprovalTaskMismatch", "hcmProcessesWithoutPendingCurrentStep",
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
  return report;
}
