import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source contract only. Real, two-attacker PostgreSQL/HTTP page verification
// remains necessary before crediting this manifest GAP as covered.
const page = readFileSync("src/app/billing/setup/page.tsx", "utf8");
const billingApi = readFileSync("src/app/api/billing/route.ts", "utf8");

test("billing setup checks the active tenant's billing role and company-wide scope before any employer read", () => {
  const roleCheck = page.indexOf("await assertOrganizationRole(");
  const scopeCheck = page.indexOf("await getAccess(");
  const organizationRead = page.indexOf("await db.select(");
  assert.ok(roleCheck >= 0, "SSR billing page must authorize the selected organization");
  assert.ok(scopeCheck > roleCheck, "SSR billing page must resolve effective scope after role authorization");
  assert.ok(organizationRead > scopeCheck, "No employer details may be loaded before billing authorization");
  assert.match(page, /BILLING_ADMIN_ROLES,/);
  assert.match(page, /if \(denied\) notFound\(\);/);
  assert.match(page, /if \(!access\?\.companyWide\) notFound\(\);/);
});

test("billing setup never renders a fallback employer identity after a missing organization", () => {
  assert.match(page, /if \(!org\) notFound\(\);/);
  assert.match(page, /companyName=\{org\.name\}/);
  assert.doesNotMatch(page, /org\?\.name\s*\|\|/);
  assert.doesNotMatch(page, /searchParams/);
});

test("SSR billing authorization mirrors the existing billing API rule", () => {
  assert.match(billingApi, /await assertOrganizationRole\([\s\S]*?BILLING_ADMIN_ROLES/);
  assert.match(billingApi, /!access\?\.companyWide/);
  assert.match(page, /BILLING_ADMIN_ROLES/);
  assert.match(page, /!access\?\.companyWide/);
});
