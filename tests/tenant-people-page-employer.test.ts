import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalPeoplePageOrganizationId } from "../src/lib/tenant-people-page-employer";

test("People employer selectors accept only canonical positive safe decimal IDs", () => {
  for (const id of [1, 2, 99, 9007199254740991]) {
    assert.equal(canonicalPeoplePageOrganizationId(String(id)), id);
  }
  for (const supplied of [
    undefined, null, "", " ", "0", "-1", "+1", "01", "1e0", "1.0",
    " 1", "1 ", "1\n", "0x01", "Infinity", "NaN",
    "9007199254740992", ["1"], ["1", "2"], 1, true, {},
  ]) {
    assert.equal(canonicalPeoplePageOrganizationId(supplied), null,
      "Selector must be rejected: " + JSON.stringify(supplied));
  }
});

test("engagement SSR must reject foreign, unit-only, unauthorised and group access before client mount", () => {
  const page = readFileSync("src/app/app/engagement/page.tsx", "utf8");
  const gates = [
    "getSessionUser()", "raw === undefined",
    "canonicalPeoplePageOrganizationId(raw)",
    "assertMembership(session.id, organizationId)",
    "getAccess(session.id, organizationId)",
    "singleLegalEntityForTenant(organizationId)",
    'access.role === "employee"',
    "assertOrganizationRole(session.id, organizationId, PEOPLE_ADMIN_ROLES)",
    "<EngagementSurveyPage organizationId={organizationId}",
  ];
  let previous = -1;
  for (const gate of gates) {
    const index = page.indexOf(gate);
    assert.ok(index > previous, "Engagement boundary missing/out-of-order: " + gate);
    previous = index;
  }
  assert.match(page, /!access\.companyWide/);
  assert.match(page, /Number\.isSafeInteger\(session\.employeeId\)/);
  assert.doesNotMatch(page, /raw\s*\?\s*Number\(raw\)/);
});

test("Goals & Reviews SSR checks the employer grant and legal-entity boundary before querying cycles", () => {
  const page = readFileSync("src/app/app/goals-reviews/page.tsx", "utf8");
  const gates = [
    "getSessionUser()", "raw === undefined",
    "canonicalPeoplePageOrganizationId(raw)",
    "assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)",
    "getAccess(user.id, organizationId)",
    "singleLegalEntityForTenant(organizationId)",
    ".from(performanceCycles)",
    ".where(and(eq(performanceCycles.organizationId, organizationId)))",
  ];
  let previous = -1;
  for (const gate of gates) {
    const index = page.indexOf(gate);
    assert.ok(index > previous, "Goals boundary missing/out-of-order: " + gate);
    previous = index;
  }
  assert.match(page, /!access\?\.companyWide/);
  assert.doesNotMatch(page, /raw\s*\?\s*Number\(raw\)/);
});
