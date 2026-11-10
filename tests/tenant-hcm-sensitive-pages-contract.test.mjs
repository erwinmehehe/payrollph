import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, gitBlobSha, verifyHcmPageSources,
  requireFictionalHcmEnv, assertNoTenantLeak, assertOwnMonitor,
  assertOwnHireReview, assertDeniedPage, assertSqlUnchanged,
} from "../scripts/qa/tenant-hcm-sensitive-pages-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_HCM_SSR_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
  TRUSTED_APP_ORIGINS: ORIGIN,
  HCM_PROCESS_MONITOR_ENABLED: "true",
  HCM_PROCESS_MONITOR_ORG_IDS: "8,9,10",
  HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
  NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
  HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: "8,9,10",
  HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
  PILOT_FOCUS_NAV_ENABLED: "false", DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
};
const actor = {
  org: { id: 8 }, marker: "TTBL-A-ONLY", processes: [{ id: 25 }],
  secrets: ["PRIVATE-BANK-A", "PRIVATE-TAX-A"],
};
const victim = {
  org: { id: 10 }, marker: "TTBL-VICTIM-ONLY",
  processes: [{ id: 50 }], secrets: ["PRIVATE-TAX-VICTIM"],
};
const result = (status, text) => ({ status, text });

test("exact source blobs and both SQL employer/resource checks remain sealed", () => {
  assert.equal(verifyHcmPageSources(), true);
  for (const [path, sha] of Object.entries(SOURCE_PINS))
    assert.equal(gitBlobSha(readFileSync(path)), sha, path);
  for (const path of Object.keys(SOURCE_PINS)) {
    const read = name => name === path
      ? Buffer.concat([readFileSync(name), Buffer.from("\n// altered")])
      : readFileSync(name);
    assert.throws(() => verifyHcmPageSources(read), /source changed/);
  }
});

test("unsafe runtime, live provider settings and external databases fail closed", () => {
  assert.equal(requireFictionalHcmEnv(safe), true);
  for (const key of Object.keys(safe)) {
    const changed = { ...safe }; delete changed[key];
    assert.throws(() => requireFictionalHcmEnv(changed), /unsafe or missing/);
  }
  for (const [key, val] of [
    ["DATABASE_URL", "postgresql://postgres:postgres@production.example.com:5432/app_db"],
    ["APP_BASE_URL", "https://example.com"],
    ["TENANT_HCM_SSR_PROOF", "production"],
    ["PAYMONGO_SECRET_KEY", "not-an-actual-credential"],
    ["XENDIT_PAYOUT_SECRET_KEY", "not-an-actual-credential"],
    ["OPENAI_API_KEY", "not-an-actual-credential"],
    ["VERCEL", "1"],
  ]) assert.throws(() => requireFictionalHcmEnv({ ...safe, [key]: val }));
});

test("fake 200 and empty page shells are not evidence of own HCM records", () => {
  const monitor = "Business Process Monitor Employer #8 Recorded workflows Step timeline Hire #25 Step 1";
  const hire = "Hire-to-payroll input evidence Employer #8 Worker #4 Current employment record Payroll basis and standard hours Payroll approval, filing and payout";
  assert.throws(() => assertOwnMonitor(result(200, "Business Process Monitor"), actor,
    actor.processes[0], [actor, victim]));
  assert.throws(() => assertOwnMonitor(result(200,
    monitor + " Workflow source unavailable"), actor, actor.processes[0], [actor, victim]));
  assert.doesNotThrow(() => assertOwnMonitor(result(200, monitor),
    actor, actor.processes[0], [actor, victim]));
  assert.throws(() => assertOwnHireReview(result(200, "Hire-to-payroll input evidence"),
    actor, { id: 4 }, [actor, victim]));
  assert.throws(() => assertOwnHireReview(result(200,
    hire + " The input sources are temporarily unavailable"),
    actor, { id: 4 }, [actor, victim]));
  assert.doesNotThrow(() => assertOwnHireReview(result(200, hire),
    actor, { id: 4 }, [actor, victim]));
});

test("foreign body, source note, successful denial and foreign process are refused", () => {
  assert.throws(() => assertNoTenantLeak(result(404, victim.marker),
    [actor, victim], "foreign marker", actor));
  assert.throws(() => assertNoTenantLeak(result(404, victim.secrets[0]),
    [actor, victim], "foreign source", actor));
  assert.throws(() => assertNoTenantLeak(result(200, actor.secrets[0]),
    [actor, victim], "private field", actor));
  assert.throws(() => assertDeniedPage(result(200, "empty"), [actor, victim], "fake denial"));
  assert.throws(() => assertDeniedPage(result(404, "Hire #50"), [actor, victim], "leaked process"));
  assert.doesNotThrow(() => assertDeniedPage(result(404, "Not Found"),
    [actor, victim], "real empty denial"));
});

test("any employer, payroll or audit SQL mutation invalidates read-only proof", () => {
  const before = { process: [{ id: 25 }], employee: [{ id: 4 }], audit: [] };
  assert.doesNotThrow(() => assertSqlUnchanged(before, structuredClone(before), "legit"));
  assert.throws(() => assertSqlUnchanged(before,
    { ...before, audit: [{ id: 1 }] }, "changed audit"));
  assert.throws(() => assertSqlUnchanged(before,
    { ...before, employee: [{ id: 5 }] }, "changed employee"));
});

test("workflow runner cannot be mistaken for method or production acceptance", () => {
  const runner = readFileSync("scripts/qa/tenant-hcm-sensitive-pages-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-hcm-sensitive-pages-qa.yml", "utf8");
  const docs = readFileSync("docs/qa/tenant-hcm-sensitive-pages-isolation.md", "utf8");
  assert.match(runner, /requireFictionalHcmEnv\(\);[\s\S]*verifyHcmPageSources\(\);[\s\S]*import\("\.\.\/\.\.\/src\/db\/index\.ts"\)/);
  assert.match(runner, /SHOW server_version_num/);
  assert.match(runner, /fixture\.seedEmployer/);
  assert.match(runner, /assertOwnMonitor\(/);
  assert.match(runner, /assertOwnHireReview\(/);
  assert.match(runner, /await snapshot\(actor\.org\.id\)/);
  assert.match(runner, /revokedMembershipDeniedWithValidSession: true/);
  assert.match(runner, /methodCredits: 0, pageActionCredits: 0/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-sensitive-pages-http\.mjs/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(docs, /ZERO credits/);
  assert.match(docs, /NOT ACCEPTED/);
});
