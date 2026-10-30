import assert from "node:assert/strict";
import { verifyPost1523Credits } from "../scripts/qa/tenant-post1523-credit-verify.mjs";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SAFE_ENV, requireDisposableBenefitCatalog, assertOwnedDefaultPlans,
  assertCatalogResponse, assertCatalogUnchanged,
} from "../scripts/qa/tenant-benefit-catalog-put-contract.mjs";

const path = "src/app/api/benefits/route.ts";
const source = () => readFileSync(path, "utf8");
const putBody = code => code.slice(code.indexOf("export async function PUT("));

test("three-employer proof fails closed before DB imports on any unsafe target or provider", () => {
  assert.equal(requireDisposableBenefitCatalog(SAFE_ENV), true);
  for (const [key, value] of Object.entries(SAFE_ENV)) {
    assert.throws(() => requireDisposableBenefitCatalog({ ...SAFE_ENV, [key]: undefined }),
      /BENEFIT_CATALOG_PROOF_REFUSED/, key);
    assert.throws(() => requireDisposableBenefitCatalog({
      ...SAFE_ENV, [key]: value === "false" ? "true" : "false",
    }), /BENEFIT_CATALOG_PROOF_REFUSED/, key);
  }
  for (const [key, value] of [
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example.invalid:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/live_data"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["APP_BASE_URL", "https://real.example.com"],
    ["XENDIT_BILLING_ENABLED", "true"],
  ]) {
    assert.throws(() => requireDisposableBenefitCatalog({ ...SAFE_ENV, [key]: value }),
      /BENEFIT_CATALOG_PROOF_REFUSED/);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "NEON_DATABASE_URL",
  ]) {
    assert.throws(() => requireDisposableBenefitCatalog({
      ...SAFE_ENV, [key]: "fictional-must-still-be-refused",
    }), /BENEFIT_CATALOG_PROOF_REFUSED/, key);
  }
});

