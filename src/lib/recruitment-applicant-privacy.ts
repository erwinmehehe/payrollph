import { criticalReleaseFlagEnabled } from "./critical-release-flags";

/** Employer scoping remains deferred with the rest of the multi-entity HCM lane. */
export function applicantPrivacyControlsEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return criticalReleaseFlagEnabled("applicantPrivacy", env) && !criticalReleaseFlagEnabled("multiEntity", env);
}

/** Applicant privacy rules. These are policy gates, not a legal conclusion. */
export function applicantPrivacyId(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

export function sixCalendarMonthsBefore(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_RETENTION_CLOCK");
  // Philippine calendar months, independent of the worker process timezone.
  const manilaOffset = 8 * 60 * 60_000;
  const local = new Date(now.getTime() + manilaOffset);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 6, 1,
    local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(local.getUTCDate(), lastDay));
  return new Date(target.getTime() - manilaOffset);
}

export function requireApplicantConsent(input: {
  privacyAccepted: unknown;
  privacyNoticeVersion: unknown;
  privacyEvidenceReference: unknown;
}): { privacyNoticeVersion: string; sourceEvidenceReference: string } {
  const version = typeof input.privacyNoticeVersion === "string" ? input.privacyNoticeVersion.trim() : "";
  const sourceEvidence = typeof input.privacyEvidenceReference === "string" ? input.privacyEvidenceReference.trim() : "";
  if (input.privacyAccepted !== true || !/^[A-Za-z0-9._-]{2,64}$/.test(version) ||
      sourceEvidence.length < 8 || sourceEvidence.length > 200 || /[\r\n\u0000-\u001f]/.test(sourceEvidence)) {
    throw new Error("CANDIDATE_CONSENT_EVIDENCE_REQUIRED");
  }
  return { privacyNoticeVersion: version, sourceEvidenceReference: sourceEvidence };
}

export type RejectedApplicantRetention = {
  stage: string;
  hiredEmployeeId: number | null;
  hiredAt?: Date | null;
  rejectedAt: Date | null;
  legalHold: boolean;
  purgedAt: Date | null;
  resumeUrl: string | null;
};

export function rejectedApplicantCanPurge(input: RejectedApplicantRetention, now: Date): boolean {
  return input.stage === "rejected" && input.hiredEmployeeId == null && input.hiredAt == null &&
    input.rejectedAt instanceof Date && Number.isFinite(input.rejectedAt.getTime()) &&
    input.rejectedAt.getTime() <= sixCalendarMonthsBefore(now).getTime() &&
    input.legalHold === false && input.purgedAt === null &&
    !input.resumeUrl; // never orphan a private resume object during DB erasure
}

export function applicantPiiEraseValues(applicantId: number) {
  if (!Number.isSafeInteger(applicantId) || applicantId < 1) throw new Error("INVALID_APPLICANT");
  // Keep a pseudonymous recruiting-stage / referential record.
  return {
    fullName: "Redacted applicant #" + applicantId,
    email: "redacted+" + applicantId + "@deleted.invalid",
    phone: null,
    notes: null,
    resumeUrl: null,
    offeredSalary: null,
    rating: 3,
  };
}

export function validApplicantPrivacyDecision(reason: unknown, evidenceReference: unknown): boolean {
  return typeof reason === "string" && reason.trim().length >= 20 && reason.trim().length <= 500 &&
    typeof evidenceReference === "string" && evidenceReference.trim().length >= 8 &&
    evidenceReference.trim().length <= 200 && !/[\r\n\u0000-\u001f]/.test(evidenceReference);
}

export function applicantErasureIndependentlyApproved(record: {
  deletionRequestedByUserId: number | null;
  deletionRequestedAt: Date | null;
  deletionReason: string | null;
  deletionReviewedByUserId: number | null;
  deletionReviewedAt: Date | null;
  deletionReviewEvidenceReference: string | null;
}, now: Date): boolean {
  const requested = record.deletionRequestedAt?.getTime() ?? Number.NaN;
  const reviewed = record.deletionReviewedAt?.getTime() ?? Number.NaN;
  const current = now.getTime();
  return Number.isSafeInteger(record.deletionRequestedByUserId) &&
    Number(record.deletionRequestedByUserId) > 0 &&
    Number.isSafeInteger(record.deletionReviewedByUserId) &&
    Number(record.deletionReviewedByUserId) > 0 &&
    record.deletionRequestedByUserId !== record.deletionReviewedByUserId &&
    Number.isFinite(requested) && Number.isFinite(reviewed) &&
    reviewed >= requested && reviewed <= current &&
    current - reviewed <= 30 * 24 * 60 * 60_000 &&
    validApplicantPrivacyDecision(record.deletionReason, record.deletionReviewEvidenceReference);
}
