import { sql, type SQLWrapper } from "drizzle-orm";

/** Never erase the master while named audit/Hire evidence remains elsewhere.
 * These records need a separately reviewed retention/disposal process, not an
 * in-place rewrite that breaks immutable audit or governed Hire evidence.
 */
export function applicantRetainedCopyHoldSql(applicantId: number | SQLWrapper, organizationId: number | SQLWrapper) {
  return sql`(
    EXISTS (SELECT 1 FROM hcm_business_process_instances p
      WHERE p.organization_id = ${organizationId} AND p.source_type = 'recruitment_hire'
      AND p.source_key LIKE (${applicantId}::text || ':%'))
    OR EXISTS (SELECT 1 FROM audit_events a
      WHERE a.organization_id = ${organizationId}
      AND a.metadata->>'applicantId' = ${applicantId}::text
      AND a.resource <> ('Applicant #' || ${applicantId}::text))
  )`;
}
