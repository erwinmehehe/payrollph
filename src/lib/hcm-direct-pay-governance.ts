import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Once enterprise compensation governance is configured, its approved workflow
 * remains authoritative even when a policy is deactivated or has expired.
 * Legacy direct salary editing cannot be an escape hatch for live employers.
 */
export function compensationGovernanceQuery(organizationId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Valid organizationId is required for compensation governance.");
  }
  return sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM hcm_business_process_definitions
        WHERE organization_id = ${organizationId} AND process_type = 'compensation_change'
      )
      OR EXISTS (
        SELECT 1 FROM hcm_business_process_instances
        WHERE organization_id = ${organizationId} AND process_type = 'compensation_change'
      )
      OR EXISTS (SELECT 1 FROM compensation_cycles WHERE organization_id = ${organizationId})
      OR EXISTS (SELECT 1 FROM compensation_proposals WHERE organization_id = ${organizationId})
    ) AS blocked
  `;
}

export async function isGovernedCompensationWorkspace(organizationId: number) {
  const result = await db.execute(compensationGovernanceQuery(organizationId));
  const blocked = result.rows[0]?.blocked;
  // Missing/unexpected DB answers are never interpreted as authorization.
  if (blocked !== true && blocked !== false) {
    throw new Error("Compensation governance check returned no valid decision.");
  }
  return blocked;
}

export const HCM_GOVERNED_COMPENSATION_REQUIRED = {
  code: "HCM_GOVERNED_COMPENSATION_REQUIRED",
  error: "Governed compensation is enabled for this company. Use Compensation proposals for current or future salary changes. Backdated corrections require an independently approved payroll correction process; direct Edit pay cannot bypass approval.",
} as const;
