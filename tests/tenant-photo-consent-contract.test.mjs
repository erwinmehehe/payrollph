import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONSENT_METHOD, CONSENT_VERSION, CONSENT_FIXTURE_SCHEMA,
  requireDisposableConsentTarget, assertNonCacheableConsent,
  assertOwnedConsentReceipt, assertConsentRefused,
} from "../scripts/qa/tenant-photo-consent-contract.mjs";

const safeEnv = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DEMO_MODE: "false", WFM_PUNCH_EVIDENCE_ENABLED: "true",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  GITHUB_ENV: "/tmp/ci-env-only", WFM_PUNCH_EVIDENCE_ORG_IDS: "",
  PHOTO_CONSENT_FIXTURE: "", PAYMONGO_SECRET_KEY: "",
  XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
});

function receipt(choice = "accepted", status = "recorded") {
  const json = { ok: true, choice, status };
  return { status: 200, json, text: JSON.stringify(json),
    headers: new Headers({
      "content-type": "application/json",
      "cache-control": "private, no-store",
    }) };
}

test("only a strictly disposable Actions localhost PG16 target can seed consent", () => {
  assert.doesNotThrow(() => requireDisposableConsentTarget(safeEnv, "bootstrap"));
  for (const key of [
    "GITHUB_ACTIONS", "CI", "NODE_ENV", "TENANT_SECOND_PASS_MODE",
    "DATABASE_URL", "SECURITY_SMOKE_URL", "DEMO_MODE",
    "WFM_PUNCH_EVIDENCE_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
  ]) {
    assert.throws(() => requireDisposableConsentTarget(
      { ...safeEnv, [key]: "wrong" }, "bootstrap"), /PHOTO_CONSENT_REFUSED/, key);
    assert.throws(() => requireDisposableConsentTarget(
      { ...safeEnv, [key]: undefined }, "bootstrap"), /PHOTO_CONSENT_REFUSED/, key);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.throws(() => requireDisposableConsentTarget(
      { ...safeEnv, [key]: "live-key" }, "bootstrap"), /PHOTO_CONSENT_REFUSED/, key);
  }
  assert.throws(() => requireDisposableConsentTarget(
    { ...safeEnv, GITHUB_ENV: "" }, "bootstrap"), /PHOTO_CONSENT_REFUSED/);
  assert.throws(() => requireDisposableConsentTarget(
    { ...safeEnv, WFM_PUNCH_EVIDENCE_ORG_IDS: "1,2,3" }, "bootstrap"),
  /PHOTO_CONSENT_REFUSED/);
});

test("proof requires three seeded IDs and a private CI-only fixture", () => {
  const env = { ...safeEnv,
    WFM_PUNCH_EVIDENCE_ORG_IDS: "41,43,48",
    PHOTO_CONSENT_FIXTURE: "/tmp/payrollph-photo-consent-AbC123/fixture.json",
  };
  assert.doesNotThrow(() => requireDisposableConsentTarget(env, "prove"));
  for (const ids of ["", "*", "1", "1,2", "1,2,3,4", "01,2,3", "1,0,3", "1,2,-3"]) {
    assert.throws(() => requireDisposableConsentTarget(
      { ...env, WFM_PUNCH_EVIDENCE_ORG_IDS: ids }, "prove"),
    /PHOTO_CONSENT_REFUSED/, ids);
  }
  assert.throws(() => requireDisposableConsentTarget(
    { ...env, PHOTO_CONSENT_FIXTURE: "/home/customer-secrets.json" },
    "prove"), /PHOTO_CONSENT_REFUSED/);
});

test("real owned and withdrawal consent receipts expose no employee or photo details", () => {
  assert.equal(CONSENT_METHOD, "POST web-bundy/consent");
  assert.equal(CONSENT_VERSION, "selfie-attendance-v1");
  assert.equal(CONSENT_FIXTURE_SCHEMA, "payrollph-tenant-photo-consent-v1");
  for (const [choice, status] of [
    ["accepted", "recorded"], ["accepted", "unchanged"],
    ["declined", "recorded"], ["declined", "unchanged"],
  ]) {
    assert.doesNotThrow(() => assertOwnedConsentReceipt(
      receipt(choice, status), choice, status));
  }
});

test("fake success, source disclosure and changed consent details fail closed", () => {
  for (const mutate of [
    r => { r.status = 403; },
    r => { r.json.ok = false; },
    r => { r.json.choice = "declined"; },
    r => { r.json.status = "unchanged"; },
    r => { r.json.employeeId = 200; },
    r => { r.json.sealedPhoto = "private-photo"; },
    r => { r.headers.set("content-type", "text/html"); },
    r => { r.headers.delete("cache-control"); },
  ]) {
    const r = receipt();
    mutate(r);
    r.text = JSON.stringify(r.json);
    assert.throws(() => assertOwnedConsentReceipt(r, "accepted", "recorded"));
  }
});

