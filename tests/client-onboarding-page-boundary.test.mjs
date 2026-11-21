import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableClientOnboardingEnv } from "../scripts/qa/tenant-client-onboarding-page-http.mjs";

const page = readFileSync("src/app/app/client-onboarding/page.tsx", "utf8");
const proof = readFileSync("scripts/qa/tenant-client-onboarding-page-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/client-onboarding-tenant-http.yml", "utf8");

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  DEMO_MODE: "false", CLIENT_ONBOARDING_PROOF: "synthetic-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: "http://127.0.0.1:3000",
  TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
};

test("synthetic SSR proof refuses external databases, credentials, workers and payment settings", () => {
  assert.doesNotThrow(() => requireDisposableClientOnboardingEnv(safe));
  for (const key of ["GITHUB_ACTIONS", "CI", "NODE_ENV", "CLIENT_ONBOARDING_PROOF",
    "DATABASE_URL", "APP_BASE_URL", "TRUSTED_APP_ORIGINS", "WORKER_ENABLED",
    "XENDIT_BILLING_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED"]) {
    assert.throws(() => requireDisposableClientOnboardingEnv({
      ...safe, [key]: key.endsWith("ENABLED") ? "true" : "UNSAFE",
    }), "Unsafe " + key + " must be rejected");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "OPENAI_API_KEY"]) {
    assert.throws(() => requireDisposableClientOnboardingEnv({
      ...safe, [key]: "never-send",
    }), "Live provider secret " + key + " must be rejected");
  }
});

test("tenant role and legal-employer context protect all onboarding aggregate reads", () => {
  const session = page.indexOf("await getSessionUser()");
  const selector = page.indexOf("canonicalPeoplePageOrganizationId(raw)");
  const authorization = page.indexOf("await assertOrganizationRole(");
  const companyWide = page.indexOf("if (denied || !access?.companyWide");
  const entityScope = page.indexOf("await resolveMultiEntityContext(");
  const groupDenial = page.indexOf("entityScope.context.legalEntityId !== null");
  const firstRead = page.indexOf("const [orgs, workforce, team, entityRegistrations]");
  assert.ok(session >= 0 && selector > session &&
    authorization > selector && companyWide > authorization &&
    entityScope > companyWide && groupDenial > entityScope &&
    firstRead > groupDenial,
    "Active session, canonical selector, company-wide People role and legal-employer boundary precede SQL reads");
  assert.match(page, /entityScope\.context\.enabled\s*\?\s*db\.select\(/,
    "The multi-entity release flag OFF must not query legal-employer tables");
  assert.match(page, /eq\(legalEntities\.active, true\)/);
  assert.doesNotMatch(page, /db\.(?:insert|update|delete)\(|payrollEngine|createPayrollRun/);
});

test("exact-head PG16 proof requires real owned pages, two foreign denials, roles and SQL unchanged", () => {
  for (const marker of [
    'requireDisposableClientOnboardingEnv();',
    'import("../../src/db/index.ts")',
    'seedEmployer("ATTA"',
    'seedEmployer("ATTB"',
    'seedEmployer("VICTIM"',
    'for (const actor of [a, b])',
    'assertOwnOnboardingPage(myPage, actor,',
    'assertDeniedOnboardingPage(denied, employers, "authenticated cross-employer")',
    'assert.equal(ownPages, 2)',
    'assert.equal(deniedForeign, 4)',
    'assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)',
    '"unit-scoped admin"',
    '"revoked membership"',
    'pageCredits: 0, methodCredits: 0, productionCertified: false',
  ]) assert.ok(proof.includes(marker), "Missing SSR tenant proof control: " + marker);
  assert.ok(proof.indexOf("requireDisposableClientOnboardingEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "Unsafe environment must refuse before database import");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-client-onboarding-page-http\.mjs/);
  assert.ok(workflow.includes('"src/app/app/client-onboarding/**"'));
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
});
