import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobRequisitions } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { applicantPrivacyControlsEnabled } from "@/lib/recruitment-applicant-privacy";

/**
 * Source-only careers launch gate. Applicant consent is never synthesized or
 * backfilled for legacy candidates; #925's privacy evidence remains mandatory.
 */
export function careersNoticeConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney", env) ||
      !criticalReleaseFlagEnabled("publicIntakeProof", env) ||
      !applicantPrivacyControlsEnabled(env)) return null;
  const version = env.CAREERS_PRIVACY_NOTICE_VERSION ?? "";
  const raw = env.CAREERS_PRIVACY_NOTICE_URL ?? "";
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(version) || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.toString() !== raw) return null;
    return { version, url: raw };
  } catch {
    return null;
  }
}

/** This is intentionally NOT declared on the shared Drizzle jobRequisitions
 * table until an approved additive migration. Adding the field to that table
 * makes legacy .select() calls query an unapplied column even with flags OFF.
 */
export const careersPublishedSql = sql<boolean>`"job_requisitions"."careers_published"`;

export function publishedCareersPredicate(organizationId: number) {
  return and(
    eq(jobRequisitions.organizationId, organizationId),
    sql`${careersPublishedSql} = true`,
    sql`${jobRequisitions.status} in ('open', 'interviewing')`,
    sql`${jobRequisitions.positionId} is not null`,
    sql`exists (select 1 from positions as eligible_position
      where eligible_position.id = ${jobRequisitions.positionId}
        and eligible_position.organization_id = ${jobRequisitions.organizationId}
        and eligible_position.status = 'open')`,
  );
}

/** Prove the independent #925 table and unnumbered careers column have
 * actually been applied before ANY flagged public intake/publish operation.
 * Check the current search-path schema, so disposable CI namespaces work.
 */
export async function careersSchemaReady(database: Pick<typeof db, "execute"> = db) {
  try {
    const result = await database.execute<{ ready: boolean }>(sql`
      select (to_regclass('job_requisitions') is not null
        and to_regclass('applicant_privacy_evidence') is not null
        and exists (select 1 from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'job_requisitions'
            and column_name = 'careers_published')
      ) as ready`);
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  }
}

/** UI capability is never the authorization boundary: recheck live membership,
 * session policy, MFA and current requisition state in the PATCH route.
 */
export function canManagePublicCareers(input: {
  role: string;
  companyWide: boolean;
}) {
  return input.companyWide === true && ["owner", "admin", "hr"].includes(input.role);
}
