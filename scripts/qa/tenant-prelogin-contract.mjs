import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const PRELOGIN_TITLE = "tenant-prelogin-isolation";
export const PRELOGIN_METHODS = Object.freeze([
  "GET setup", "POST setup", "POST intake-challenge", "POST signup", "POST signup/resend", "POST signup/verify",
]);
export const PRELOGIN_SMTP_URL = "smtp://127.0.0.1:2525";

/**
 * Pre-login routes have no signed-in employer, so "own success, foreign refusal" is restated: a caller may create or
 * activate ONLY the workspace its own request describes, and nothing it sends may read, change or activate any existing
 * employer. This contract fails closed unless the target is a fresh fictional PG16 behind production-mode localhost
 * HTTP, with the pilot signup mode and intake proof ON (otherwise signup answers 503 or skips the proof, and every
 * refusal would be meaningless), mail going only to the loopback sink, and every money provider and worker OFF.
 */
export function requireDisposablePrelogin(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("PRELOGIN_PROOF_REFUSED: explicit localhost targets required");
  }
  const disabled = ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED"];
  const absent = ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "STRIPE_SECRET_KEY"];
  const safe = env.GITHUB_ACTIONS === "true" && env.CI === "true" &&
    env.TENANT_PRELOGIN_MODE === "fictional-pg16-http" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    app.href === "http://127.0.0.1:3000/" &&
    database.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    disabled.every((name) => env[name] === "false") &&
    absent.every((name) => !env[name]);
  if (!safe) throw new Error("PRELOGIN_PROOF_REFUSED: fresh fictional PG16/localhost CI with provider and worker gates OFF required");
  // Mail may only reach the loopback sink; any other transport could deliver a real message.
  if (env.SMTP_URL !== PRELOGIN_SMTP_URL) throw new Error("PRELOGIN_PROOF_REFUSED: SMTP_URL must be the loopback sink " + PRELOGIN_SMTP_URL);
  if (!env.TENANT_PRELOGIN_MAIL_FILE) throw new Error("PRELOGIN_PROOF_REFUSED: TENANT_PRELOGIN_MAIL_FILE is required");
  if (env.PUBLIC_SIGNUP_MODE !== "pilot") throw new Error("PRELOGIN_PROOF_REFUSED: PUBLIC_SIGNUP_MODE must be pilot; paid enrollment is never exercised");
  if (env.PUBLIC_INTAKE_PROOF_ENABLED !== "true" || !(env.PUBLIC_INTAKE_PROOF_SECRET ?? "").trim() || env.PUBLIC_INTAKE_PROOF_SECRET.trim().length < 32) {
    throw new Error("PRELOGIN_PROOF_REFUSED: the intake proof must be ON with a throwaway secret");
  }
  if (env.PRIVATE_PILOT_INVITE_ENABLED === "true") throw new Error("PRELOGIN_PROOF_REFUSED: the private-invite bypass of email verification must be OFF");
  // Each logical caller needs its own verified client address; without this every request shares one rate-limit bucket.
  if (env.TRUSTED_PROXY_HOPS !== "1" || env.VERCEL === "1") throw new Error("PRELOGIN_PROOF_REFUSED: TRUSTED_PROXY_HOPS must be exactly 1 and VERCEL unset");
  if (!(env.SETUP_TOKEN ?? "").trim()) throw new Error("PRELOGIN_PROOF_REFUSED: SETUP_TOKEN is required; production setup refuses without it");
  if (!(env.APP_BASE_URL ?? "").startsWith("https://")) throw new Error("PRELOGIN_PROOF_REFUSED: APP_BASE_URL must be an https origin or signup is disabled");
  return true;
}

/** Solve the server-issued proof of work exactly as a browser would: the first nonce whose digest has 16 leading zero bits. */
export function solveIntakeProof(token, limit = 0xffffffff) {
  assert.ok(typeof token === "string" && token.includes("."), "an issued intake token is required");
  for (let nonce = 0; nonce <= limit; nonce++) {
    if (createHash("sha256").update(token + ":" + nonce).digest("hex").startsWith("0000")) return nonce;
  }
  throw new Error("no intake proof nonce found");
}

/** Every message the loopback sink stored, oldest first. */
export function readMailbox(mailFile) {
  return readFileSync(mailFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** All verification tokens mailed to one recipient, oldest first. A token is only ever read from that recipient's mail. */
export function mailedTokens(mailFile, email) {
  const wanted = String(email).toLowerCase();
  return readMailbox(mailFile)
    .filter((mail) => mail.recipients.length === 1 && mail.recipients[0] === wanted)
    // Quoted-printable bodies wrap long lines with "=\r\n" and encode "=" as "=3D"; undo both before matching.
    .map((mail) => /verify-signup\?token=([a-f0-9]{48})/.exec(mail.data.replace(/=\r\n/g, "").replace(/=3D/gi, "="))?.[1])
    .filter(Boolean);
}

/** A refusal must be the expected status and leak none of the forbidden victim markers, in the body or any header. */
export function assertRefusal(response, status, forbidden = []) {
  assert.equal(response?.status, status, "incorrect refusal status " + response?.status + ": " + response?.text?.slice(0, 300));
  const body = response.text + "\n" + [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "missing forbidden marker");
    assert.ok(!body.includes(marker), "a forbidden victim value leaked into a response");
  }
  return response.json;
}

/** Two complete snapshots must be identical, table by table. */
export function assertRowsUnchanged(before, after, label) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), label + ": table set changed");
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], label + ": " + name + " changed");
}

/** A response must not issue a session. */
export function assertNoSession(response, label) {
  const cookies = typeof response.headers?.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  assert.ok(!cookies.some((cookie) => /session/i.test(cookie.split("=")[0])), label + ": no session may be issued");
}

/** The session cookie a successful activation issued, as a request Cookie header value. */
export function sessionCookieOf(response, label) {
  const cookies = typeof response.headers?.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const session = cookies.find((cookie) => /session/i.test(cookie.split("=")[0]));
  assert.ok(session, label + ": a session cookie must be issued");
  assert.match(session, /;\s*HttpOnly/i, label + ": the session cookie must be HttpOnly");
  assert.match(session, /;\s*Secure/i, label + ": the session cookie must be Secure");
  return session.split(";")[0];
}

/** Distinct documentation-range client addresses (RFC 5737), one per logical caller, so rate limits never collide. */
export function clientAddresses() {
  let n = 0;
  return () => {
    n++;
    assert.ok(n < 250 * 2, "client address pool exhausted");
    return n <= 250 ? "198.51.100." + n : "203.0.113." + (n - 250);
  };
}
