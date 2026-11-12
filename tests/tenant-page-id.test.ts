import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalTenantPageId } from "../src/lib/tenant-page-id";

test("page-level employer selectors accept only one canonical safe positive integer", () => {
  for (const value of ["1", "2", "100", String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(canonicalTenantPageId(value), Number(value));
  }
  for (const value of [
    undefined, null, 1, 0, false, [], ["1"], ["1", "2"],
    "", "0", "-1", "+1", "01", "1.0", "1e0", "1 ", " 1",
    "1\\n", "9007199254740992", "Infinity", "1x", {},
  ]) {
    assert.equal(canonicalTenantPageId(value), null,
      "Must reject ambiguous tenant selector " + JSON.stringify(value));
  }
});

test("billing manage checks session, employer, role, and company scope before redirect", () => {
  const code = readFileSync("src/app/billing/manage/page.tsx", "utf8");
  const session = code.indexOf("await getSessionUser()");
  const selected = code.indexOf("canonicalTenantPageId(selected)");
  const role = code.indexOf("await assertOrganizationRole(");
  const scope = code.indexOf("await getAccess(");
  const target = code.indexOf("redirect(`/billing/setup?organizationId=${organizationId}`)");
  assert.ok(session >= 0 && selected > session && role > selected &&
    scope > role && target > scope, "Never redirect before checking the selected employer");
  assert.match(code, /selected === undefined[\s\S]*primaryCompanyOrganizationId\(user\.id\)/);
  assert.match(code, /if \(!organizationId\) notFound\(\)/);
  assert.match(code, /BILLING_ADMIN_ROLES/);
  assert.match(code, /if \(denied \|\| !access\?\.companyWide\) notFound\(\)/);
  assert.doesNotMatch(code, /permanentRedirect/);
  assert.doesNotMatch(code, /redirect\(["']\/billing\/setup["']\)/,
    "A bare billing/setup target loses a multi-client user's selected employer");
});

