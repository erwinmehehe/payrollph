import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableTaxReviewPageEnv } from "../scripts/qa/tenant-payroll-review-pages-contract.mjs";

const script = readFileSync("scripts/qa/tenant-payroll-review-pages-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-payroll-review-pages-qa.yml", "utf8");

test("no live database, provider or payroll execution can run the tax review proof", () => {
  const valid = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_TAX_REVIEW_PAGE_PROOF: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    YEAR_END_PRIOR_EVIDENCE_ENABLED: "true",
    BIR_2316_CERTIFICATE_DRAFT_ENABLED: "true",
    BIR_2316_RECONCILIATION_ENABLED: "true",
    BIR_2316_WITHHOLDING_EVIDENCE_ENABLED: "true",
    MULTI_ENTITY_ENABLED: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireDisposableTaxReviewPageEnv(valid));
  for (const [key, value] of [
    ["DATABASE_URL", "postgresql://postgres:postgres@neon.example.invalid/production"],
    ["APP_BASE_URL", "https://payroll.example.invalid"],
    ["CI", "false"], ["WORKER_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"], ["PAYMONGO_SECRET_KEY", "sk_invalid"],
    ["YEAR_END_PRIOR_EVIDENCE_ENABLED", "false"],
  ]) assert.throws(() => requireDisposableTaxReviewPageEnv({ ...valid, [key]: value }));
  assert.ok(script.indexOf("requireDisposableTaxReviewPageEnv();") <
    script.indexOf('import("../../src/db/index.ts")'),
    "All DB imports must happen only after hard environment refusal");
});

test("real proof requires both owned review UIs, denies foreign/forged/role/revoked, and checks SQL immutability", () => {
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    '"/workspace/2316"', '"/workspace/prior-employer"',
    "assertTaxReviewOwnPage(own, route, actor, subjects)",
    "assertTaxReviewDeniedPage(",
    "actor.org.id + \"&organizationId=\" + actor.org.id",
    "group_hr", "bookkeeper", "hr", "active: false",
    "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
    "pageCredits: 0, apiMethodCredits: 0, productionAccepted: false",
  ]) assert.ok(script.includes(marker), "Missing proof contract: " + marker);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-payroll-review-pages-http\.mjs/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
});
