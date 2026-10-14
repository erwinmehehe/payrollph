import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import {
  applicantPrivacyEvidence, auditEvents, jobApplicants, jobRequisitions,
  organizations, positions,
} from "../src/db/schema";

const require = createRequire(import.meta.url);

/** Real PostgreSQL on a generated local-only schema; private data, live
 * employer migrations, and external proof/scanner services are never touched.
 * The independent #925 tests certify the actual composite FK and retention.
 */
test("public careers is consent-bound, isolated by employer, race-safe and HR-only", async () => {
  const url = new URL(process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/app_db");
  const schema = "qa_careers_" + randomUUID().replaceAll("-", "");
  const pool = new Pool({
    connectionString: url.toString(),
    options: `-c search_path=${schema},public`,
  });
  const db = drizzle(pool);
  await pool.query(`create schema ${schema}`);
  const dbPath = require.resolve("../src/db");
  const originalDb = require(dbPath);
  const restorers: Array<() => void> = [];
  function patch(path: string, fields: Record<string, unknown>) {
    const resolved = require.resolve(path);
    const original = require(resolved);
    require.cache[resolved]!.exports = { ...original, ...fields };
    restorers.push(() => { require.cache[resolved]!.exports = original; });
  }
  const keys = [
    "RECRUITMENT_JOURNEY_UI_ENABLED", "APPLICANT_PRIVACY_CONTROLS_ENABLED",
    "PUBLIC_INTAKE_PROOF_ENABLED", "MULTI_ENTITY_ENABLED",
    "CAREERS_PRIVACY_NOTICE_VERSION", "CAREERS_PRIVACY_NOTICE_URL",
  ];
  const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  type Actor = { id: number; name: string; organizationId: number; role: string; companyWide: boolean };
  let actor: Actor | null = null;
  let mfaDenied = false;
  let rateMode: "distributed-postgres" | "single-instance" = "distributed-postgres";
  let rateAllowed = true;
  const claims = new Set<string>();
  try {
    // Older mainline schema is provisioned by CI db:push. The careers column
    // MUST NOT be needed by default-OFF legacy queries.
    for (const table of ["organizations", "positions", "job_requisitions",
      "job_applicants", "applicant_privacy_evidence", "audit_events"]) {
      await pool.query(`create table ${schema}.${table}
        (like public.${table} including defaults including constraints)`);
      await pool.query(`alter table ${schema}.${table} add primary key (id)`);
    }
    require.cache[dbPath]!.exports = { ...originalDb, db, pool };
    patch("../src/lib/auth", { getSessionUser: async () => actor });
    patch("../src/lib/access", {
      getAccess: async (_id: number, org: number) =>
        actor && actor.organizationId === org
          ? { role: actor.role, companyWide: actor.companyWide, orgUnitId: null } : null,
      assertOrganizationRole: async (_id: number, org: number, allowed: readonly string[]) =>
        actor && actor.organizationId === org && allowed.includes(actor.role)
          ? null : Response.json({ error: "Outside assigned recruitment role." }, { status: 403 }),
    });
    patch("../src/lib/security-request", {
      requireSensitiveActionMfa: () =>
        mfaDenied ? Response.json({ error: "MFA_REQUIRED" }, { status: 403 }) : null,
    });
    patch("../src/lib/rate-limit", {
      rateLimitDistributed: async () => ({
        allowed: rateAllowed, mode: rateMode, remaining: 1,
        retryAfterMs: 3000,
      }),
    });
    patch("../src/lib/public-intake-proof-server", {
      enforceIntakeProof: async (body: Record<string, unknown>) => {
        const token = (body.intakeProof as { token?: string } | undefined)?.token;
        if (!token || claims.has(token)) return Response.json(
          { error: "Proof missing or already used." }, { status: 422 });
        claims.add(token);
        return null;
      },
    });
    Object.assign(process.env, {
      RECRUITMENT_JOURNEY_UI_ENABLED: "true",
      APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
      PUBLIC_INTAKE_PROOF_ENABLED: "true",
      MULTI_ENTITY_ENABLED: "false",
      CAREERS_PRIVACY_NOTICE_VERSION: "2026.10",
      CAREERS_PRIVACY_NOTICE_URL: "https://example.invalid/privacy/recruitment",
    });
    const pub = await import("../src/app/api/careers/route");
    const admin = await import("../src/app/api/careers/admin/route");
    const recruiting = await import("../src/app/api/recruitment/route");

    const [orgA, orgB] = await db.insert(organizations).values([
      { name: "Fictional Alpha", legalName: "Fictional Alpha Inc." },
      { name: "Fictional Beta", legalName: "Fictional Beta Inc." },
    ]).returning();
    const [positionA, positionB, positionClosed] = await db.insert(positions).values([
      { organizationId: orgA.id, code: "CAREERS-A", jobProfileId: 1, status: "open" },
      { organizationId: orgB.id, code: "CAREERS-B", jobProfileId: 1, status: "open" },
      { organizationId: orgA.id, code: "CAREERS-CLOSED", jobProfileId: 1, status: "filled" },
    ]).returning();
    const [jobA, jobB, jobClosed] = await db.insert(jobRequisitions).values([
      { organizationId: orgA.id, positionId: positionA.id, title: "Private Payroll Clerk", department: "Alpha HR" },
      { organizationId: orgB.id, positionId: positionB.id, title: "Other Company Role", department: "Beta HR" },
      { organizationId: orgA.id, positionId: positionClosed.id, title: "Closed Role", department: "Alpha HR" },
    ]).returning();

    const adminRequest = (organizationId: number, requisitionId: number,
      published: boolean, expectedPublished: boolean, origin = "https://example.invalid") =>
      new Request("https://example.invalid/api/careers/admin", {
        method: "PATCH",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ organizationId, requisitionId, published, expectedPublished }),
      });
    const publicGet = (organizationId: number) =>
      new Request("https://example.invalid/api/careers?organizationId=" + organizationId);
    const apply = (organizationId: number, requisitionId: number, email: string,
      token: string, extra: Record<string, unknown> = {}) =>
      new Request("https://example.invalid/api/careers", {
        method: "POST",
        headers: { origin: "https://example.invalid", "content-type": "application/json" },
        body: JSON.stringify({ organizationId, requisitionId,
          fullName: "Fictional Application", email, consent: true,
          privacyNoticeVersion: "2026.10", intakeProof: { token }, ...extra }),
      });

    actor = { id: 7001, name: "Fictional HR", organizationId: orgA.id,
      role: "hr", companyWide: true };

    // OFF legacy schema: shared ORM reads do not query an unapplied careers column.
    process.env.RECRUITMENT_JOURNEY_UI_ENABLED = "false";
    const off = await recruiting.GET(new Request(
      "https://example.invalid/api/recruitment?organizationId=" + orgA.id));
    assert.equal(off.status, 200);
    const offPayload = await off.json();
    assert.equal("careersPublished" in offPayload.requisitions[0], false);
    assert.equal("careersPublishingReady" in offPayload, false);
    assert.equal(offPayload.privacyConsentRequired, true);
    process.env.RECRUITMENT_JOURNEY_UI_ENABLED = "true";
    // Flag ON with no careers migration stays closed, without touching candidates.
    assert.equal((await pub.GET(publicGet(orgA.id))).status, 503);
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 503);
    const sqlProposal = readFileSync("docs/engineering/migration-proposals/careers-published.sql", "utf8");
    await pool.query(sqlProposal);
    await pool.query(sqlProposal); // isolated idempotency, not a numbered release receipt
    assert.equal((await pub.GET(publicGet(orgA.id))).status, 200);

    actor = null;
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 401);
    actor = { id: 7002, name: "Bookkeeping", organizationId: orgA.id,
      role: "bookkeeper", companyWide: true };
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 403);
    actor = { id: 7003, name: "Unit HR", organizationId: orgA.id, role: "hr", companyWide: false };
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 403);
    actor = { id: 7001, name: "Fictional HR", organizationId: orgA.id, role: "hr", companyWide: true };
    mfaDenied = true;
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 403);
    mfaDenied = false;
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false,
      "https://foreign.invalid"))).status, 403);
    assert.equal((await admin.PATCH(adminRequest(orgB.id, jobB.id, true, false))).status, 403);
    rateMode = "single-instance";
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 503);
    rateMode = "distributed-postgres";
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobClosed.id, true, false))).status, 409);
    const publish = await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false));
    assert.equal(publish.status, 200);
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 409,
      "Stale publish must not produce a second audit");
    const [publishAudit] = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, orgA.id),
      eq(auditEvents.action, "Careers requisition published"),
    ));
    assert.ok(publishAudit);
    assert.equal((await db.select().from(auditEvents).where(eq(
      auditEvents.action, "Careers requisition published"))).length, 1);

    actor = { id: 8001, name: "Beta HR", organizationId: orgB.id,
      role: "hr", companyWide: true };
    assert.equal((await admin.PATCH(adminRequest(orgB.id, jobB.id, true, false))).status, 200);
    const alphaPublic = await (await pub.GET(publicGet(orgA.id))).json();
    assert.deepEqual(alphaPublic.jobs.map((j: { id: number }) => j.id), [jobA.id]);
    assert.equal(JSON.stringify(alphaPublic).includes("Other Company Role"), false);
    assert.equal(JSON.stringify(alphaPublic).includes("Closed Role"), false);

    actor = { id: 7001, name: "Fictional HR", organizationId: orgA.id,
      role: "hr", companyWide: true };
    const after = await (await recruiting.GET(new Request(
      "https://example.invalid/api/recruitment?organizationId=" + orgA.id))).json();
    assert.equal(after.careersPublishingReady, true);
    assert.equal(after.requisitions.find((r: {id:number})=>r.id === jobA.id).careersPublished, true);

    rateMode = "single-instance";
    assert.equal((await pub.POST(apply(orgA.id, jobA.id, "a@example.invalid", "proof-0"))).status, 503);
    rateMode = "distributed-postgres";
    assert.equal((await pub.POST(apply(orgA.id, jobA.id, "a@example.invalid", "proof-1",
      { consent: false }))).status, 422);
    assert.equal((await pub.POST(apply(orgA.id, jobA.id, "a@example.invalid", "proof-2",
      { privacyNoticeVersion: "different" }))).status, 422);
    assert.equal((await pub.POST(apply(orgA.id, jobA.id, "a@example.invalid", ""))).status, 422);
    const accepted = await pub.POST(apply(orgA.id, jobA.id, "a@example.invalid", "proof-3"));
    assert.equal(accepted.status, 202);
    assert.equal((await pub.POST(apply(orgA.id, jobA.id, "a@example.invalid", "proof-4"))).status, 202,
      "Public callers must not enumerate applicants by response status");
    const candidates = await db.select().from(jobApplicants).where(and(
      eq(jobApplicants.organizationId, orgA.id),
      eq(jobApplicants.requisitionId, jobA.id),
    ));
    assert.equal(candidates.length, 1);
    const [evidence] = await db.select().from(applicantPrivacyEvidence).where(
      eq(applicantPrivacyEvidence.applicantId, candidates[0].id));
    assert.equal(evidence.legalBasis, "consent");
    assert.equal(evidence.privacyNoticeVersion, "2026.10");
    assert.match(evidence.sourceEvidenceReference, /^careers-web:/);
    assert.ok(evidence.consentCapturedAt instanceof Date);
    const candidateAudit = await db.select().from(auditEvents).where(eq(
      auditEvents.action, "Published careers application received"));
    assert.equal(candidateAudit.length, 1);
    assert.equal(JSON.stringify(candidateAudit).includes("a@example.invalid"), false);
    assert.equal(JSON.stringify(candidateAudit).includes("Fictional Application"), false);
    assert.equal((await pub.POST(apply(orgA.id, jobB.id, "other@example.invalid", "proof-5"))).status, 404);

    // A closing role is never newly published, but HR can withdraw a stale
    // published job even after its position has changed status.
    await db.update(jobRequisitions).set({ status: "filled" }).where(eq(jobRequisitions.id, jobA.id));
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, false, true))).status, 200);
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 409);
    assert.deepEqual((await (await pub.GET(publicGet(orgA.id))).json()).jobs, []);
    assert.equal((await pub.POST(apply(orgA.id, jobA.id, "new@example.invalid", "proof-6"))).status, 404);

    // Public API cannot partially retain PII if its required audit rejects.
    await db.update(jobRequisitions).set({ status: "open" }).where(eq(jobRequisitions.id, jobA.id));
    assert.equal((await admin.PATCH(adminRequest(orgA.id, jobA.id, true, false))).status, 200);
    await pool.query(`create function ${schema}.deny_careers_audit() returns trigger language plpgsql
      as $$ begin if new.action = 'Published careers application received'
      then raise exception 'synthetic careers audit failure'; end if; return new; end $$`);
    await pool.query(`create trigger deny_careers_audit before insert on ${schema}.audit_events
      for each row execute function ${schema}.deny_careers_audit()`);
    await assert.rejects(pub.POST(apply(orgA.id, jobA.id, "fail@example.invalid", "proof-7")));
    assert.equal((await db.select().from(jobApplicants).where(eq(
      jobApplicants.email, "fail@example.invalid"))).length, 0);
    assert.equal((await db.select().from(applicantPrivacyEvidence)).length, 1);
  } finally {
    for (const restore of restorers.reverse()) restore();
    require.cache[dbPath]!.exports = originalDb;
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await pool.query(`drop schema if exists ${schema} cascade`).catch(() => {});
    await pool.end();
  }
});
