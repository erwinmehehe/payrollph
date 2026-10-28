import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crossSiteConsentProbe } from "../scripts/qa/tenant-photo-consent-http.mjs";
import {
  CONSENT_METHOD, CONSENT_VERSION, CONSENT_FIXTURE_SCHEMA,
  requireDisposableConsentTarget, assertNonCacheableConsent,
  assertOwnedConsentReceipt, assertConsentRefused,
  assertScopedConsentWithdrawal, assertScopedWithdrawalAudit,
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

function csrfDependencies(overrides = {}) {
  const calls = [], freshCookie = "__Host-linaw_session=" + "a".repeat(64);
  return { calls, freshCookie, dependencies: {
    readActor: async () => ({ id: 11, employeeId: 21 }),
    readWorker: async id => { assert.equal(id, 21); return { id: 21, organizationId: 31 }; },
    makeSession: async id => { assert.equal(id, 11); return { cookie: freshCookie }; },
    request: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/auth/me") return { status: 200, json: { user: { id: 11, employeeId: 21, role: "employee" } } };
      return receipt("accepted", "unchanged");
    },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ error: "Cross-site request refused." }), { status: 403 });
    },
    ...overrides,
  } };
}

test("cross-origin probe uses a fresh authenticated DB identity and literal localhost, never file cookies", async () => {
  const { calls, freshCookie, dependencies } = csrfDependencies();
  const result = await crossSiteConsentProbe({ ...dependencies,
    fixtureCookie: "PRIVATE-FILE-COOKIE", fixtureOrganizationId: 999 });
  assert.equal(result.status, 403); assert.equal(calls.length, 3);
  assert.equal(calls[0].path, "/api/auth/me");
  assert.equal(calls[1].path, "/api/web-bundy/consent");
  assert.equal(calls[2].url, "http://127.0.0.1:3000/api/web-bundy/consent");
  assert.equal(calls[2].options.headers.cookie, freshCookie);
  assert.deepEqual(JSON.parse(calls[2].options.body), { organizationId: 31, choice: "accepted" });
  assert.equal(calls[2].options.headers["sec-fetch-site"], "cross-site");
  assert.equal(calls[2].options.redirect, "manual");
  assert.ok(!JSON.stringify(calls).includes("PRIVATE-FILE-COOKIE"));
});

