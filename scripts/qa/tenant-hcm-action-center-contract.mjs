/** Source-sealed SSR proof only: fictional PG16, zero coverage credits. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/hcm/action-center";
export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/action-center/page.tsx": "5d593fd3c4c28d99792c3ac2450e2616c5cd6f9e",
  "src/lib/hcm-people-home-worklist.ts": "d9b76c9ac843ff8e2545edf28c74015bbd5464e5",
  "src/lib/hcm-people-home-scope.ts": "b643254e294f56d8fc6687595758acdf19734d49",
  "src/lib/hcm-enterprise-plan-server.ts": "b436a61f091871e02bb662393429667cadb71b35",
  "src/lib/hcm-enterprise-plan-policy.ts": "6c02b69e0b9a5526aa40ff3aa92ce09085866aba",
  "src/lib/delegation.ts": "4e01ca02ce83cdf42610b1e87a40a72bf2360abf",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "src/lib/workspace-role-ui.ts": "30510bffd2a18e5312cc722ea11ef4a08c2d7f4a",
  "src/components/hcm-context-navigation.tsx": "e2284ab6bf9646e5a7a0155d63c357fc09531a68",
  "src/components/hcm-business-process-inbox.tsx": "32e4f20181dc85a8d9e6b123bc8e4b65272bf7f6",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02"
});
export const REQUIRED_ENV = Object.freeze({
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_ACTION_CENTER_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  HCM_PEOPLE_HOME_ENABLED: "true", NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED: "true",
  HCM_PEOPLE_HOME_ORG_IDS: "8,9,10", HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
  REQUEST_SCHEMA_READONLY_ENABLED: "true", DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true", MULTI_ENTITY_ENABLED: "false",
  MULTI_ENTITY_TRANSFERS_ENABLED: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false", BIR_1604C_DAT_CANDIDATE_ENABLED: "false"
});
export const FORBIDDEN_ENV = Object.freeze([
  "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
  "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
  "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN", "VERCEL",
  "MALWARE_SCAN_URL", "MALWARE_SCAN_TOKEN"
]);
export function requireFictionalEnvironment(env = process.env) {
  for (const [key, value] of Object.entries(REQUIRED_ENV))
    assert.equal(env[key], value, "ACTION_CENTER_REFUSED: unsafe or missing " + key);
  for (const key of FORBIDDEN_ENV)
    assert.ok(!env[key], "ACTION_CENTER_REFUSED: external credential " + key);
}
export function verifySources(read = readFileSync) {
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    const b = Buffer.from(read(path));
    const actual = createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
    assert.equal(actual, expected, "ACTION_CENTER_REFUSED: source drift " + path);
  }
}
const decode = text => text.replace(/\\u([0-9a-fA-F]{4})/g,
  (_, hex) => String.fromCharCode(parseInt(hex, 16)));
export function assertNoLeak(res, actors, own = null) {
  assert.equal(typeof res.text, "string", "Actual HTTP body required");
  const serialized = decode(res.text + " " + Array.from(res.headers.entries()).join(" "));
  for (const actor of actors) {
    if (actor !== own) assert.ok(!serialized.includes(actor.marker), "Foreign employer marker leaked");
    for (const secret of actor.secrets ?? [])
      assert.ok(!serialized.includes(secret), "Private source field leaked into HTML/RSC/headers");
  }
}
const visible = html => html.replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
export function assertOwnPage(res, actor, actors) {
  assert.equal(res.status, 200, "Owned page must be HTTP 200");
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(res.headers.get("cache-control") ?? "", /(?:no-store|private)/,
    "Tenant HTML must not be publicly cacheable");
  const main = res.text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
  assert.ok(main?.includes(actor.marker) && main.includes("HCM Action Center"),
    "Owned employer must be rendered in the actual page, not a shell or redirect");
  const articles = [...main.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map(m => m[1]);
  assert.equal(articles.length, 3, "All three source panels required");
  const expected = [
    ["My HCM decisions", 1, [actor.processLabel, "Approval"]],
    ["People Ops follow-ups", 2, ["Employment lifecycle follow-up", "Onboarding checklist"]],
    ["Cases assigned to me", 1, ["Assigned operational case"]]
  ];
  for (const [heading, count, labels] of expected) {
    const article = articles.find(a => a.includes(heading));
    assert.ok(article, "Missing source panel " + heading);
    const text = visible(article);
    assert.match(text, new RegExp("\\b" + count + "\\s*\\+?\\s*items previewed"),
      "Wrong populated source count: " + heading);
    assert.equal((article.match(/<li\b/g) ?? []).length, count, "Source rows must actually render");
    for (const label of labels) assert.ok(text.includes(label), "Missing persisted source: " + label);
    assert.ok(!/Source unavailable|No matches/.test(text), "Unavailable or empty source is not proof");
  }
  assert.ok(main.includes("organizationId=" + actor.org.id), "Own tenant navigation required");
  assertNoLeak(res, actors, actor);
}
export function assertDenied(res, actors) {
  assert.equal(res.status, 404, "Denied page must be 404, never 200, redirect, or 500");
  assert.ok(!res.text.includes("My HCM decisions") && !res.text.includes("items previewed"),
    "Denied response must not mount the private source panels");
  assertNoLeak(res, actors);
}
export function assertSqlUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": protected business/audit SQL changed");
}
