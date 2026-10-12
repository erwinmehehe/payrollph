import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicantPrivacyEvidence, auditEvents, jobApplicants } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  applicantPiiEraseValues, rejectedApplicantCanPurge, sixCalendarMonthsBefore,
} from "@/lib/recruitment-applicant-privacy";

/**
 * Retention purges PII only for verified, rejected, nonhired applicants.
 * Legacy candidates have no invented consent/rejection date and are NOT
 * auto-erased. Linked private resumes must be erased separately and verified;
 * a non-null resume pointer is a fail-closed blocker, not permission to orphan
 * stored personal data.
 */
export async function purgeExpiredRejectedApplicants(now: Date, limit = 50) {
  if (!criticalReleaseFlagEnabled("applicantPrivacy")) {
    return { purged: 0, enabled: false as const };
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isFinite(now.getTime())) throw new Error("INVALID_CANDIDATE_PURGE_INPUT");
  const cutoff = sixCalendarMonthsBefore(now);
  const due = await db.select({
    applicantId: applicantPrivacyEvidence.applicantId,
    organizationId: applicantPrivacyEvidence.organizationId,
  }).from(applicantPrivacyEvidence).innerJoin(jobApplicants, and(
    eq(jobApplicants.id, applicantPrivacyEvidence.applicantId),
    eq(jobApplicants.organizationId, applicantPrivacyEvidence.organizationId),
  )).where(and(
    eq(jobApplicants.stage, "rejected"),
    isNull(jobApplicants.hiredEmployeeId),
    isNull(jobApplicants.resumeUrl),
    eq(applicantPrivacyEvidence.legalHold, false),
    isNull(applicantPrivacyEvidence.purgedAt),
    lte(applicantPrivacyEvidence.rejectedAt, cutoff),
  )).orderBy(applicantPrivacyEvidence.id).limit(limit);
  let purged = 0;
  for (const candidate of due) {
    const didPurge = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM job_applicants
        WHERE id = ${candidate.applicantId} AND organization_id = ${candidate.organizationId}
        FOR UPDATE`);
      const [applicant] = await tx.select().from(jobApplicants).where(and(
        eq(jobApplicants.id, candidate.applicantId),
        eq(jobApplicants.organizationId, candidate.organizationId),
      )).limit(1);
      const [privacy] = await tx.select().from(applicantPrivacyEvidence).where(and(
        eq(applicantPrivacyEvidence.applicantId, candidate.applicantId),
        eq(applicantPrivacyEvidence.organizationId, candidate.organizationId),
      )).limit(1);
      if (!applicant || !privacy || !rejectedApplicantCanPurge({
        stage: applicant.stage, hiredEmployeeId: applicant.hiredEmployeeId,
        rejectedAt: privacy.rejectedAt, legalHold: privacy.legalHold,
        purgedAt: privacy.purgedAt, resumeUrl: applicant.resumeUrl,
      }, now)) return false;
      await tx.update(jobApplicants).set(applicantPiiEraseValues(candidate.applicantId))
        .where(and(eq(jobApplicants.id, candidate.applicantId),
          eq(jobApplicants.organizationId, candidate.organizationId)));
      await tx.update(applicantPrivacyEvidence).set({ purgedAt: now })
        .where(and(eq(applicantPrivacyEvidence.applicantId, candidate.applicantId),
          eq(applicantPrivacyEvidence.organizationId, candidate.organizationId)));
      await tx.insert(auditEvents).values({
        organizationId: candidate.organizationId,
        actor: "System retention scheduler",
        action: "Rejected candidate PII purged after six calendar months",
        resource: "Applicant #" + candidate.applicantId,
        metadata: {
          applicantId: candidate.applicantId,
          cutoff: cutoff.toISOString().slice(0, 10),
          retainedAnonymousAudit: true,
        },
      });
      return true;
    });
    if (didPurge) purged++;
  }
  return { purged, enabled: true as const };
}
