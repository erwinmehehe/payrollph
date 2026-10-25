import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workforceAllocationResponseMatchesEmployer } from "../src/lib/workforce-plan-allocation-view";

function scopedResponse() {
  return {
    access: {
      role: "manager", companyWide: false, orgUnitId: 10,
      canManageAllocations: false, canDecideSubmissions: false,
    },
    allocations: [{
      id: 101, organizationId: 21, planId: 31, orgUnitId: 10,
      orgUnitName: "Fictional unit A", headcountCeiling: 5, annualBudgetCeiling: "5000.00",
    }],
    submissions: [{
      id: 201, organizationId: 21, planId: 31, allocationId: 101, orgUnitId: 10,
      version: 1, requestedHeadcount: 3, requestedAnnualBudget: "2000.00",
      status: "draft", rationale: "Fictional scenario", canSubmit: true, canDecide: false,
    }],
  };
}

function withChange(change: (value: ReturnType<typeof scopedResponse>) => void) {
  const value = scopedResponse();
  change(value);
  return value;
}

const matches = workforceAllocationResponseMatchesEmployer;

test("one-employer planning reads accept valid data or a genuinely empty response", () => {
  assert.equal(matches(scopedResponse(), 21), true);
  assert.equal(matches(withChange((item) => {
    item.allocations = []; item.submissions = [];
  }), 21), true);
  assert.equal(matches(scopedResponse(), 22), false);
});

test("mixed tenant payloads never become a 200/empty success or display foreign budgets", () => {
  assert.equal(matches(withChange((item) => { item.access.role = ""; }), 21), false);
  assert.equal(matches(withChange((item) => { item.allocations[0].organizationId = 22; }), 21), false);
  assert.equal(matches(withChange((item) => { item.submissions[0].organizationId = 22; }), 21), false);
  assert.equal(matches(withChange((item) => { item.access.orgUnitId = 11; }), 21), false);
  assert.equal(matches(withChange((item) => { item.submissions[0].orgUnitId = 11; }), 21), false);
});

test("manager submissions must refer to a visible, matching plan/unit allocation", () => {
  assert.equal(matches(withChange((item) => { item.submissions[0].allocationId = 999; }), 21), false);
  assert.equal(matches(withChange((item) => { item.submissions[0].planId = 32; }), 21), false);
  assert.equal(matches(withChange((item) => { item.allocations[0].id = 0; }), 21), false);
  assert.equal(matches(withChange((item) => { item.allocations.push({ ...item.allocations[0] }); }), 21), false);
  assert.equal(matches(withChange((item) => { item.access.companyWide = true; }), 21), true);
});

test("malformed reads and invalid monetary amounts remain unavailable", () => {
  assert.equal(matches(null, 21), false);
  assert.equal(matches({}, 21), false);
  assert.equal(matches({ organizationId: 21, allocations: [], submissions: [] }, 21), false);
  assert.equal(matches(withChange((item) => { item.allocations = null as unknown as typeof item.allocations; }), 21), false);
  assert.equal(matches(withChange((item) => { item.access.canDecideSubmissions = null as unknown as boolean; }), 21), false);
  assert.equal(matches(withChange((item) => { item.allocations[0].annualBudgetCeiling = "NaN"; }), 21), false);
  assert.equal(matches(withChange((item) => { item.submissions[0].requestedAnnualBudget = "Infinity"; }), 21), false);
  assert.equal(matches(withChange((item) => { item.submissions[0].requestedHeadcount = -1; }), 21), false);
});

test("UI validates scoped row evidence before showing planning data without changing the reviewed API", () => {
  const route = readFileSync("src/app/api/workforce-planning/allocations/route.ts", "utf8");
  const get = route.split("export async function GET")[1]?.split("export async function POST")[0] ?? "";
  const panel = readFileSync("src/components/workforce-plan-allocation-panel.tsx", "utf8");
  assert.ok(get.includes("assertOrganizationRole("));
  assert.ok(get.includes("eq(workforcePlanAllocations.organizationId, organizationId)"));
  assert.ok(get.includes("eq(workforcePlanManagerSubmissions.organizationId, organizationId)"));
  const guard = panel.indexOf("workforceAllocationResponseMatchesEmployer(payload, organizationId)");
  const accept = panel.indexOf("setAllocations(nextAllocations)");
  assert.ok(guard >= 0 && guard < accept, "scope must be verified before showing planning records");
  assert.ok(panel.includes("setLoadedOrganizationId(null)"));
  assert.ok(panel.includes("setSubmissions([])"));
  assert.ok(panel.includes("No planning allocations are shown until the request succeeds."));
});
