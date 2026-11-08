import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ENDPOINT, ORIGIN, PROOF_MODE, requireDisposableFilingEnv,
  assertFilingDenied, assertOwnFilingRejection, assertFilingStateUnchanged,
} from "../scripts/qa/tenant-filing-outcome-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_FILING_OUTCOME_MODE: PROOF_MODE, NODE_ENV: "production",
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: ORIGIN, APP_BASE_URL: "https://payroll.example.test",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
  XENDIT_PAYOUT_SECRET_KEY: "", RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "",
  SMTP_URL: "", STRIPE_SECRET_KEY: "", OPENAI_API_KEY: "",
};
const response = (status, json, headers = {}) => ({
  status, json, text: JSON.stringify(json), headers: new Headers(headers),
});
const own = { org: { id: 9 }, entity: { id: 13 }, owner: { name: "Fictional A owner" } };

test("environment gate refuses all production targets, provider credentials and active workers", () => {
  assert.equal(requireDisposableFilingEnv(safe), true);
  for (const bad of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { TENANT_SECOND_PASS_MODE: "off" }, { TENANT_FILING_OUTCOME_MODE: "live" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { DATABASE_URL: "postgresql://prod.example.invalid/app_db" },
    { SECURITY_SMOKE_URL: "https://prod.example.invalid" },
    { APP_BASE_URL: "https://real.example.invalid" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { MULTI_ENTITY_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "secret" }, { RESEND_API_KEY: "secret" },
    { SMTP_URL: "smtp://example.invalid" },
  ]) {
    assert.throws(() => requireDisposableFilingEnv({ ...safe, ...bad }),
      /FILING_OUTCOME_REFUSED/);
  }
});

test("response contract requires persisted own rejection and refuses foreign identity leaks", () => {
  const good = response(200, {
    record: { id: 32, organizationId: 9, legalEntityId: 13, status: "rejected",
      outcomeNote: "Fictional rejection", submissionMethod: "manual_entry",
      recordedBy: "Fictional A owner", recordedAt: "2026-11-08T00:00:00.000Z" },
  });
  assert.doesNotThrow(() => assertOwnFilingRejection(good, own, 32, "Fictional rejection", ["VICTIM-MARKER"]));
  for (const bad of [
    response(403, good.json), response(200, { ...good.json, record: { ...good.json.record, id: 31 } }),
    response(200, { ...good.json, record: { ...good.json.record, organizationId: 10 } }),
    response(200, { ...good.json, record: { ...good.json.record, status: "generated" } }),
    response(200, { ...good.json, record: { ...good.json.record, outcomeNote: "other" } }),
    response(200, { ...good.json, record: { ...good.json.record, recordedAt: null } }),
    response(200, { ...good.json, record: { ...good.json.record, fileName: "VICTIM-MARKER.csv" } }),
  ]) {
    assert.throws(() => assertOwnFilingRejection(bad, own, 32, "Fictional rejection", ["VICTIM-MARKER"]));
  }
});

test("denial oracle rejects false success, response and header disclosures", () => {
  assert.equal(assertFilingDenied(response(404, { error: "Filing record not found." }), 404, ["VICTIM-MARKER"]).error,
    "Filing record not found.");
  for (const bad of [
    response(200, { error: "Filing record not found." }),
    response(404, { error: "Filing record not found.", record: { id: 7 } }),
    response(404, { error: "VICTIM-MARKER" }),
    response(404, { error: "Not found." }, { "x-debug": "VICTIM-MARKER" }),
    response(404, { message: "Not found." }),
  ]) assert.throws(() => assertFilingDenied(bad, 404, ["VICTIM-MARKER"]));
  assert.throws(() => assertFilingStateUnchanged({ filings: [1], audit: [] },
    { filings: [2], audit: [] }, "foreign"));
});

test("real runner fails closed before any DB, app or fixture import", () => {
  const source = readFileSync("scripts/qa/tenant-filing-outcome-http.mjs", "utf8");
  const guard = source.indexOf("requireDisposableFilingEnv();");
  assert.ok(guard > 0 && guard < source.indexOf('import("../../src/db/index.ts")'));
  for (const mod of ['../../src/db', './tenant-table-http', './disposable-insert-veto']) {
    assert.ok(!new RegExp("^import .*" + mod.replaceAll("/", "\\/"), "m").test(source),
      "No static DB/fixture import allowed before guard: " + mod);
  }
  const execution = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/qa/tenant-filing-outcome-http.mjs"],
    { encoding: "utf8", timeout: 15000, env: { ...process.env, ...safe,
      DATABASE_URL: "postgresql://forbidden.example.invalid/live" } });
  assert.equal(execution.status, 1, "Forbidden target must exit before DB module initialization");
  assert.match(execution.stderr, /FILING_OUTCOME_REFUSED: non-disposable setting DATABASE_URL/);
  assert.doesNotMatch(execution.stderr, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo/);
});

test("production filing route stays SHA-pinned, guarded and earns zero new credits", () => {
  const path = "src/app/api/compliance/filing-validations/[id]/route.ts";
  const contents = readFileSync(path);
  const sha = createHash("sha1").update("blob " + contents.length + "\0").update(contents).digest("hex");
  assert.equal(sha, "09f642a67035dc9ce22fa502d80518ba18641b0f",
    "Any filing route change needs a new independent proof review");
  const route = contents.toString("utf8");
  for (const marker of [
    "enforceSameOriginMutation(request)", "getSessionUser()", "assertOrganizationRole(",
    "requireSensitiveActionMfa(user)", "getFilingValidation(organizationId, id)",
    "assertEntityResource(scope.context, existing.legalEntityId)",
    "assertOrganizationUnitAccess(", "recordFilingOutcome(", "db.transaction(",
    "tx.insert(auditEvents)",
  ]) assert.ok(route.includes(marker), "Missing filing source guard: " + marker);
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles[path].methods.find(row => row.name === "PATCH");
  assert.equal(method.status, "GAP");
  assert.equal(method.testedBy, null);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED/);
  assert.equal(ENDPOINT, "/api/compliance/filing-validations/");
});

test("dedicated workflow is fictional, read-only and does not promote method coverage", () => {
  const yaml = readFileSync(".github/workflows/tenant-filing-outcome-http.yml", "utf8");
  for (const marker of [
    "image: postgres:16", "contents: read", "persist-credentials: false",
    "node scripts/qa/tenant-table-env.mjs compliance-posts",
    "npm run db:push", "node scripts/qa/apply-isolated-baseline.mjs",
    "npm run build", "npm start -- -H 127.0.0.1",
    "node --import tsx scripts/qa/tenant-filing-outcome-http.mjs",
  ]) assert.ok(yaml.includes(marker), "Missing protected proof workflow step: " + marker);
  const runner = readFileSync("scripts/qa/tenant-filing-outcome-http.mjs", "utf8");
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "withDisposableInsertVeto(pool, \"audit_events\"",
    "assertFilingStateUnchanged(", "assertOwnFilingRejection(",
    "assertFilingDenied(", "coverageCredits: 0",
    'independentSecurityReview: "PENDING"',
  ]) assert.ok(runner.includes(marker), "Missing independent tenant proof: " + marker);
  assert.doesNotMatch(runner, /coverageCredits:\s*[1-9]/);
});
