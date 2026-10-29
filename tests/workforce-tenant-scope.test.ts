import assert from "node:assert/strict";
import test from "node:test";
import { coherentWorkforceTenantScope } from "../src/lib/workforce-tenant-scope";
import { authorizedOutlookSite } from "../src/lib/workforce-demand-outlook-scope";

const company = { organizationId: 7, companyWide: true, orgUnitId: null };
const unit = { organizationId: 7, companyWide: false, orgUnitId: 21 };
const activeSite = { organizationId: 7, orgUnitId: 21, active: true };

test("valid company-wide and assigned-unit employer scopes remain authorized", () => {
  assert.equal(coherentWorkforceTenantScope(company, 7), true);
  assert.equal(coherentWorkforceTenantScope(unit, 7), true);
  assert.equal(authorizedOutlookSite(company, activeSite), true);
  assert.equal(authorizedOutlookSite(company,
    { organizationId: 7, orgUnitId: null, active: true }), true);
  assert.equal(authorizedOutlookSite(unit, activeSite), true);
});

test("foreign employers, other units and inactive worksites stay denied", () => {
  assert.equal(coherentWorkforceTenantScope(company, 8), false);
  assert.equal(authorizedOutlookSite(company,
    { organizationId: 8, orgUnitId: 21, active: true }), false);
  assert.equal(authorizedOutlookSite(unit,
    { organizationId: 7, orgUnitId: 22, active: true }), false);
  assert.equal(authorizedOutlookSite(unit,
    { organizationId: 7, orgUnitId: null, active: true }), false);
  assert.equal(authorizedOutlookSite(unit,
    { organizationId: 7, orgUnitId: 21, active: false }), false);
});

test("malformed company/unit access never creates company-wide access", () => {
  const invalid = [
    null, undefined,
    { organizationId: 7, companyWide: true, orgUnitId: 21 },
    { organizationId: 7, companyWide: false, orgUnitId: null },
    { organizationId: 7, companyWide: false, orgUnitId: 0 },
    { organizationId: 7, companyWide: false, orgUnitId: -1 },
    { organizationId: 7, companyWide: false, orgUnitId: 1.5 },
    { organizationId: 7, companyWide: false, orgUnitId: Number.MAX_SAFE_INTEGER + 1 },
    { organizationId: 0, companyWide: true, orgUnitId: null },
    { organizationId: 7.5, companyWide: true, orgUnitId: null },
    { organizationId: Number.MAX_SAFE_INTEGER + 1, companyWide: true, orgUnitId: null },
    { organizationId: 7, companyWide: "true", orgUnitId: null },
    { organizationId: 7, companyWide: 1, orgUnitId: null },
    { organizationId: 7, companyWide: null, orgUnitId: null },
  ];
  for (const candidate of invalid) {
    const access = candidate as typeof company | null | undefined;
    assert.equal(coherentWorkforceTenantScope(access, 7), false, JSON.stringify(candidate));
    if (access) {
      assert.equal(authorizedOutlookSite(access, activeSite), false, JSON.stringify(candidate));
    }
  }
  for (const id of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
    assert.equal(coherentWorkforceTenantScope(company, id), false);
  }
});

test("malformed worksite metadata cannot authorize unit data", () => {
  for (const orgUnitId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(authorizedOutlookSite(unit,
      { organizationId: 7, orgUnitId, active: true }), false);
  }
  assert.equal(authorizedOutlookSite(company,
    { organizationId: 7, orgUnitId: 21, active: "true" as unknown as boolean }), false);
});