test("Next no-store normalization is accepted, public or shared caching is not", () => {
  for (const value of [
    "private, no-store", "no-store, max-age=0", "No-Store, MAX-AGE=0",
    "no-store", "max-age=0, no-store, private",
  ]) {
    const r = receipt();
    r.headers.set("cache-control", value);
    assert.doesNotThrow(() => assertNonCacheableConsent(r.headers), value);
    assert.doesNotThrow(() => assertOwnedConsentReceipt(r, "accepted", "recorded"), value);
  }
  for (const value of [
    "private", "no-cache", "no-stored", "public, max-age=0",
    "no-store, public", "public, no-store", "no-store, max-age=15",
    "no-store, s-maxage=0", "no-store, immutable",
    "no-store, stale-while-revalidate=0",
  ]) {
    const r = receipt();
    r.headers.set("cache-control", value);
    assert.throws(() => assertNonCacheableConsent(r.headers), value);
  }
});

test("cross-tenant, nonallowlisted and reacceptance denials must stay private", () => {
  for (const status of [400, 403, 404, 409]) {
    const json = { error: "Not available for this employee." };
    assert.doesNotThrow(() => assertConsentRefused(
      { status, json, text: JSON.stringify(json) }, status,
      ["TTBL-VICTIM-private-photo", "TTBL-ATTA-private-photo"]));
  }
  const denied = { status: 403, json: { error: "Forbidden." },
    text: '{"error":"Forbidden."}' };
  assert.throws(() => assertConsentRefused({ ...denied, status: 200 }, 403));
  assert.throws(() => assertConsentRefused({
    status: 403, json: { ok: true, error: "Forbidden." },
    text: '{"ok":true,"error":"Forbidden."}',
  }, 403));
  assert.throws(() => assertConsentRefused({
    status: 403, json: { error: "TTBL-VICTIM-private-photo" },
    text: '{"error":"TTBL-VICTIM-private-photo"}',
  }, 403, ["TTBL-VICTIM-private-photo"]));
  assert.throws(() => assertConsentRefused({
    status: 403, json: {}, text: "{}",
  }, 403));
});

test("the route retains employee role, membership, tenant-scoped photo and legal hold guards", () => {
  const code = readFileSync("src/app/api/web-bundy/consent/route.ts", "utf8");
  for (const part of [
    "enhancedPunchEnabled()", "enhancedPunchEnabledForOrganization(org)",
    'user.role!=="employee"', "assertMembership(user.id,org)",
    "eq(employees.id,user.employeeId)", "eq(employees.organizationId,org)",
    "eq(workforcePunchPhotoConsents.organizationId,org)",
    "eq(workforcePunchPhotoConsents.employeeId,employee.id)",
    "eq(workforcePunchPhotoEvidence.organizationId,org)",
    "eq(workforcePunchPhotoEvidence.employeeId,employee.id)",
    "eq(workforcePunchPhotoEvidence.legalHold,false)",
    "isNotNull(workforcePunchPhotoEvidence.sealedPhoto)",
    "reapproval-required", "pg_advisory_xact_lock(6108",
  ]) assert.ok(code.includes(part), "missing authorization or legal hold guard: " + part);
  assert.ok(!code.includes("db.delete(timePunches)") &&
    !code.includes("db.insert(payrollEntries)"));
});

test("real PG16 probe seeds a higher-ID victim and checks unauthorized access and privacy", () => {
  const code = readFileSync("scripts/qa/tenant-photo-consent-http.mjs", "utf8");
  for (const part of [
    "seedEmployer(label", '"ATTA", "ATTB", "VICTIM", "UNLISTED"',
    "mkdtempSync(", "mode: 0o600", "WFM_PUNCH_EVIDENCE_ORG_IDS=",
    "workforcePunchPhotoEvidence", "workerEmployeeId",
    "await denied(attacker.actor.cookie, victim.org.id",
    "await denied(fixture.mismatch.cookie, a.org.id",
    "await denied(excluded.actor.cookie, excluded.org.id",
    "assert.deepEqual(await state(victim), ownStates[2]",
    "nonheld.sealedPhoto, null", "assert.deepEqual(held, beforeHeld",
    "assert.deepEqual(await ledger(), initialLedger",
  ]) assert.ok(code.includes(part), "missing tenant isolation source probe: " + part);
});

test("dedicated workflow seeds dynamic allowlist between disposable schema and localhost start", () => {
  const yaml = readFileSync(".github/workflows/tenant-photo-consent-http.yml", "utf8");
  const i = term => yaml.indexOf(term);
  assert.ok(i("run: npm run db:push") >= 0);
  assert.ok(i("run: node scripts/qa/apply-isolated-baseline.mjs") >
    i("run: npm run db:push"));
  assert.ok(i("run: node --import tsx scripts/qa/tenant-photo-consent-http.mjs --bootstrap") >
    i("run: node scripts/qa/apply-isolated-baseline.mjs"));
  assert.ok(i("run: node --import tsx scripts/qa/tenant-photo-consent-http.mjs --prove") >
    i("run: npm run build"));
  assert.ok(yaml.includes('WFM_PUNCH_EVIDENCE_ENABLED: "true"'));
  assert.ok(!yaml.includes("WFM_PUNCH_EVIDENCE_ORG_IDS: "),
    "do not hardcode employer IDs in the new PR");
});

test("the exact POST remains a manifest GAP without synthetic coverage credits", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = Object.values(manifest.allApiRouteFiles)
    .find(row => row.route === "web-bundy/consent");
  assert.equal(entry?.methods.find(m => m.name === "POST")?.status, "GAP");
});