function guardSource(src) {
  const put = putBody(src);
  assert.ok(put.startsWith("export async function PUT("));
  for (const guard of [
    "enforceSameOriginMutation(request)",
    "const user = await getSessionUser();",
    "parseCatalogEmployerId(",
    "assertOrganizationRole(",
    "ORG_ADMIN_ROLES",
    "if (!access?.companyWide)",
    "await db.transaction(async tx => {",
    "eq(userOrganizations.userId, user.id)",
    "eq(userOrganizations.organizationId, organizationId)",
    "eq(userOrganizations.active, true)",
    "inArray(userOrganizations.role, [...ORG_ADMIN_ROLES])",
    "isNull(userOrganizations.orgUnitId)",
    '.for("share").limit(1)',
    "if (!grant) return { denied: true, seeded: false };",
    "pg_advisory_xact_lock(4459,",
    "isNull(benefitPlans.organizationId)",
    "eq(benefitPlans.organizationId, organizationId)",
    "defaultEmployerBenefitPlans(organizationId)",
    "await tx.insert(benefitPlans).values(defaults)",
    "await tx.insert(auditEvents).values({",
    "globalCatalogChanged: false",
  ]) assert.ok(put.includes(guard), "Missing critical tenant catalog guard: " + guard);
  assert.ok(put.indexOf("assertOrganizationRole(") < put.indexOf("await db.transaction("));
  assert.ok(put.indexOf(".for(\"share\").limit(1)") < put.indexOf("tx.insert(benefitPlans)"));
  assert.ok(put.indexOf("pg_advisory_xact_lock(4459,") < put.indexOf("tx.insert(benefitPlans)"));
  assert.ok(put.indexOf("tx.insert(benefitPlans)") < put.indexOf("tx.insert(auditEvents)"));
  assert.doesNotMatch(put, /organizationId:\s*null/, "tenant admin cannot insert globally shared plans");
  assert.doesNotMatch(put, /\.from\(benefitPlans\)\s*;/,
    "global unscoped existence probes must not block other employers");
  return true;
}
test("actual PUT uses active same-employer grant, lock, audit and exact scoped inserts", () => {
  assert.equal(guardSource(source()), true);
});
test("source negative controls detect missing tenant, locking and audit boundaries", () => {
  for (const needle of [
    "eq(userOrganizations.organizationId, organizationId)",
    "eq(userOrganizations.active, true)",
    "inArray(userOrganizations.role, [...ORG_ADMIN_ROLES])",
    "isNull(userOrganizations.orgUnitId)",
    "pg_advisory_xact_lock(4459,",
    "eq(benefitPlans.organizationId, organizationId)",
    "defaultEmployerBenefitPlans(organizationId)",
    "await tx.insert(auditEvents).values({",
  ]) {
    const original = source();
    assert.ok(original.includes(needle));
    assert.throws(() => guardSource(original.replaceAll(needle, "/* removed */")),
      undefined, "dropping " + needle + " must fail the source test");
  }
});
test("synthetic response or foreign/global plans never count as real own success", () => {
  const rows = [1, 2, 3, 4, 5].map(id => ({
    id, name: [
      "HMO, Maxicare Plan A", "Group life & accident", "Pag-IBIG MP2",
      "SSS Flexi-Fund", "Rice allowance",
    ][id - 1], organizationId: 41,
  }));
  assertOwnedDefaultPlans(rows, 41);
  assert.throws(() => assertOwnedDefaultPlans(rows, 99));
  assert.throws(() => assertOwnedDefaultPlans(rows.map(row => ({
    ...row, organizationId: null,
  })), 41));
  assert.throws(() => assertOwnedDefaultPlans(rows.slice(0, 4), 41));
  const reply = { status: 200, json: { ok: true, seeded: true },
    headers: new Headers({ "cache-control": "private, no-store" }) };
  assertCatalogResponse(reply, true, "owned PUT");
  assert.throws(() => assertCatalogResponse({
    ...reply, json: { ok: true, seeded: false },
  }, true, "false own 200"));
  assert.throws(() => assertCatalogResponse({
    ...reply, headers: new Headers({ "cache-control": "public, max-age=60" }),
  }, true, "unsafe cache"));
  assert.throws(() => assertCatalogUnchanged({ plans: [41] }, { plans: [99] }, "foreign"));
});

test("candidate runner remains provisional while the separate three-method ledger is source-pinned", () => {
  const runner = readFileSync("scripts/qa/tenant-benefit-catalog-put-http.mjs", "utf8");
  assert.ok(runner.indexOf("requireDisposableBenefitCatalog();") >
    runner.indexOf("export async function proveTenantBenefitCatalogPut()"));
  assert.ok(runner.indexOf("requireDisposableBenefitCatalog();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "disposable gate must run before any DB/app module import");
  for (const proof of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    'const [bFirst, bSecond] = await Promise.all',
    "higher-SQL-ID employer",
    "assertOwnedDefaultPlans(after[i].plans",
    'assert.equal(deny.status, 403',
    "same-session PUT",
    "globalPlans",
    "await checkAllUnchanged(",
    "credits: 0, independentlyAccepted: false",
  ]) assert.ok(runner.includes(proof), "Missing real PG16 HTTP contract: " + proof);
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const methods = manifest.allApiRouteFiles[path].methods;
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal(methods.find(row => row.name === method)?.status, "COVERED");
  }
  const put = methods.find(row => row.name === "PUT");
  assert.equal(put.status, "COVERED");
  assert.equal(put.testedBy?.file, "scripts/qa/tenant-benefit-catalog-put-http.mjs");
  assert.equal(put.testedBy?.workflowRunId, 40839189888);
  assert.equal(put.testedBy?.productionCertified, false);
  assert.match(put.testedBy?.independentReview, /^PENDING:/);
  assert.equal(verifyPost1523Credits(manifest), 3);
});
