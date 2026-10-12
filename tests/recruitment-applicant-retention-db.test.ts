import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  applicantPrivacyEvidence, jobApplicants, jobRequisitions, organizations,
} from "../src/db/schema";
import { purgeExpiredRejectedApplicants } from "../src/lib/recruitment-applicant-retention";

test("six-month scheduled purge is employer isolated, idempotent and respects holds/retained resumes", async () => {
  const suffix = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Privacy A " + suffix, legalName: "Privacy A " + suffix },
    { name: "Privacy B " + suffix, legalName: "Privacy B " + suffix },
  ]).returning();
  const oldFlag = process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED;
  try {
    const [ra, rb] = await db.insert(jobRequisitions).values([
      { organizationId: alpha.id, title: "Synthetic associate", department: "QA" },
      { organizationId: beta.id, title: "Synthetic associate", department: "QA" },
    ]).returning();
    const applicantValues = (organizationId: number, requisitionId: number, index: number, resumeUrl: string | null = null) => ({
      organizationId, requisitionId, fullName: "Synthetic Candidate " + index,
      email: `candidate-${index}-${suffix}@example.invalid`, stage: "rejected" as const,
      notes: "Synthetic privacy fixture", resumeUrl,
    });
    const [eligible, held, unresolvedResume, otherEmployer] = await db.insert(jobApplicants).values([
      applicantValues(alpha.id, ra.id, 1),
      applicantValues(alpha.id, ra.id, 2),
      applicantValues(alpha.id, ra.id, 3, "private-documents/unverified-resume"),
      applicantValues(beta.id, rb.id, 4),
    ]).returning();
    const oldDate = new Date("2026-09-30T00:00:00Z");
    await db.insert(applicantPrivacyEvidence).values([
      { organizationId: alpha.id, applicantId: eligible.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-001",
        consentCapturedAt: oldDate, rejectedAt: oldDate },
      { organizationId: alpha.id, applicantId: held.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-002",
        consentCapturedAt: oldDate, rejectedAt: oldDate, legalHold: true },
      { organizationId: alpha.id, applicantId: unresolvedResume.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-003",
        consentCapturedAt: oldDate, rejectedAt: oldDate },
      { organizationId: beta.id, applicantId: otherEmployer.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-004",
        consentCapturedAt: oldDate, rejectedAt: new Date("2026-12-01T00:00:00Z") },
    ]);
    process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = "true";
    const now = new Date("2027-04-12T00:00:00Z");
    const calls = await Promise.all([
      purgeExpiredRejectedApplicants(now),
      purgeExpiredRejectedApplicants(now),
    ]);
    assert.equal(calls.reduce((n, row) => n + row.purged, 0), 1);
    assert.equal((await purgeExpiredRejectedApplicants(now)).purged, 0);
    const [removed] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, eligible.id));
    assert.equal(removed.email, "redacted+" + eligible.id + "@deleted.invalid");
    assert.equal(removed.fullName, "Redacted applicant #" + eligible.id);
    assert.equal(removed.notes, null);
    const retained = await db.select().from(jobApplicants).where(and(
      eq(jobApplicants.organizationId, alpha.id), eq(jobApplicants.stage, "rejected"),
    ));
    assert.ok(retained.find(x => x.id === held.id && x.email.includes("candidate-2-")));
    assert.ok(retained.find(x => x.id === unresolvedResume.id && x.resumeUrl !== null));
    const [betaCandidate] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, otherEmployer.id));
    assert.ok(betaCandidate.email.includes("candidate-4-"));
  } finally {
    if (oldFlag == null) delete process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED;
    else process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = oldFlag;
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
