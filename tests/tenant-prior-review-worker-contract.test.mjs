import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, PAGE, SOURCE_PINS, requireDisposablePriorWorkerEnv,
  verifyPriorWorkerSource, gitBlobSha, assertPriorOwnPage, assertPriorDeniedPage,
} from "../scripts/qa/tenant-prior-review-worker-contract.mjs";

const runner = readFileSync("scripts/qa/tenant-prior-review-worker-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-prior-review-worker-ssr-qa.yml", "utf8");

function safeEnv() {
  return {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_PRIOR_WORKER_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
    YEAR_END_PRIOR_EVIDENCE_ENABLED: "true", MULTI_ENTITY_ENABLED: "true",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  };
}
test("proof refuses non-disposable or provider-bearing environments before application imports", () => {
  assert.equal(PAGE, "/workspace/prior-employer");
  assert.doesNotThrow(() => requireDisposablePriorWorkerEnv(safeEnv()));
  for (const [key, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"], ["NODE_ENV", "development"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.production.invalid/payroll"],
    ["APP_BASE_URL", "https://app.example.invalid"], ["MULTI_ENTITY_ENABLED", "false"],
    ["YEAR_END_PRIOR_EVIDENCE_ENABLED", "false"], ["WORKER_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "synthetic-key"], ["OPENAI_API_KEY", "forbidden"],
  ]) assert.throws(() => requireDisposablePriorWorkerEnv({ ...safeEnv(), [key]: value }));
  assert.ok(runner.indexOf("requireDisposablePriorWorkerEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "Environment check must precede database import");
  assert.ok(runner.indexOf("verifyPriorWorkerSource();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "Source pins must precede database import");
});
test("exact changed page and security inputs stay pinned; CI builds real PG16", () => {
  assert.ok(Object.keys(SOURCE_PINS).length >= 6);
  for (const [path, sha] of Object.entries(SOURCE_PINS))
    assert.equal(gitBlobSha(readFileSync(path)), sha, "Unreviewed source: " + path);
  assert.equal(verifyPriorWorkerSource(), true);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "true"/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-prior-review-worker-http\.mjs/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
});
test("real HTTP proof executes owned worker, foreign employer, legal-employer grant, revocation and immutable SQL", () => {
  for (const token of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "for (const actor of [a, b])",
    "for (const worker of [actor.worker, actor.secondWorker])",
    "pathFor(actor.org.id, other.worker.id)",
    "pathFor(other.org.id, other.worker.id)",
    "pathFor(a.org.id, otherWorker.id)",
    "userLegalEntityGrants",
    "active: false", "assert.equal(stillAuthenticated.status, 200)",
    "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
    "ALTER TABLE employees RENAME TO qa_prior_worker_query_unavailable",
    "pageActionCredits: 0, apiMethodCredits: 0",
    "independentlyAccepted: false, productionCertified: false",
  ]) assert.ok(runner.includes(token), "Missing executed proof action: " + token);
});
test("empty and misleading own pages cannot pass, and forbidden page must never carry worker context", () => {
  const headers = new Headers({ "content-type": "text/html" });
  const actor = { org: { id: 1, name: "Own employer" }, marker: "OWN-MARKER",
    worker: { id: 4, employeeNo: "OWN-WORKER" } };
  const victim = { org: { id: 8, name: "Victim employer" }, marker: "VICTIM-SECRET",
    worker: { id: 12, employeeNo: "VICTIM-WORKER" } };
  const ok = 'Previous employer <div data-organization-id="1"><input value="4"></div>';
  assert.doesNotThrow(() => assertPriorOwnPage({
    status: 200, text: ok, headers,
  }, actor, actor.worker, [actor, victim]));
  for (const invalid of ["", "Previous employer <input value=4>",
    ok.replace('data-organization-id="1"', 'data-organization-id="8"'),
    ok.replace('value="4"', 'value="12"'), ok + victim.marker]) {
    assert.throws(() => assertPriorOwnPage({
      status: 200, text: invalid, headers,
    }, actor, actor.worker, [actor, victim]));
  }
  assert.doesNotThrow(() => assertPriorDeniedPage({
    status: 404, text: "Not found", headers,
  }, [actor, victim], "safe denial"));
  assert.throws(() => assertPriorDeniedPage({
    status: 404, text: 'data-organization-id="8"', headers,
  }, [actor, victim], "forbidden employer shell"));
  assert.throws(() => assertPriorDeniedPage({
    status: 404, text: "Not found " + victim.marker, headers,
  }, [actor, victim], "leaked victim marker"));
});
