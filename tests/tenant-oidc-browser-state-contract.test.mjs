import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, gitBlobSha, verifyOidcBrowserSourcePins,
  requireDisposableOidcBrowserEnv, assertBrowserDenial,
  assertNoSessionOrAuditChanged,
} from "../scripts/qa/tenant-oidc-browser-state-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_OIDC_BROWSER_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: "https://payroll.example.test",
  SECURITY_SMOKE_URL: ORIGIN,
  TRUSTED_APP_ORIGINS: "https://payroll.example.test",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false",
  ENTERPRISE_IDENTITY_ENCRYPTION_KEY: "11".repeat(32), // fictional 32-byte key, not a credential
};

test("browser-state runner refuses hosted databases, providers, workers and production targets", () => {
  assert.equal(requireDisposableOidcBrowserEnv(safe), true);
  for (const key of [undefined, "", "11".repeat(31), "z".repeat(64), "11".repeat(33)]) {
    assert.throws(() => requireDisposableOidcBrowserEnv({
      ...safe, ENTERPRISE_IDENTITY_ENCRYPTION_KEY: key,
    }), /OIDC_BROWSER_REFUSED/, "invalid synthetic PKCE encryption key");
  }
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "false",
    NODE_ENV: "development",
    TENANT_OIDC_BROWSER_PROOF: "staging",
    DATABASE_URL: "postgresql://postgres:postgres@prod.example.test:5432/app_db",
    APP_BASE_URL: "https://live.example.test",
    SECURITY_SMOKE_URL: "https://live.example.test",
    WORKER_ENABLED: "true",
    CENTRAL_SCHEDULER_ENABLED: "true",
    XENDIT_PAYOUTS_ENABLED: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "true",
    OPENAI_API_KEY: "fake",
    RESEND_API_KEY: "fake",
    XENDIT_SECRET_KEY: "fake",
    SMTP_PASSWORD: "fake",
    ENTERPRISE_IDENTITY_ENCRYPTION_KEY: "malformed",
  })) assert.throws(
    () => requireDisposableOidcBrowserEnv({ ...safe, [key]: value }),
    /OIDC_BROWSER_REFUSED/,
    key,
  );
});

test("source pins cover both OIDC routes, browser/session controls and identity-write regressions", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 10);
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.match(sha, /^[a-f0-9]{40}$/, path);
    assert.equal(gitBlobSha(readFileSync(path)), sha, path);
  }
  assert.equal(verifyOidcBrowserSourcePins(), true);
  assert.notEqual(gitBlobSha("correct"), gitBlobSha("corrupt"));
});

test("denied callback must not create login session, audit or identity link", () => {
  const response = (status, json, text) => ({
    status,
    json,
    text,
    headers: new Headers({ "cache-control": "no-store" }),
  });
  const denied = response(403, {
    error: "OIDC login was not started in this browser. Restart sign-in.",
  }, "safe generic error");
  assert.doesNotThrow(() => assertBrowserDenial(denied, "unmatched browser"));
  for (const invalid of [
    response(200, {}, "unexpected login"),
    response(400, { error: "Wrong code" }, "denied incorrectly"),
    response(403, { error: "Foreign private employer" }, "denied incorrectly"),
    { ...denied, headers: new Headers({ "cache-control": "public, max-age=100" }) },
    { ...denied, headers: new Headers({
      "cache-control": "no-store", "set-cookie": "linaw_session=bad",
    }) },
  ]) assert.throws(() => assertBrowserDenial(invalid, "invalid denial"));
  const before = { sessions: [{id: 1}], auditEvents: [], externalIdentities: [] };
  assert.doesNotThrow(() => assertNoSessionOrAuditChanged(before,
    structuredClone(before), "untouched"));
  for (const field of ["sessions", "auditEvents", "externalIdentities"]) {
    const after = structuredClone(before);
    after[field].push({ id: 42 });
    assert.throws(() => assertNoSessionOrAuditChanged(before, after, field));
  }
});

test("real HTTP probe requires different browser cookies and protects persisted login state", () => {
  const runner = readFileSync("scripts/qa/tenant-oidc-browser-state-http.mjs", "utf8");
  assert.ok(runner.indexOf("requireDisposableOidcBrowserEnv();") >= 0);
  assert.ok(runner.indexOf("verifyOidcBrowserSourcePins();") <
    runner.indexOf('import("../../src/db/index.ts")'));
  assert.match(runner, /SHOW server_version_num/);
  assert.match(runner, /const aLogin = await start\(A\)/);
  assert.match(runner, /const bLogin = await start\(B\)/);
  assert.match(runner, /const victim = await fixture.seedEmployer/);
  assert.match(runner, /A state sent from B's browser/);
  assert.match(runner, /B state sent from A's browser/);
  assert.match(runner, /denied callback consumed state/);
  assert.match(runner, /validBrowserStateConsumedWithoutExternalIdp/);
  assert.match(runner, /assertNoSessionOrAuditChanged/);
  assert.match(runner, /replayed login mutated SQL/);
  assert.match(runner, /completeMethodCredits: 0/);
  assert.doesNotMatch(runner, /exchangeOidcCode\(|verifyOidcIdToken\(|submitXenditPayroll\(/);
});
