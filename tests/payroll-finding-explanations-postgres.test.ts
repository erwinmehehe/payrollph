import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { legalEntities, organizations, payrollRuns, users, userOrganizations } from "../src/db/schema";

const require = createRequire(import.meta.url);
// The route test needs only synthetic loopback PostgreSQL. It never contacts
// a model, external bank, external provider, Neon, or production database.
const disposable = (() => {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI !== "true" || !raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "postgresql:" && url.hostname === "127.0.0.1"
      && url.port === "5432" && url.pathname === "/app_db"
      && url.username === "postgres" && url.password === "postgres"
      && !url.search && !url.hash;
  } catch {
    return false;
  }
})();

test("real guarded pre-run GET: flag-off bytes unchanged, consent denied, opt-in code-only text, foreign denied", {
  skip: !disposable, timeout: 60_000,
}, async () => {
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) {
    assert.notEqual(process.env[key], "true", key + " must remain disabled in isolated evidence");
  }

  const keys = [
    "PAYROLL_EXPLANATION_AI_ENABLED", "OPENAI_AUTOMATION_DRAFT_ENABLED",
    "OPENAI_API_KEY", "OPENAI_AUTOMATION_DPA_CONFIRMED",
    "OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED", "OPENAI_AUTOMATION_NOTICE_CONFIRMED",
    "OPENAI_AUTOMATION_APPROVED_ORG_IDS", "MULTI_ENTITY_ENABLED",
  ] as const;
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]])) as
    Record<typeof keys[number], string | undefined>;
  const restore = () => {
    for (const key of keys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  };
  const nonce = randomUUID().slice(0, 12);
  const [own, foreign] = await db.insert(organizations).values([
    { name: "Fictional Explanation Own " + nonce, legalName: "Fictional Own " + nonce },
    { name: "Fictional Explanation Foreign " + nonce, legalName: "Fictional Foreign " + nonce },
  ]).returning({ id: organizations.id });
  let userId: number | undefined;
  try {
    const [legalOwn, legalForeign] = await db.insert(legalEntities).values([
      { organizationId: own.id, code: "FICTOWN", legalName: "Fictional Own",
        displayName: "Fictional Own", primaryEntity: true },
      { organizationId: foreign.id, code: "FICTFOREIGN", legalName: "Fictional Foreign",
        displayName: "Fictional Foreign", primaryEntity: true },
    ]).returning({ id: legalEntities.id });
    const [run, victimRun] = await db.insert(payrollRuns).values([
      { organizationId: own.id, legalEntityId: legalOwn.id,
        periodLabel: "Fictional read-only no entries", periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-20", status: "Draft" },
      { organizationId: foreign.id, legalEntityId: legalForeign.id,
        periodLabel: "Fictional private other employer", periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-20", status: "Draft" },
    ]).returning();
    const [owner] = await db.insert(users).values({
      email: "explanation-" + nonce + "@example.invalid", name: "Fictional payroll owner",
      passwordHash: "fixture-not-a-login", role: "owner",
    }).returning();
    userId = owner.id;
    await db.insert(userOrganizations).values({
      organizationId: own.id, userId: owner.id, role: "owner", active: true,
    });

    const authPath = require.resolve("../src/lib/auth.ts");
    const originalAuth = require(authPath);
    const cache = require.cache[authPath]!;
    const originalExports = cache.exports;
    let caller: typeof owner | null = owner;
    cache.exports = { ...originalAuth, getSessionUser: async () => caller };
    try {
      process.env.MULTI_ENTITY_ENABLED = "false";
      const { GET } = await import("../src/app/api/payroll-runs/[id]/pre-run-readiness/route");
      const { loadPayrollPreRunReadiness } = await import("../src/lib/payroll-pre-run-readiness-server");
      const request = (id: number, query = "") =>
        new Request(`http://127.0.0.1:3000/api/payroll-runs/${id}/pre-run-readiness${query}`);
      const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

      const before = await db.select().from(payrollRuns).where(inArray(payrollRuns.id, [run.id, victimRun.id]));
      process.env.PAYROLL_EXPLANATION_AI_ENABLED = "false";
      const expected = JSON.stringify(await loadPayrollPreRunReadiness(run));
      const baseline = await GET(request(run.id), params(run.id));
      assert.equal(baseline.status, 200);
      assert.equal(await baseline.text(), expected, "default-off GET payload must be byte-identical");
      const requestedOff = await GET(request(run.id, "?explain=true"), params(run.id));
      assert.equal(requestedOff.status, 200);
      assert.equal(await requestedOff.text(), expected,
        "flag-off cannot append text even when the caller requests an explanation");

      process.env.PAYROLL_EXPLANATION_AI_ENABLED = "true";
      process.env.OPENAI_AUTOMATION_APPROVED_ORG_IDS = "";
      const noConsent = await GET(request(run.id, "?explain=true"), params(run.id));
      assert.equal(noConsent.status, 403);
      assert.equal((await noConsent.json()).error, "PAYROLL_EXPLANATION_CONSENT_REQUIRED");
      assert.equal((await GET(request(run.id), params(run.id))).status, 200,
        "the original readiness read remains available without optional explanation consent");

      // Dummy env values are isolated-fixture consent cases, NOT a contract
      // attestation or a real API credential. The adapter makes no model call.
      process.env.OPENAI_AUTOMATION_DRAFT_ENABLED = "true";
      process.env.OPENAI_API_KEY = "fictional-not-valid-never-used";
      process.env.OPENAI_AUTOMATION_DPA_CONFIRMED = "true";
      process.env.OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED = "true";
      process.env.OPENAI_AUTOMATION_NOTICE_CONFIRMED = "true";
      process.env.OPENAI_AUTOMATION_APPROVED_ORG_IDS = String(foreign.id);
      assert.equal((await GET(request(run.id, "?explain=true"), params(run.id))).status, 403,
        "other tenant's allowlist membership cannot authorize the owner tenant");
      process.env.OPENAI_AUTOMATION_APPROVED_ORG_IDS = String(own.id);
      const allowed = await GET(request(run.id, "?explain=true"), params(run.id));
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get("cache-control"), "private, no-store");
      const data = await allowed.json() as {
        organizationId: number; runId: number;
        findings: Array<{ code: string; blocking?: boolean }>; explanation: string;
      };
      assert.equal(data.organizationId, own.id);
      assert.equal(data.runId, run.id);
      assert.deepEqual(data.findings, JSON.parse(expected).findings,
        "explanation must never replace or reinterpret original PRERUN findings");
      assert.match(data.explanation, /\[PRERUN_NO_EMPLOYEES\]/);
      assert.match(data.explanation, /\[INCOMPLETE_PAYROLL_RUN\]/);
      assert.ok(!data.explanation.includes("Fictional Explanation Foreign"));

      const foreignAttempt = await GET(request(victimRun.id, "?explain=true"), params(victimRun.id));
      assert.equal(foreignAttempt.status, 403,
        "tenant access denial runs before explanation consent or source reads");
      caller = null;
      assert.equal((await GET(request(run.id, "?explain=true"), params(run.id))).status, 401);

      const after = await db.select().from(payrollRuns).where(inArray(payrollRuns.id, [run.id, victimRun.id]));
      assert.deepEqual(after, before, "no payroll state is written by any explanation path");
    } finally {
      cache.exports = originalExports;
    }
  } finally {
    restore();
    await db.delete(organizations).where(inArray(organizations.id, [own.id, foreign.id]));
    if (userId !== undefined) await db.delete(users).where(eq(users.id, userId));
  }
});