test("cross-origin probe refuses invalid worker/session or failed authenticated same-origin control", async () => {
  for (const overrides of [
    { readActor: async () => null },
    { readWorker: async () => ({ id: 999, organizationId: 31 }) },
    { makeSession: async () => ({ cookie: "not-a-valid-session" }) },
    { request: async () => ({ status: 200, json: { user: null } }) },
    { request: async path => path === "/api/auth/me" ? { status: 200, json: { user: { id: 11, employeeId: 21, role: "employee" } } } : { status: 403 } },
  ]) {
    let sent = false;
    const { dependencies } = csrfDependencies({ ...overrides, fetcher: async () => { sent = true; } });
    await assert.rejects(() => crossSiteConsentProbe(dependencies));
    assert.equal(sent, false, "cross-site response cannot count without genuine same-origin authenticated control");
  }
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

test("first refusal is a distinct owned POST with no photos or fixture-file network cookie", () => {
  const script = readFileSync("scripts/qa/tenant-photo-consent-http.mjs", "utf8");
  for (const source of [
    'const firstDeclines = [];',
    'await addWorker(e, "DECLINE", { payProfile: false })',
    'firstDeclines.push({',
    'const session = await shared.standaloneMakeSession(peer.userId);',
    '"declined", "recorded"',
    '"declined", "unchanged"',
    'await denied(session.cookie, peer.organizationId, "accepted", 409)',
    'firstTimeRefusalsProven: initialRefusals',
  ]) {
    assert.ok(script.includes(source), "missing real first-refusal proof: " + source);
  }
  assert.ok(script.includes('assert.equal(before.photos.filter(photo => photo.employeeId === peer.employeeId).length, 0'),
    "first-time refusal must have never-captured own photos");
  assert.ok(script.includes('assertOtherSourcesPreserved(before, after, "first-time consent refusal " + e.marker)'),
    "must compare real employer staff, photos, payroll and audit sources");
});

test("first-refusal worker identifiers stay within the actual employee schema limit", () => {
  const script = readFileSync("scripts/qa/tenant-photo-consent-http.mjs", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const limit = Number(schema.match(/employeeNo: varchar\("employee_no", \{ length: (\d+) \}/)?.[1]);
  const nonceLength = Number(script.match(/const nonce = .*\.slice\(0, (\d+)\)/)?.[1]);
  const suffixes = [...script.matchAll(/addWorker\(e, "([^"]+)"/g)].map(match => match[1]);
  assert.ok(limit && nonceLength && suffixes.length);
  for (const label of ["ATTA", "ATTB"]) for (const suffix of suffixes) {
    const number = "TTBL-" + label + "-" + "a".repeat(nonceLength) + "-" + suffix;
    assert.ok(number.length <= limit, number + " exceeds varchar(" + limit + ")");
  }
});


test("PG16 withdrawal keeps the separately persisted first-refusal peer consent byte-identical", () => {
  const before = {
    consent: [
      {
        id: 120, organizationId: 11, employeeId: 21,
        consentVersion: CONSENT_VERSION, choice: "accepted",
        decidedByUserId: 31, decidedAt: "2026-10-28T01:00:00.000Z",
      },
      {
        id: 121, organizationId: 11, employeeId: 22,
        consentVersion: CONSENT_VERSION, choice: "declined",
        decidedByUserId: 32, decidedAt: "2026-10-28T01:01:00.000Z",
      },
    ],
    audits: [
      { id: 210, organizationId: 11,
        actor: "Fictional initial photo refusal TTBL-ATTA-test",
        action: "WFM selfie consent recorded",
        resource: "WFM photo evidence",
        metadata: { employeeId: 22, consentVersion: CONSENT_VERSION,
          choice: "declined", nonHeldPhotoBytesPurged: false } },
    ],
  };
  const after = structuredClone(before);
  after.consent[0] = {
    ...after.consent[0], choice: "declined", decidedByUserId: 31,
    decidedAt: "2026-10-28T01:02:00.000Z",
  };
  after.audits.push({
    id: 211, organizationId: 11,
    actor: "Fictional photo-consent employee TTBL-ATTA-test",
    action: "WFM selfie consent withdrawn", resource: "WFM photo evidence",
    metadata: { employeeId: 21, consentVersion: CONSENT_VERSION,
      choice: "declined", nonHeldPhotoBytesPurged: true },
  });
  const owner = { organizationId: 11, employeeId: 21, actorUserId: 31 };
  const auditor = {
    organizationId: 11, employeeId: 21,
    actorName: "Fictional photo-consent employee TTBL-ATTA-test",
  };
  assert.equal(before.consent.length, 2,
    "the old one-consent-per-company assertion was invalid after the first-refusal scenario");
  assert.doesNotThrow(() => assertScopedConsentWithdrawal(before, after, owner));
  assert.doesNotThrow(() => assertScopedWithdrawalAudit(before, after, auditor));
  assert.deepEqual(after.consent[1], before.consent[1],
    "separate same-employer first refusal remains unchanged");

  for (const mutate of [
    a => { a.consent.pop(); },
    a => { a.consent.push(structuredClone(a.consent[0])); },
    a => { a.consent[0].id += 1; },
    a => { a.consent[0].organizationId = 99; },
    a => { a.consent[0].employeeId = 22; },
    a => { a.consent[0].choice = "accepted"; },
    a => { a.consent[0].decidedByUserId = 32; },
    a => { a.consent[0].consentVersion = "other-consent-v1"; },
    a => { a.consent[0].decidedAt = "2026-10-27T23:59:00.000Z"; },
    a => { a.consent[0].extraField = "unauthorized"; },
    a => { a.consent[1].choice = "accepted"; },
    a => { a.consent[1].decidedByUserId = 31; },
    a => { a.consent[1].id = 999; },
    a => { a.consent[1].decidedAt = "2026-10-28T02:00:00.000Z"; },
  ]) {
    const bad = structuredClone(after);
    mutate(bad);
    assert.throws(() => assertScopedConsentWithdrawal(before, bad, owner),
      "a changed, removed or overwritten peer must never make a withdrawal test pass");
  }

  for (const mutate of [
    a => { a.audits.pop(); },
    a => { a.audits.push(structuredClone(a.audits.at(-1))); },
    a => { a.audits[0].metadata.choice = "accepted"; },
    a => { a.audits.at(-1).organizationId = 14; },
    a => { a.audits.at(-1).actor = "wrong account"; },
    a => { a.audits.at(-1).metadata.employeeId = 22; },
    a => { a.audits.at(-1).metadata.nonHeldPhotoBytesPurged = false; },
    a => { a.audits.at(-1).resource = "Payroll"; },
  ]) {
    const bad = structuredClone(after);
    mutate(bad);
    assert.throws(() => assertScopedWithdrawalAudit(before, bad, auditor),
      "a forged audit or altered peer refusal must never count as proof");
  }
});

test("withdrawal HTTP proof scopes both consent and audit to original actor, never total org rows", () => {
  const code = readFileSync("scripts/qa/tenant-photo-consent-http.mjs", "utf8");
  assert.match(code, /assertScopedConsentWithdrawal\(before, after, \{/);
  assert.match(code, /assertScopedWithdrawalAudit\(before, after, \{/);
  assert.match(code, /row\.employeeId === firstRefusal\.employeeId/);
  assert.match(code, /firstRefusal\.employeeId !== e\.worker\.id/);
  assert.doesNotMatch(code, /assert\.equal\(after\.consent\.length, 1\);\s*assert\.equal\(after\.consent\[0\]\.id, before\.consent\[0\]\.id\)/,
    "the old one-consent-per-employer withdrawal assertion must not reappear");
});
