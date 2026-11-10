import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, PAGE, SOURCE_PINS, requireDisposableHireReviewEnv,
  verifyHireReviewSourcePins, blobSha, assertOwnedHirePage, assertDeniedHirePage,
} from "../scripts/qa/tenant-hire-payroll-review-contract.mjs";

const runner = readFileSync("scripts/qa/tenant-hire-payroll-review-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-hire-payroll-review-qa.yml", "utf8");

function validEnv() {
  return {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_HIRE_REVIEW_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
    NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
    HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: "1,2,3",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  };
}

test("fictional proof cannot run against production or provider credentials", () => {
  assert.equal(PAGE, "/hcm/hire-payroll-review");
  assert.doesNotThrow(() => requireDisposableHireReviewEnv(validEnv()));
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.production.invalid/payroll"],
    ["APP_BASE_URL", "https://app.example.invalid"],
    ["WORKER_ENABLED", "true"],
    ["HCM_HIRE_PAYROLL_REVIEW_ORG_IDS", "1,2"],
    ["NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED", "false"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "sk_synthetic_deny"],
    ["OPENAI_API_KEY", "forbidden"],
  ]) assert.throws(
    () => requireDisposableHireReviewEnv({ ...validEnv(), [key]: value }),
    "Unsafe environment must never run HTTP fixture: " + key,
  );
  assert.ok(runner.indexOf("requireDisposableHireReviewEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "No DB/application import before source/environment refusal");
  assert.ok(runner.indexOf("verifyHireReviewSourcePins();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "Changed source must refuse before DB import");
});

test("source pins and authorization order cannot be silently altered", () => {
  assert.ok(Object.keys(SOURCE_PINS).length >= 10, "Pin original critical source and fixture");
  for (const [path, expected] of Object.entries(SOURCE_PINS))
    assert.equal(blobSha(readFileSync(path)), expected, "Unreviewed source drift: " + path);
  assert.equal(verifyHireReviewSourcePins(), true);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hire-payroll-review-http\.mjs/);
  assert.match(workflow, /HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: "1,2,3"/);
});

test("real HTTP runner must exercise own and cross-tenant worker IDs, denied roles, revocation and query outages", () => {
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "for (const actor of [a, b])",
    "await own(actor, actor.worker)",
    "await own(actor, actor.secondWorker)",
    "pathFor(actor.org.id, outsider.worker.id)",
    "pathFor(outsider.org.id, outsider.worker.id)",
    "assertDeniedHirePage(response, employers, label)",
    "active: false",
    "assert.equal(stillSignedIn.status, 200)",
    "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
    "ALTER TABLE provisioning_tasks RENAME TO qa_hire_review_source_unavailable",
    "ALTER TABLE employees RENAME TO qa_hire_review_workers_unavailable",
    "pageActionCredits: 0",
    "productionCertified: false",
  ]) assert.ok(runner.includes(marker), "Missing executed-proof contract: " + marker);
});

test("empty success or foreign/worker-specific denial body is never accepted as proof", () => {
  const employers = [{
    marker: "ATTA-SECRET", worker: { employeeNo: "ATTA-EMP" },
    privateBank: "BANK-SECRET", privateTax: "TAX-SECRET",
    org: { id: 1 },
  }, {
    marker: "VICTIM-SECRET", worker: { employeeNo: "VICTIM-EMP" },
    privateBank: "VICTIM-BANK", privateTax: "VICTIM-TAX",
    org: { id: 3 },
  }];
  const headers = new Headers({ "content-type": "text/html" });
  const validOwnText = "Hire-to-payroll input evidence Recorded source evidence " +
    "Current employment record Payroll approval, filing and payout Employer #1 Worker #2";
  assert.doesNotThrow(() => assertOwnedHirePage({
    status: 200, text: validOwnText, headers,
  }, employers[0], { id: 2 }, employers));
  // Next.js/React SSR emits empty comment separators between adjacent JSX text
  // and numeric interpolations. They must not invalidate real authorized HTML.
  const reactOwnText = validOwnText
    .replace("Employer #1", "Employer #<!-- -->1")
    .replace("Worker #2", "Worker #<!-- -->2");
  assert.doesNotThrow(() => assertOwnedHirePage({
    status: 200, text: reactOwnText, headers,
  }, employers[0], { id: 2 }, employers));
  assert.throws(() => assertOwnedHirePage({
    status: 200, text: reactOwnText.replace("Employer #<!-- -->1", "Employer #<!-- -->3"), headers,
  }, employers[0], { id: 2 }, employers), "Wrong employer must still fail");
  assert.throws(() => assertOwnedHirePage({
    status: 200, text: "", headers,
  }, employers[0], { id: 2 }, employers));
  assert.throws(() => assertOwnedHirePage({
    status: 200, text: validOwnText + " VICTIM-SECRET", headers,
  }, employers[0], { id: 2 }, employers));
  assert.doesNotThrow(() => assertDeniedHirePage({
    status: 404, text: "Not found", headers,
  }, employers, "safe 404"));
  assert.throws(() => assertDeniedHirePage({
    status: 404, text: "Hire-to-payroll input evidence Employer #3 · Worker #7", headers,
  }, employers, "leaked 404"));
  assert.throws(() => assertDeniedHirePage({
    status: 404, text: "Employer #<!-- -->3 · Worker #<!-- -->7", headers,
  }, employers, "react-comment worker binding leaked 404"));
});
