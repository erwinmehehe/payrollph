/**
 * BIO-01: device-scoped biometric attendance ingress, a standalone
 * workforce time-capture family. Independent of all other open PR paths.
 * Not a release, tenant-isolation method credit, or payroll acceptance.
 */
import assert from "node:assert/strict";

export const BIO01_ROUTE = "src/app/api/biometrics/sync/route.ts";
export const BIO01_ROUTE_SHA = "27e24af5d8a396e611d307bf7972ad4e86568436";
export const BIO01_HELPER = "src/lib/biometric-auth.ts";
export const BIO01_HELPER_SHA = "180b883ab34d836aa086379898c58b26ac35fa89";
const providerFlags = [
  "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
  "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
];
const providerKeys = [
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
];

export function requireDisposableBio01(env = process.env) {
  const refuse = name => { throw new Error("BIO01_REFUSED: " + name); };
  for (const [key, expected] of Object.entries({
    CI: "true", GITHUB_ACTIONS: "true",
    BIO01_MODE: "fictional-pg16-localhost",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    NODE_ENV: "production", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
  })) if (env[key] !== expected) refuse(key + " must be exact");
  let db;
  try { db = new URL(env.DATABASE_URL); } catch { refuse("bad DATABASE_URL"); }
  if (db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" ||
      db.port !== "5432" || db.pathname !== "/app_db" ||
      db.username !== "postgres" || db.password !== "postgres" ||
      db.search || db.hash) refuse("disposable 127.0.0.1/app_db only");
  if (!/^ci-bio01-[a-f0-9]{64}$/.test(env.BIOMETRIC_INGEST_SECRET ?? "")) {
    refuse("randomized CI-only device HMAC root required");
  }
  for (const key of providerFlags) if (env[key] !== "false") refuse(key + " must be false");
  for (const key of providerKeys) if (env[key] !== "") refuse(key + " must be empty");
  return true;
}

export function assertBio01Denied(response, expectedStatus, secrets = []) {
  assert.equal(response.status, expectedStatus, "BIO-01 denial status drifted");
  assert.ok(response.json && typeof response.json.error === "string",
    "denial must not return attendance data");
  assert.equal(response.json.ingested, undefined, "refusal cannot report a successful ingest");
  assert.equal(response.json.deviceSerial, undefined, "refusal cannot echo private device serial");
  for (const marker of secrets) {
    assert.ok(!response.text.includes(marker), "denial disclosed another employer's source");
  }
  return response;
}

export function assertBio01Owned(response, expected, foreignMarkers = []) {
  assert.equal(response.status, 200, "authorized own source must reach real HTTP ingest");
  const data = response.json;
  assert.ok(data && data.ok === true);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(data[key], value, "owned ingestion mismatch: " + key);
  }
  assert.ok(Array.isArray(data.attendanceExceptionSync),
    "real attendance sync must include its reconciliation outcomes");
  assert.ok(typeof data.syncedAt === "string" && Number.isFinite(Date.parse(data.syncedAt)),
    "real device last sync receipt expected");
  for (const marker of foreignMarkers) {
    assert.ok(!response.text.includes(marker), "own response leaked foreign device or worker");
  }
  return data;
}

export function assertBio01Unchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": foreign/payout/audit/attendance data was mutated");
}
