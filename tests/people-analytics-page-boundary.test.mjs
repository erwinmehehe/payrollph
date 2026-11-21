import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposablePeopleAnalyticsEnv } from "../scripts/qa/tenant-people-analytics-page-http.mjs";

const page = readFileSync("src/app/app/people-analytics/page.tsx", "utf8");
const proof = readFileSync("scripts/qa/tenant-people-analytics-page-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/people-analytics-tenant-http.yml", "utf8");

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  DEMO_MODE: "false", PEOPLE_ANALYTICS_PROOF: "synthetic-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: "http://127.0.0.1:3000",
  TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
};

test("People Analytics synthetic SSR proof refuses external targets and payment credentials", () => {
  assert.doesNotThrow(() => requireDisposablePeopleAnalyticsEnv(safe));
  for (const key of [
    "GITHUB_ACTIONS", "CI", "NODE_ENV", "PEOPLE_ANALYTICS_PROOF",
    "DATABASE_URL", "APP_BASE_URL", "TRUSTED_APP_ORIGINS",
    "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_BILLING_ENABLED",
  ]) assert.throws(() => requireDisposablePeopleAnalyticsEnv({
    ...safe, [key]: key.endsWith("ENABLED") ? "true" : "UNSAFE",
  }), "Unsafe environment must refuse " + key);
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "OPENAI_API_KEY"]) {
    assert.throws(() => requireDisposablePeopleAnalyticsEnv({
      ...safe, [key]: "live-secret-forbidden",
    }), "Live provider secret must refuse " + key);
  }
});

test("People Analytics SSR denies wrong employer and role before private organization queries", () => {
  const session = page.indexOf("await getSessionUser()");
  const parser = page.indexOf("canonicalPeoplePageOrganizationId(raw)");
  const role = page.indexOf("await assertOrganizationRole(");
  const companyWide = page.indexOf("if (denied || !access?.companyWide) notFound()");
  const billingGate = page.indexOf("if (await isSelfServeOrganization(organizationId))");
  const scope = page.indexOf("await resolveMultiEntityContext(");
  const scopeDenial = page.indexOf("if (!scope.ok || (scope.context.enabled && scope.context.legalEntityId !== null)) notFound();");
  const data = page.indexOf("const [organization] = await db.select(");
  assert.ok(0 < session && session < parser && parser < role &&
    role < companyWide && companyWide < billingGate && billingGate < scope &&
    scope < scopeDenial && scopeDenial < data,
    "Session, canonical selector, People/payroll custom-role gate and legal employer boundary must precede company data");
  assert.match(page, /PEOPLE_PAYROLL_ROLES/);
  assert.ok(page.includes("redirect(") && page.includes("/billing/setup?organizationId="),
    "Billing setup redirect must keep the authenticated employer selector");
  assert.match(page, /where\(eq\(organizations\.id, organizationId\)\)\.limit\(1\)/);
  assert.doesNotMatch(page, /db\.(?:insert|update|delete)\(|createPayrollRun|payrollEngine/);
});

test("exact-head fictional PG16 proof checks real owned SSR, source data, foreign denial and unchanged SQL", () => {
  const mandatory = [
    'requireDisposablePeopleAnalyticsEnv();',
    'import("../../src/db/index.ts")',
    'for (const padding of ["PAD1", "PAD2", "PAD3", "PAD4"])',
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    'victim[prop].id > Math.max(a[prop].id, b[prop].id, 6)',
    'for (const actor of [a, b])',
    'assertOwnPeopleAnalyticsPage(myPage, actor,',
    'assert.equal(ownReport.status, 200,',
    'assert.equal(report.organizationId, actor.org.id)',
    'assert.equal(report.key, "people")',
    'assert.equal(foreignReport.status, 403,',
    'assertDeniedPeopleAnalyticsPage(denied, employers, "authenticated cross-employer")',
    'assert.equal(ownPages, 2)', 'assert.equal(deniedForeign, 4)',
    '["company-wide HR", hr.cookie]', '["company-wide bookkeeper", bookkeeper.cookie]',
    '"unit-scoped admin must not see company-wide reporting"',
    'assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)',
    'assert.equal(revoked.length, 1,',
    'pageCredits: 0, methodCredits: 0, productionCertified: false',
  ];
  for (const marker of mandatory) assert.ok(proof.includes(marker),
    "Synthetic SSR proof missing control: " + marker);
  assert.ok(proof.indexOf("requireDisposablePeopleAnalyticsEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "Refuse unsafe environments before DB imports");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-people-analytics-page-http\.mjs/);
  assert.ok(workflow.includes('"src/app/app/people-analytics/**"'));
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
});
