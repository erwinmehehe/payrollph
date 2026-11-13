/** Genuine HR Work Queue SSR/API reproof; fictional localhost PostgreSQL 16 only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/hcm/work-items";
export const API = "/api/hcm/work-items";
export const PINS = Object.freeze({
  "src/app/hcm/work-items/page.tsx": "1452c03d1a89fe599dda1c8b72edcfcaf67d75ef",
  "src/app/api/hcm/work-items/route.ts": "c17f3bb72f6055e3a02a4f8c665d1b3f39083fc4",
  "src/lib/hcm-work-items-page-tenancy.ts": "a7ea8e1177a18d3227e167d2e7a060aa637f8413",
  "src/components/hcm-work-queue.tsx": "dfeb1c3ba76cdd027dab18494acc99e5343a7408",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "src/lib/critical-release-flags.ts": "aa9867f795bbcbe9cfe42c6df7f64d0f0c4a9671",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});
export function gitBlobSha(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
}
export function verifyWorkItemsSource() {
  for (const [path, sha] of Object.entries(PINS)) {
    assert.equal(gitBlobSha(readFileSync(path)), sha, "WORK_ITEMS_REFUSED: source drift: " + path);
  }
  const p = readFileSync("src/app/hcm/work-items/page.tsx", "utf8");
  const route = readFileSync("src/app/api/hcm/work-items/route.ts", "utf8");
  for (const v of ["getSessionUser()", "parseHcmWorkItemsEmployerId(", "assertOrganizationRole(", "getAccess(", "access?.companyWide", "authorizedOrganizationId={organizationId}"])
    assert.ok(p.includes(v), "WORK_ITEMS_REFUSED: missing SSR authorization " + v);
  assert.ok(p.indexOf("assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)") <
    p.indexOf("getAccess(user.id, organizationId)") &&
    p.indexOf("getAccess(user.id, organizationId)") <
    p.indexOf("<HcmWorkQueue"), "WORK_ITEMS_REFUSED: private mount before authorization");
  assert.ok(route.includes("WHERE c.organization_id = $1"), "WORK_ITEMS_REFUSED: SQL must be scoped");
  return true;
}
export function requireFictionalEnv(env = process.env) {
  const required = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_FIVE_PAGE_WORK_ITEMS: "fictional-pg16-only",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    DEMO_MODE: "false", MULTI_ENTITY_ENABLED: "false", NEXT_CSP_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required))
    assert.equal(env[key], value, "WORK_ITEMS_REFUSED: unsafe " + key);
  for (const key of [
    "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "S3_SECRET_ACCESS_KEY",
    "R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "RESEND_API_KEY",
    "STRIPE_SECRET_KEY", "SMTP_PASSWORD",
  ]) assert.ok(!env[key], "WORK_ITEMS_REFUSED: provider secret present " + key);
  return true;
}
export function assertNoForeignData(response, actors, label) {
  assert.equal(typeof response.text, "string", label + ": response body missing");
  const decoded = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  for (const actor of actors) assert.ok(!decoded.includes(actor.marker),
    label + ": leaked " + actor.label);
}
export function assertOwnedPage(response, actor, others) {
  assert.equal(response.status, 200, "Own work-items page must return actual SSR 200");
  assert.ok(response.text.includes("HR Work Queue"), "Wrong/placeholder SSR page");
  // React SSR inserts an empty hydration boundary between literal "#" and
  // the dynamic employer ID. Compare the actual bound strong-label after
  // removing ONLY those empty markers, not arbitrary HTML or text values.
  const html = response.text.replace(/<!--\s*-->/g, "");
  assert.ok(html.includes("Employer") &&
    html.includes("<strong>#" + actor.org.id + "</strong>"),
    "Own SSR must display the server-authorized employer, not a generic shell");
  assertNoForeignData(response, others, "own work queue");
}
export function assertOwnedApi(response, actor, others, caseId) {
  assert.equal(response.status, 200, "Owned API must contain real persisted work");
  assert.ok(response.json?.items?.some(x => x.id === caseId &&
    x.organizationId === actor.org.id && x.title.includes(actor.marker)),
    "Own persisted case is absent, forged, or unscoped");
  assertNoForeignData(response, others, "own work queue GET");
}
export function assertDenied(response, status, actors, label) {
  assert.equal(response.status, status, label + ": wrong HTTP denial " + response.status);
  assertNoForeignData(response, actors, label);
  assert.ok(!response.json?.items, label + ": unauthorized case payload returned");
}
