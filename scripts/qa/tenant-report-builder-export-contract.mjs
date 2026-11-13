/** Independent, zero-credit Report Builder POST proof. Disposable PG16 only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const SOURCE_PINS = Object.freeze({
  "src/app/api/reports/builder/route.ts": "be4ea656c312590df3122c491a05dfd063632718",
  "src/lib/tenant-report-builder.ts": "5d315afc085baad9ce2fc14946a34a6d738a773b",
  "src/lib/tenant-report-builder-server.ts": "8cdd745742579aab2e73749527ce64db248dec6b",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/critical-release-flags.ts": "aa9867f795bbcbe9cfe42c6df7f64d0f0c4a9671",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e"
});
const required = Object.freeze({
  CI: "true",
  GITHUB_ACTIONS: "true",
  NODE_ENV: "production",
  DEMO_MODE: "false",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_REPORT_EXPORT_PROOF: "fictional-pg16-only",
  TENANT_REPORT_BUILDER_ENABLED: "true",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN,
  TRUSTED_APP_ORIGINS: ORIGIN,
  REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
});
const forbidden = Object.freeze([
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
  "STRIPE_SECRET_KEY", "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
  "VERCEL", "MALWARE_SCAN_URL", "MALWARE_SCAN_TOKEN",
]);
export function requireDisposableExportEnv(env = process.env) {
  for (const [name, expected] of Object.entries(required)) {
    assert.equal(env[name], expected, "REPORT_EXPORT_REFUSED: unsafe or absent " + name);
  }
  for (const name of forbidden) {
    assert.ok(!env[name], "REPORT_EXPORT_REFUSED: provider/production credential " + name);
  }
}
export function verifyExportSourcePins(read = readFileSync) {
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    const bytes = Buffer.from(read(path));
    const actual = createHash("sha1")
      .update("blob " + bytes.length + "\0").update(bytes).digest("hex");
    assert.equal(actual, expected, "REPORT_EXPORT_REFUSED: source drift " + path);
  }
}
export function assertNoVictimMaterial(response, victim, context) {
  assert.ok(response && typeof response.text === "string", context + ": real HTTP body required");
  for (const marker of [victim.marker, victim.org.name, victim.worker.employeeNo]) {
    assert.ok(!response.text.includes(marker), context + ": victim marker leaked");
  }
}
export function assertOwnPreview(response, actor, victim) {
  assert.equal(response.status, 200, "Owned report JSON must be 200");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.json?.source, "people");
  assert.deepEqual(response.json?.columns, ["department", "headcount"]);
  assert.ok(Array.isArray(response.json?.rows) && response.json.rows.length > 0,
    "An empty response cannot prove an own-employer report");
  assert.ok(Number.isSafeInteger(actor.expectedHeadcount) && actor.expectedHeadcount > 0,
    "Expected headcount must come from the persisted fictional fixture");
  assert.deepEqual(response.json.rows, [[actor.unit.code, String(actor.expectedHeadcount)]],
    "Own report must contain exactly the persisted department/headcount, with no foreign or duplicate rows");
  assertNoVictimMaterial(response, victim, "own preview");
}
export function assertOwnCsv(response, actor, victim) {
  assert.equal(response.status, 200, "Owned CSV must be 200");
  assert.match(response.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  // The production serializer quotes EVERY CSV cell, including the header.
  // Match its exact shape, plus a populated distinct employer unit row.
  assert.ok(response.text.startsWith('"department","headcount"\n') &&
    response.text.length > '"department","headcount"\n'.length,
    "A successful but empty/fake CSV header is not an export");
  assert.ok(Number.isSafeInteger(actor.expectedHeadcount) && actor.expectedHeadcount > 0);
  assert.equal(response.text, '"department","headcount"\n"' + actor.unit.code + '","' + actor.expectedHeadcount + '"',
    "CSV bytes must contain exactly the persisted own department/headcount and no additional data");
  assertNoVictimMaterial(response, victim, "own CSV");
}
export function assertDeniedExport(response, victim, context, allowed = [401, 403, 404]) {
  assert.ok(allowed.includes(response.status), context + ": unexpected HTTP " + response.status);
  assertNoVictimMaterial(response, victim, context);
  assert.ok(!response.text.includes('"department","headcount"') &&
    !response.text.includes("department,headcount"),
    context + ": denial cannot contain CSV source columns");
  assert.ok(!response.json?.rows && !response.json?.columns,
    context + ": denial cannot include report facts");
}
export function assertProtectedUnchanged(before, after, context) {
  assert.deepEqual(after, before, context + ": foreign employer SQL/audit changed");
}
