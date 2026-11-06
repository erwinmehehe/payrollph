import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync("scripts/qa/tenant-staffing-policy-approved-integrity-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-staffing-policy-approved-integrity-http.yml", "utf8");

test("new integrity re-proof refuses non-disposable environments before database import", () => {
  assert.ok(source.indexOf("requireDisposableStaffingWrites();") >= 0);
  assert.ok(source.indexOf("requireDisposableStaffingWrites();") <
    source.indexOf('import("../../src/db/index.ts")'));
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /WORKER_ENABLED: "false"/);
  assert.match(workflow, /PAYMONGO_SECRET_KEY=/);
  assert.match(workflow, /XENDIT_SECRET_KEY=/);
  assert.doesNotMatch(workflow, /vercel deploy|db:migrate:production|npm run deploy/);
});

test("independent PG16 source proves real own success, higher-ID victim and both corruption modes", () => {
  for (const statement of [
    "for (const e of [a, b, victim]) await approve(e)",
    "victim.policy.id > a.policy.id && victim.policy.id > b.policy.id",
    'const foreign = await request(scope(victim, "approved"), { cookie: actor.cookie })',
    'assert.equal(foreign.status, 403',
    'assert.deepEqual(await employerSnapshot(victim), before',
    'set({ contentSha256: "f".repeat(64) })',
    'set({ receiptSha256: "f".repeat(64) })',
    'await db.delete(s.workforceDemandStaffingPolicyEvents)',
    'await verified(e, false, "source_review"',
    'await verified(e, true, "matches_hash"',
    "await unchangedForeign(e, foreignBefore",
    'approvalIntegrity, integrity',
    'foreignAndVictimSqlUnchanged: true',
    'coverageCredits: 0, productionCertified: false',
  ]) assert.ok(source.includes(statement), "Missing exact-head proof dimension: " + statement);
});

test("only the independent real PG16 job emits its receipt, never historical coverage", () => {
  assert.match(workflow, /run: node --import tsx scripts\/qa\/tenant-staffing-policy-approved-integrity-http\.mjs/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.ok(source.includes('result: "PASS"'));
  assert.doesNotMatch(source, /STAFFING_GET_EVIDENCE|verifyStaffingPolicyGetCredit|COVERED/);
});
