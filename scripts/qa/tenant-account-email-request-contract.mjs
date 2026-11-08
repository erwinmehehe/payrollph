/**
 * Independent, zero-credit proof contract for POST /api/account/email.
 * The one allowed SMTP provider is a loopback-only, in-process fictional sink.
 * No external email, employee, worker, provider, or money operation is permitted.
 */
import assert from "node:assert/strict";

export const ROUTE_PATH = "/api/account/email";

export function requireDisposableEmailRequest(env = process.env) {
  const absent = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "STRIPE_SECRET_KEY",
  ];
  const disabled = [
    "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED",
  ];
  const safe =
    env.GITHUB_ACTIONS === "true" && env.CI === "true" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_ACCOUNT_EMAIL_REQUEST_MODE === "fictional-pg16-smtp" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    env.SECURITY_SMOKE_URL === "http://127.0.0.1:3000" &&
    env.DATABASE_URL === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    env.APP_BASE_URL === "https://payroll.example.test" &&
    env.SMTP_URL === "smtp://127.0.0.1:2525" &&
    absent.every((key) => !env[key]) &&
    disabled.every((key) => env[key] === "false");
  if (!safe) throw new Error(
    "ACCOUNT_EMAIL_REQUEST_REFUSED: only fictional, disposable localhost PG16 and 127.0.0.1 SMTP sink permitted",
  );
  return true;
}

function responseTextAndHeaders(response) {
  return String(response.text ?? "") + "\n" +
    [...(response.headers ?? [])].map(([key, value]) => key + ":" + value).join("\n");
}

export function assertEmailRequestDenied(response, status, forbidden = []) {
  assert.equal(response.status, status, "wrong HTTP refusal status");
  assert.ok(response.json && typeof response.json.error === "string", "denial requires JSON error");
  assert.notEqual(response.json.ok, true, "denial must not report success");
  assert.notEqual(response.json.pending, true, "denial must not create a pending change");
  assert.equal(response.json.delivery, undefined, "denial must not expose delivery state");
  const output = responseTextAndHeaders(response);
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length, "forbidden marker required");
    assert.ok(!output.includes(marker), "private account/password/token or victim marker leaked");
  }
  return response.json;
}

export function assertOwnEmailRequest(response, expectedEmail, forbidden = []) {
  assert.equal(response.status, 200, "own authenticated email request must succeed");
  const json = response.json;
  assert.ok(json && typeof json === "object" && !Array.isArray(json));
  assert.deepEqual(Object.keys(json).sort(), ["ok", "pending", "email", "message", "delivery"].sort());
  assert.equal(json.ok, true);
  assert.equal(json.pending, true);
  assert.equal(json.email, expectedEmail);
  assert.equal(json.delivery.configured, true);
  assert.equal(json.delivery.delivered, true, "local SMTP sink must accept the message");
  assert.equal(json.delivery.queued, false);
  assert.equal(json.delivery.provider, "smtp");
  assert.ok(String(json.message).includes(expectedEmail));
  const output = responseTextAndHeaders(response);
  for (const marker of forbidden) {
    assert.ok(marker && !output.includes(marker), "foreign employer/token marker leaked");
  }
  assert.ok(!/(?:^|, *| )public(?:,|$)/i.test(response.headers.get("cache-control") ?? ""),
    "private account responses cannot be publicly cacheable");
  return json;
}

export function assertPersistedUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": forbidden request or another account changed persisted state");
}

export function assertLocalSmtpMessage(message, expectedRecipient) {
  assert.deepEqual(message.recipients, [expectedRecipient],
    "verification mail must target only the actor's chosen address");
  const wire = message.data;
  assert.ok(wire.includes("Verify your new Linaw email"), "genuine SMTP message subject required");
  assert.ok(wire.includes(expectedRecipient), "SMTP recipient must be exactly the requested own email");

  // Nodemailer may encode a UTF-8 text body using MIME base64 or quoted-printable.
  // The proof must decode the on-wire message rather than mistake MIME wrapping
  // for a missing verification link. This decoder is test-only, never a mail relay.
  const headerEnd = wire.search(/\r?\n\r?\n/);
  const headers = headerEnd >= 0 ? wire.slice(0, headerEnd) : "";
  const encodedBody = headerEnd >= 0 ? wire.slice(headerEnd).replace(/^\r?\n\r?\n/, "") : wire;
  const candidates = [wire, encodedBody];
  if (/^Content-Transfer-Encoding:\s*base64\b/im.test(headers)) {
    candidates.push(Buffer.from(encodedBody.replace(/\s/g, ""), "base64").toString("utf8"));
  }
  const unfold = (s) => s.replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\r?\n/g, "");
  const match = candidates.map(unfold).map((text) =>
    text.match(/verify-email\?token=([a-f0-9]{48})\b/i)).find(Boolean);
  assert.ok(match, "fictional mailbox must receive a real one-time verification link");
  return match[1].toLowerCase();
}
