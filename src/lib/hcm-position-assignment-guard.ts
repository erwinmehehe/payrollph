import { sql } from "drizzle-orm";
import { db } from "@/db";

const MOVEMENT_TYPES = ["hire", "change_job", "promotion", "transfer"] as const;
export { MOVEMENT_TYPES };

/**
 * A direct incumbent assignment modifies the employee's current job,
 * legal employer and position occupancy. It cannot bypass a tenant that
 * has activated formal Hire/Transfer/Promotion/Change Job approval policy.
 */
export function directPositionAssignmentGovernanceQuery(organizationId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Valid organizationId is required for position assignment governance.");
  }
  return sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM hcm_business_process_definitions
        WHERE organization_id = ${organizationId}
        AND process_type IN ('hire','change_job','promotion','transfer')
      )
      OR EXISTS (
        SELECT 1 FROM hcm_business_process_instances
        WHERE organization_id = ${organizationId}
        AND process_type IN ('hire','change_job','promotion','transfer')
      )
    ) AS blocked
  `;
}

export async function isGovernedPositionAssignmentWorkspace(organizationId: number) {
  const result = await db.execute(directPositionAssignmentGovernanceQuery(organizationId));
  const decision = result.rows[0]?.blocked;
  if (decision !== true && decision !== false) {
    throw new Error("Position assignment governance check returned no valid decision.");
  }
  return decision;
}

export const HCM_GOVERNED_POSITION_ASSIGNMENT_REQUIRED = {
  code: "HCM_GOVERNED_POSITION_ASSIGNMENT_REQUIRED",
  error: "This company uses governed hiring or job changes. Direct position assignment is disabled. Use Recruitment > Hire & onboard for new hires or the effective-dated HCM Transfer/Promotion workflow for existing workers; do not mutate an employee's approved job state directly.",
} as const;
