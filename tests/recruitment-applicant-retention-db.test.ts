import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  applicantPrivacyEvidence, auditEvents, jobApplicants, jobRequisitions, organizations, users,
} from "../src/db/schema";
const require = createRequire(import.meta.url);

test("bounded six-month purge skips retained resumes without starving eligible rows, respects holds and is idempotent", async () => {
  const suffix = randomUUID().slice(0, 10);
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(url.hostname, "127.0.0.1", "Disposable loopback PostgreSQL only");
  assert.equal(url.pathname, "/app_db");
  const schema = "qa_applicant_" + randomUUID().replaceAll("-", "");
  const pool = new Pool({ connectionString: url.toString(), application_name: schema, options: `-c search_path=${schema},public` });
  const db = drizzle(pool);
  await pool.query(`CREATE SCHEMA ${schema}`);
  const dbId = require.resolve("../src/db"), originalDb = require(dbId);
  const restorers: Array<() => void> = [];
  function patch(path: string, overrides: Record<string, unknown>) {
    const id = require.resolve(path), original = require(id);
    require.cache[id]!.exports = { ...original, ...overrides };
    restorers.push(() => { require.cache[id]!.exports = original; });
  }
  try {
    for (const table of ["organizations", "users", "job_requisitions", "job_applicants", "audit_events"]) {
      await pool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
      await pool.query(`ALTER TABLE ${schema}.${table} ADD PRIMARY KEY (id)`);
    }
    // Actual proposal executed twice against disposable, schema-qualified sources.
    const proposal = readFileSync("docs/engineering/migration-proposals/recruitment-applicant-privacy.sql", "utf8");
    for (let repeat = 0; repeat < 2; repeat++) await pool.query(proposal);
    require.cache[dbId]!.exports = { ...originalDb, db };
    const { purgeExpiredRejectedApplicants } = await import("../src/lib/recruitment-applicant-retention");
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
    process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = "false";
    assert.deepEqual(await purgeExpiredRejectedApplicants(new Date()), { purged: 0, enabled: false });
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
      { organizationId: alpha.id, applicantId: unresolvedResume.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-001",
        consentCapturedAt: oldDate, rejectedAt: oldDate },
      { organizationId: alpha.id, applicantId: held.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-002",
        consentCapturedAt: oldDate, rejectedAt: oldDate, legalHold: true },
      { organizationId: alpha.id, applicantId: eligible.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-003",
        consentCapturedAt: oldDate, rejectedAt: oldDate },
      { organizationId: beta.id, applicantId: otherEmployer.id, legalBasis: "consent",
        privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-direct-004",
        consentCapturedAt: oldDate, rejectedAt: new Date("2026-12-01T00:00:00Z") },
    ]);
    process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = "true";
    const now = new Date("2027-04-12T00:00:00Z");
    const calls = await Promise.all([
      purgeExpiredRejectedApplicants(now, 1),
      purgeExpiredRejectedApplicants(now, 1),
    ]);
    assert.equal(calls.reduce((n, row) => n + row.purged, 0), 1);
    assert.equal((await purgeExpiredRejectedApplicants(now)).purged, 0);
    const [removed] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, eligible.id));
    assert.equal(removed.email, "redacted+" + eligible.id + "@deleted.invalid");
    assert.equal(removed.fullName, "Redacted applicant #" + eligible.id);
    assert.equal(removed.notes, null);
    const [erasedEvidence] = await db.select().from(applicantPrivacyEvidence).where(eq(applicantPrivacyEvidence.applicantId, eligible.id));
    assert.equal(erasedEvidence.sourceEvidenceReference, "erased");
    assert.equal(erasedEvidence.deletionReason, null);
    await assert.rejects(db.insert(applicantPrivacyEvidence).values({
      organizationId: beta.id, applicantId: eligible.id, legalBasis: "consent",
      privacyNoticeVersion: "2026.10", sourceEvidenceReference: "wrong-employer-evidence",
      consentCapturedAt: oldDate,
    }), "Composite employer FK rejects a foreign candidate");
    const retained = await db.select().from(jobApplicants).where(and(
      eq(jobApplicants.organizationId, alpha.id), eq(jobApplicants.stage, "rejected"),
    ));
    assert.ok(retained.find(x => x.id === held.id && x.email.includes("candidate-2-")));
    assert.ok(retained.find(x => x.id === unresolvedResume.id && x.resumeUrl !== null));
    const [betaCandidate] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, otherEmployer.id));
    assert.ok(betaCandidate.email.includes("candidate-4-"));

    // A concurrently committed legal hold must win before retention erases PII.
    const [racing] = await db.insert(jobApplicants).values(applicantValues(alpha.id, ra.id, 5)).returning();
    await db.insert(applicantPrivacyEvidence).values({ organizationId: alpha.id, applicantId: racing.id,
      legalBasis: "consent", privacyNoticeVersion: "2026.10", sourceEvidenceReference: "synthetic-hold-race",
      consentCapturedAt: oldDate, rejectedAt: oldDate });
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("UPDATE applicant_privacy_evidence SET legal_hold=true WHERE applicant_id=$1", [racing.id]);
      const purge = purgeExpiredRejectedApplicants(now);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema]);
        if (rows.length) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(blocked, true, "Retention actually waits on the evidence-row lock");
      await locker.query("COMMIT");
      assert.equal((await purge).purged, 0);
      const [protectedRow] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, racing.id));
      assert.ok(protectedRow.email.includes("candidate-5-"));
    } finally { await locker.query("ROLLBACK"); locker.release(); }

    const [maker, checker] = await db.insert(users).values([
      { email: `maker-${suffix}@example.invalid`, name: "Synthetic maker", passwordHash: "unusable-fixture" },
      { email: `checker-${suffix}@example.invalid`, name: "Synthetic checker", passwordHash: "unusable-fixture" },
    ]).returning();
    let actor = maker;
    patch("../src/lib/auth", { getSessionUser: async () => actor });
    patch("../src/lib/access", { assertOrganizationRole: async () => null, getAccess: async () => ({ companyWide: true }) });
    patch("../src/lib/security-request", { requireSensitiveActionMfa: () => null, enforceSensitiveActionRateLimit: async () => null });
    const route = await import("../src/app/api/recruitment/privacy/route");
    const mutate = (action: string, organizationId = beta.id, applicantId = otherEmployer.id) => new Request("https://example.test/api/recruitment/privacy", {
      method: "PATCH", headers: { "content-type": "application/json", origin: "https://example.test", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ organizationId, applicantId, action,
        reason: "Sensitive fictional candidate identity deletion request",
        approvalReason: "Sensitive fictional candidate reviewed decision", reviewEvidenceReference: "private-subject-reference" }),
    });
    assert.equal((await route.PATCH(mutate("erase"))).status, 409);
    assert.equal((await route.PATCH(mutate("request_delete"))).status, 200);
    assert.equal((await route.PATCH(mutate("approve_delete"))).status, 409, "Maker cannot self-approve");
    actor = checker;
    assert.equal((await route.PATCH(mutate("approve_delete"))).status, 200);
    assert.equal((await route.PATCH(mutate("erase", alpha.id))).status, 404, "Foreign employer cannot target candidate");
    assert.equal((await route.PATCH(mutate("erase"))).status, 200);
    assert.equal((await route.GET(new Request(`https://example.test/api/recruitment/privacy?organizationId=${beta.id}&applicantId=${otherEmployer.id}`))).status, 404);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, beta.id));
    assert.equal(JSON.stringify(events).includes("Sensitive fictional"), false);
    assert.equal(JSON.stringify(events).includes("private-subject-reference"), false);
    await db.update(jobApplicants).set({ hiredAt: oldDate }).where(eq(jobApplicants.id, held.id));
    await db.update(applicantPrivacyEvidence).set({ legalHold: false }).where(eq(applicantPrivacyEvidence.applicantId, held.id));
    assert.equal((await route.PATCH(mutate("request_delete", alpha.id, held.id))).status, 409, "Historic hired linkage survives employee FK removal");
  } finally {
    for (const restore of restorers.reverse()) restore();
    if (oldFlag == null) delete process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED;
    else process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = oldFlag;
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
  } finally {
    require.cache[dbId]!.exports = originalDb;
    // Only this generated, loopback-only fixture schema is removed.
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});
