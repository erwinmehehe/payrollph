import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableEmailRequest, assertEmailRequestDenied,
  assertOwnEmailRequest, assertPersistedUnchanged, assertLocalSmtpMessage,
} from "../scripts/qa/tenant-account-email-request-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_ACCOUNT_EMAIL_REQUEST_MODE: "fictional-pg16-smtp",
  NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: "https://payroll.example.test",
  SMTP_URL: "smtp://127.0.0.1:2525",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", PAYMONGO_SECRET_KEY: "",
  XENDIT_SECRET_KEY: "", XENDIT_PAYOUT_SECRET_KEY: "",
  RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "", STRIPE_SECRET_KEY: "",
};
const mock = (status, json, headers = {}) =>
  ({ status, json, text: JSON.stringify(json), headers: new Headers(headers) });
const ownEmail = "fictional-own@example.invalid";
const good = mock(200, {
  ok: true, pending: true, email: ownEmail,
  message: "Verification sent to " + ownEmail,
  delivery: { configured: true, delivered: true, queued: false, provider: "smtp" },
}, { "cache-control": "private, no-store" });
const gitBlob = (contents) => createHash("sha1")
  .update(Buffer.from("blob " + contents.length + "\0"))
  .update(contents).digest("hex");

test("disposable guard forbids production targets, external SMTP, providers and workers", () => {
  assert.equal(requireDisposableEmailRequest(safe), true);
  for (const variant of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { TENANT_SECOND_PASS_MODE: "other" },
    { TENANT_ACCOUNT_EMAIL_REQUEST_MODE: "disabled" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { SECURITY_SMOKE_URL: "https://payrollsoftware.ph" },
    { DATABASE_URL: "postgresql://postgres:postgres@production.example/app_db" },
    { APP_BASE_URL: "https://live.example.com" },
    { SMTP_URL: "smtp://smtp.example.com:25" },
    { SMTP_URL: "smtps://127.0.0.1:465" },
    { SMTP_URL: "smtp://0.0.0.0:2525" },
    { SMTP_URL: "" },
    { RESEND_API_KEY: "real" }, { POSTMARK_SERVER_TOKEN: "real" },
    { STRIPE_SECRET_KEY: "real" }, { PAYMONGO_SECRET_KEY: "real" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
  ]) assert.throws(() => requireDisposableEmailRequest({ ...safe, ...variant }), /REFUSED/);
});

test("positive must be a genuine own-account 200 with local delivery and no foreign data", () => {
  assert.doesNotThrow(() => assertOwnEmailRequest(good, ownEmail, ["victim-secret"]));
  for (const bad of [
    mock(401, good.json), mock(200, { ...good.json, email: "victim@example.invalid" }),
    mock(200, { ...good.json, pending: false }),
    mock(200, { ...good.json, token: "leak" }),
    mock(200, { ...good.json, delivery: { ...good.json.delivery, delivered: false } }),
    mock(200, { ...good.json, delivery: { ...good.json.delivery, provider: "resend" } }),
    mock(200, good.json, { "cache-control": "public, max-age=600" }),
    mock(200, { ...good.json, message: "victim-secret" }),
  ]) assert.throws(() => assertOwnEmailRequest(bad, ownEmail, ["victim-secret"]));
});

test("refusals may not report success, send emails, or leak victim markers", () => {
  assert.deepEqual(assertEmailRequestDenied(mock(422, {
    error: "Email change not requested.",
    problems: ["Your current password is not correct."],
  }), 422, ["victim@example.invalid"]), {
    error: "Email change not requested.",
    problems: ["Your current password is not correct."],
  });
  for (const bad of [
    mock(200, { error: "Bad password" }),
    mock(422, { error: "Email change not requested.", pending: true }),
    mock(422, { error: "Email change not requested.", ok: true }),
    mock(422, { error: "Email change not requested.", delivery: { configured: true } }),
    mock(422, { error: "victim@example.invalid" }),
    mock(422, { error: "Denied" }, { "x-debug": "victim@example.invalid" }),
  ]) assert.throws(() => assertEmailRequestDenied(bad, 422, ["victim@example.invalid"]));
});

test("negative control detects changes to foreign accounts, tokens, sessions or audit", () => {
  const before = {
    users: [{ id: 31, passwordHash: "only-victim" }],
    tokens: [{ id: 90, usedAt: null }],
    outbox: [], sessions: [{ id: 55, revokedAt: null }], audits: [],
  };
  assert.doesNotThrow(() => assertPersistedUnchanged(before, structuredClone(before), "victim"));
  assert.throws(() => assertPersistedUnchanged(before, {
    ...before, tokens: [{ id: 90, usedAt: new Date() }],
  }, "victim"));
});

test("mail evidence needs the right fictional recipient and a nonempty token-bearing link", () => {
  const m = {
    recipients: [ownEmail],
    data: "To: " + ownEmail + "\r\nSubject: Verify your new Linaw email\r\n" +
      "https://payroll.example.test/verify-email?token=" + "a".repeat(48),
  };
  assert.equal(assertLocalSmtpMessage(m, ownEmail), "a".repeat(48));

  const body = "https://payroll.example.test/verify-email?token=" + "a".repeat(48);
  const base64 = {
    recipients: [ownEmail],
    data: "To: " + ownEmail + "\r\nSubject: Verify your new Linaw email\r\n" +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      Buffer.from(body).toString("base64").replace(/.{40}/g, "      Buffer.from(body).toString("base64").replace(/.{40}/g, "  assert.equal(assertLocalSmtpMessage(m, ownEmail), "a".repeat(48));\r\n"),\\r\\n"),
  };
  assert.equal(assertLocalSmtpMessage(base64, ownEmail), "a".repeat(48),
    "MIME base64 must decode before deciding a real verification token is absent");
  const qp = {
    recipients: [ownEmail],
    data: "To: " + ownEmail + "\r\nSubject: Verify your new Linaw email\r\n" +
      "Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
      "https://payroll.example.test/verify-email?token=3D" +
      "a".repeat(22) + "=\r\n" + "a".repeat(26),
  };
  assert.equal(assertLocalSmtpMessage(qp, ownEmail), "a".repeat(48),
    "quoted-printable soft lines and equals-encoding must decode");

  for (const bad of [
    { ...m, recipients: ["victim@example.invalid"] },
    { ...m, recipients: [ownEmail, "other@example.invalid"] },
    { ...m, data: m.data.replace("a".repeat(48), "b") },
    { ...m, data: "To: " + ownEmail + "\r\nSubject: Fake" },
  ]) assert.throws(() => assertLocalSmtpMessage(bad, ownEmail));
});

test("pinned production route verifies current password BEFORE global email collision query", () => {
  const path = "src/app/api/account/email/route.ts";
  const source = readFileSync(path, "utf8");
  assert.equal(gitBlob(readFileSync(path)), "b9c759114b8082b3493ef3c4671134dabbf7e72e",
    "source modifications require re-proof on the exact changed route");
  const firstPasswordVerification = source.indexOf("if (!verifyPassword(password, account.passwordHash))");
  const emailAvailabilityLookup = source.indexOf("eq(users.email, email)");
  assert.ok(firstPasswordVerification > 0 && emailAvailabilityLookup > firstPasswordVerification,
    "account enumeration must not occur before password reauthentication");
  assert.match(source, /getSessionUser\(\)/);
  assert.match(source, /eq\(users.id, user.id\)/);
  assert.match(source, /eq\(emailChangeTokens.userId, account.id\)/);
  assert.match(source, /userId: account.id/);
  assert.match(source, /primaryOrganizationId\(account.id\)/);
  assert.match(source, /enforceSameOriginMutation\(request\)/);
  assert.doesNotMatch(source, /db.update\(users\).set\(\{ email \}\)/);
});

test("real PG16 runner uses true independent owners, real HTTP, a higher-ID victim and no credits", () => {
  const s = readFileSync("scripts/qa/tenant-account-email-request-http.mjs", "utf8");
  assert.ok(s.indexOf("requireDisposableEmailRequest();") <
    s.indexOf('import("../../src/db/index.ts")'), "fail closed before touching DB");
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)",
    "same-company peer", "assertEmailRequestDenied(response, status, forbidden)",
    "assertOwnEmailRequest(response, email, forbidden)",
    "assertPersistedUnchanged(victimBefore", "assertPersistedUnchanged(peerBefore",
    "previous pending token must be consumed", "ownTokenSupersession: true",
    "foreignAccountGrantsTokensSessionsAuditOutboxUnchanged: true",
    'independentSecurityReview: "PENDING"', "coverageCredits: 0",
  ]) assert.ok(s.includes(marker), "missing essential real proof: " + marker);
  assert.match(s, /startFictionalSmtpSink\(\)/);
  assert.match(s, /server.listen\(2525, "127\.0\.0\.1"/);
  assert.doesNotMatch(s, /coverageCredits:\s*[1-9]/);
});

test("dedicated job has read-only access, no real provider, no live credentials", () => {
  const yml = readFileSync(".github/workflows/tenant-account-email-request-http.yml", "utf8");
  for (const marker of [
    "image: postgres:16", "permissions:", "contents: read", "persist-credentials: false",
    "SMTP_URL=smtp://127.0.0.1:2525", "RESEND_API_KEY=", "POSTMARK_SERVER_TOKEN=",
    "WORKER_ENABLED=false", "XENDIT_PAYOUTS_ENABLED=false",
    "node --test tests/tenant-account-email-request-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-account-email-request-http.mjs",
    "npm run db:push", "npm run build",
  ]) assert.ok(yml.includes(marker), "missing safe job marker: " + marker);
  assert.doesNotMatch(yml, /secrets\.|workflow_dispatch/);
});
