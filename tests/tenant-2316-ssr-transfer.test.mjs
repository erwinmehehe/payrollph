import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, PAGE, SOURCE_PINS, gitBlobSha, requireDisposable2316Env,
  verify2316Sources, assertOwn2316, assertDenied2316,
} from "../scripts/qa/tenant-2316-ssr-transfer-contract.mjs";

const runner = readFileSync("scripts/qa/tenant-2316-ssr-transfer-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-2316-ssr-transfer-qa.yml", "utf8");
const safe = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_2316_SSR_TRANSFER_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  SECURITY_SMOKE_URL: ORIGIN, DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  BIR_2316_CERTIFICATE_DRAFT_ENABLED: "true",
  BIR_2316_RECONCILIATION_ENABLED: "true",
  BIR_2316_WITHHOLDING_EVIDENCE_ENABLED: "true",
  YEAR_END_PRIOR_EVIDENCE_ENABLED: "true",
  MULTI_ENTITY_ENABLED: "true", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
});

test("refuse non-disposable, provider, money or production paths before DB import", () => {
  assert.equal(PAGE, "/workspace/2316");
  assert.doesNotThrow(() => requireDisposable2316Env(safe()));
  for (const [name, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["NODE_ENV", "development"],
    ["DATABASE_URL", "postgresql://postgres:postgres@neon.invalid/payroll"],
    ["APP_BASE_URL", "https://app.example.invalid"],
    ["MULTI_ENTITY_ENABLED", "false"],
    ["BIR_2316_CERTIFICATE_DRAFT_ENABLED", "false"],
    ["WORKER_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "unsafe"],
    ["OPENAI_API_KEY", "unsafe"],
  ]) assert.throws(() => requireDisposable2316Env({ ...safe(), [name]: value }));
  assert.ok(runner.indexOf("requireDisposable2316Env();") <
    runner.indexOf('import("../../src/db/index.ts")'));
  assert.ok(runner.indexOf("verify2316Sources();") <
    runner.indexOf('import("../../src/db/index.ts")'));
});

test("source pins, legal-employer checks and explicit zero-credit manifest state", () => {
  assert.ok(Object.keys(SOURCE_PINS).length >= 4);
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(path)), sha, "Source changed: " + path);
  }
  assert.equal(verify2316Sources(), true);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "true"/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow,
    /node --import tsx scripts\/qa\/tenant-2316-ssr-transfer-http\.mjs/);
});

test("proof uses actual seeded two attackers, higher-ID victim and transactional invariants", () => {
  for (const token of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
    'seedEmployer("VICTIM"', "victim[key].id > actor[key].id",
    "userLegalEntityGrants", "otherEntity", "otherWorker",
    "frozen historical employer", "status: \"released\"",
    "sourceFingerprint: { employeeLegalEntityId: actor.entity.id }",
    "same-parent foreign worker-only existence",
    "same-parent foreign historical separation",
    "forged cross-tenant separation",
    "transferred worker-only selection must use current legal-employer grant",
    "revoked frozen legal-employer grant",
    "revoked employer membership",
    "await unchanged(label)", "await snapshot(subject.org.id)",
    "apiMethodCredits: 0, pageActionCredits: 0",
    'independentSecurityReview: "PENDING", productionCertified: false',
  ]) assert.ok(runner.includes(token), "Missing proof operation: " + token);
});

test("own SSR cannot pass on empty guidance; denials cannot mount private tax UI", () => {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  const actor = { org: { id: 1, name: "Own company" },
    worker: { id: 4, employeeNo: "OWN-04" } };
  const victim = { org: { id: 10, name: "Private company" },
    worker: { id: 22, employeeNo: "PRIVATE-22" } };
  const released = 'Prepare an unsigned Form 2316 <div data-organization-id="1">' +
    '<input value="4"></div>';
  assert.doesNotThrow(() => assertOwn2316({ status: 200,
    text: released, headers }, actor, [actor, victim], "released"));
  for (const bad of [
    "", "Select a released final-pay separation",
    released.replace('data-organization-id="1"', 'data-organization-id="10"'),
    released.replace('value="4"', 'value="22"'), released + victim.worker.employeeNo,
  ]) assert.throws(() => assertOwn2316(
    { status: 200, text: bad, headers }, actor, [actor, victim], "released"));
  assert.doesNotThrow(() => assertOwn2316({ status: 200,
    text: "Select a released final-pay separation", headers },
    actor, [actor, victim], "guidance"));
  assert.throws(() => assertOwn2316({ status: 200,
    text: released + " Select a released final-pay separation", headers },
    actor, [actor, victim], "guidance"));
  assert.doesNotThrow(() => assertDenied2316(
    { status: 404, text: "Not found" }, [actor, victim], "safe denial"));
  for (const unsafe of [
    released, 'data-organization-id="10"', "Not found " + victim.worker.employeeNo,
  ]) assert.throws(() => assertDenied2316(
    { status: 404, text: unsafe }, [actor, victim], "unsafe denial"));
  assert.throws(() => assertDenied2316(
    { status: 200, text: "Not found" }, [actor, victim], "wrong HTTP status"));
});
