import test from "node:test";
import assert from "node:assert/strict";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import {
  applicantPiiEraseValues, rejectedApplicantCanPurge, requireApplicantConsent,
  sixCalendarMonthsBefore, validApplicantPrivacyDecision,
} from "../src/lib/recruitment-applicant-privacy";

test("applicant privacy remains OFF by default", () => {
  assert.equal(criticalReleaseFlagEnabled("applicantPrivacy", {}), false);
  assert.equal(criticalReleaseFlagEnabled("applicantPrivacy", { APPLICANT_PRIVACY_CONTROLS_ENABLED: "True" }), false);
  assert.equal(criticalReleaseFlagEnabled("applicantPrivacy", { APPLICANT_PRIVACY_CONTROLS_ENABLED: "true" }), true);
});
test("intake cannot invent consent after candidate has applied", () => {
  for (const input of [
    { privacyAccepted: false, privacyNoticeVersion: "2026.10", privacyEvidenceReference: "intake-123456" },
    { privacyAccepted: true, privacyNoticeVersion: "", privacyEvidenceReference: "intake-123456" },
    { privacyAccepted: true, privacyNoticeVersion: "2026.10", privacyEvidenceReference: "" },
    { privacyAccepted: "true", privacyNoticeVersion: "2026.10", privacyEvidenceReference: "intake-123456" },
  ]) assert.throws(() => requireApplicantConsent(input), /EVIDENCE_REQUIRED/);
  assert.deepEqual(requireApplicantConsent({ privacyAccepted: true, privacyNoticeVersion: "2026.10", privacyEvidenceReference: "source-123456" }),
    { privacyNoticeVersion: "2026.10", sourceEvidenceReference: "source-123456" });
});
test("six-month candidate retention respects calendar-month ends, hires, holds and resumes", () => {
  assert.equal(sixCalendarMonthsBefore(new Date("2027-03-31T12:00:00Z")).toISOString(), "2026-09-30T12:00:00.000Z");
  const now = new Date("2027-04-12T00:00:00Z");
  const row = { stage: "rejected", hiredEmployeeId: null, rejectedAt: new Date("2026-10-11T23:59:59Z"),
    legalHold: false, purgedAt: null, resumeUrl: null };
  assert.equal(rejectedApplicantCanPurge(row, now), true);
  assert.equal(rejectedApplicantCanPurge({ ...row, rejectedAt: new Date("2026-10-12T00:00:01Z") }, now), false);
  assert.equal(rejectedApplicantCanPurge({ ...row, hiredEmployeeId: 12 }, now), false);
  assert.equal(rejectedApplicantCanPurge({ ...row, legalHold: true }, now), false);
  assert.equal(rejectedApplicantCanPurge({ ...row, resumeUrl: "object://pending-delete" }, now), false);
  assert.equal(rejectedApplicantCanPurge({ ...row, purgedAt: new Date() }, now), false);
});
test("candidate PII erasure preserves only a non-identifying applicant link", () => {
  assert.deepEqual(applicantPiiEraseValues(7), {
    fullName: "Redacted applicant #7", email: "redacted+7@deleted.invalid", phone: null,
    notes: null, resumeUrl: null, offeredSalary: null, rating: 3,
  });
  assert.equal(validApplicantPrivacyDecision("Verified DPO deletion request decision", "DPO-REF-12345"), true);
  assert.equal(validApplicantPrivacyDecision("delete", "DPO-REF-12345"), false);
});
