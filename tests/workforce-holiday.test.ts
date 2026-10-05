import assert from "node:assert/strict";
import test from "node:test";
import { workforceHolidayApplies } from "../src/lib/workforce-holiday";

const orgScope = new Set([10, 20]);

test("organization-wide local holiday applies regardless of resolved worksite", () => {
  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: null, worksiteId: null },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 501,
  }), true);
});

test("org-unit holiday still requires employee org-unit scope", () => {
  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: 20, worksiteId: null },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 501,
  }), true);

  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: 99, worksiteId: null },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 501,
  }), false);
});

test("worksite holiday applies only to the resolved worksite on that date", () => {
  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: null, worksiteId: 501 },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 501,
  }), true);

  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: null, worksiteId: 501 },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 777,
  }), false);

  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: null, worksiteId: 501 },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: null,
  }), false);
});

test("combined org-unit and worksite scope requires both conditions", () => {
  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: 20, worksiteId: 501 },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 501,
  }), true);

  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: 99, worksiteId: 501 },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 501,
  }), false);

  assert.equal(workforceHolidayApplies({
    holiday: { orgUnitId: 20, worksiteId: 501 },
    employeeOrgUnitScopeIds: orgScope,
    resolvedWorksiteId: 777,
  }), false);
});
