import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableBillingPageEnv } from "../scripts/qa/tenant-billing-setup-page-http.mjs";

const page = readFileSync("src/app/billing/setup/page.tsx", "utf8");
const billingApi = readFileSync("src/app/api/billing/route.ts", "utf8");
const proof = readFileSync("scripts/qa/tenant-billing-setup-page-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-billing-setup-page-qa.yml", "utf8");

test("billing page checks exact employer role and company scope before reading any employer", () => {
  const session = page.indexOf("await getSessionUser()");
  const selector = page.indexOf("const selected = params.organizationId");
  const role = page.indexOf("await assertOrganizationRole(");
  const scope = page.indexOf("await getAccess(");
  const organizationRead = page.indexOf("await db.select(");
  const render = page.indexOf("<SubscriptionManager");
  assert.ok(session >= 0 && selector > session && role > selector &&
    scope > role && organizationRead > scope && render > organizationRead,
  "The authenticated employer selector, billing role, company scope and row lookup precede SSR rendering");
  assert.match(page, /BILLING_ADMIN_ROLES,/);
  assert.match(page, /if \(denied\) notFound\(\);/);
  assert.match(page, /if \(!access\?\.companyWide\) notFound\(\);/);
  assert.match(page, /if \(!org\) notFound\(\);/);
});

test("multi-client billing selector rejects malformed/duplicate/foreign instead of falling back", () => {
  assert.match(page, /typeof selected === "string"/);
  assert.match(page, /\^\[1-9\]\\d\*\$/);
  assert.match(page, /Number\.isSafeInteger\(Number\(selected\)\)/);
  assert.match(page, /if \(!organizationId\) notFound\(\);/);
  assert.match(page, /selected === undefined\s*\? await primaryCompanyOrganizationId\(user\.id\)/);
  assert.match(page, /companyName=\{org\.name\}/);
  assert.doesNotMatch(page, /org\?\.name\s*\|\|/);
});

test("billing SSR and API require the same tenant membership and roles", () => {
  assert.match(billingApi, /await assertOrganizationRole\([\s\S]*?BILLING_ADMIN_ROLES/);
  assert.match(billingApi, /!access\?\.companyWide/);
  assert.match(page, /BILLING_ADMIN_ROLES/);
  assert.match(page, /!access\?\.companyWide/);
});

test("proof hard-refuses any non-disposable database, server, money or provider configuration", () => {
  const valid = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only", TENANT_BILLING_PAGE_PROOF: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: "http://127.0.0.1:3000", TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireDisposableBillingPageEnv(valid));
  for (const [key, value] of [
    ["DATABASE_URL", "postgresql://postgres:postgres@db.production.invalid/payroll"],
    ["APP_BASE_URL", "https://payroll.example.invalid"],
    ["CI", "false"],
    ["WORKER_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "sk_example"],
  ]) assert.throws(() => requireDisposableBillingPageEnv({ ...valid, [key]: value }),
    "Unsafe " + key + " cannot run billing proof");
  assert.ok(proof.indexOf("requireDisposableBillingPageEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "Hard refusal must run before importing the database");
});

test("real billing proof refuses empty-success, forged IDs, revocation and victim mutation", () => {
  for (const literal of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "for (const actor of [a, b])",
    "assertOwnBillingPage(await readLocal(ownPath(actor.org.id), actor.cookie)",
    "assertDeniedBillingPage(denied, subjects",
    "for (const invalid of",
    "unit-scoped bookkeeper",
    "group_hr",
    "assert.equal(revoked.length, 1",
    "assert.equal(stillSignedIn.status, 200",
    "assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id)",
    "victimBillingPayrollAndAuditUnchanged: true",
    "pageCredits: 0, methodCredits: 0",
    "productionCertified: false",
  ]) assert.ok(proof.includes(literal), "Missing real-HTTP negative control: " + literal);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-billing-setup-page-http\.mjs/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
});
