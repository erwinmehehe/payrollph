import assert from "node:assert/strict";
import test from "node:test";
import { receiptGrantMatches } from "../src/lib/spend-receipt-tenant";

const staffRoles = ["owner", "admin", "bookkeeper", "hr", "payroll"] as const;
const own = {
  userId: 11,
  accountRole: "employee",
  accountEmployeeId: 27,
  claim: { organizationId: 80, employeeId: 27 },
  employee: { id: 27, organizationId: 80, orgUnitId: 3 },
  membership: {
    userId: 11,
    organizationId: 80,
    role: "employee",
    active: true,
    orgUnitId: null,
    workerEmployeeId: 27,
  },
};

test("private receipt is available to its active, same-employer employee grant", () => {
  assert.equal(receiptGrantMatches(own, staffRoles), true);
  assert.equal(receiptGrantMatches({
    ...own,
    membership: { ...own.membership, workerEmployeeId: null },
  }, staffRoles), true, "legacy null worker link still requires account ESS pointer and same-employer grant");
});

test("a forged, reassigned or cross-employer worker cannot read or upload receipts", () => {
  const bad = [
    { ...own, claim: { ...own.claim, employeeId: 888 } },
    { ...own, claim: { ...own.claim, organizationId: 900 } },
    { ...own, employee: { ...own.employee, organizationId: 900 } },
    { ...own, employee: { ...own.employee, id: 888 } },
    { ...own, accountEmployeeId: 888 },
    { ...own, accountEmployeeId: null },
    { ...own, membership: { ...own.membership, userId: 99 } },
    { ...own, membership: { ...own.membership, organizationId: 900 } },
    { ...own, membership: { ...own.membership, workerEmployeeId: 888 } },
    { ...own, membership: { ...own.membership, role: "owner" } },
    { ...own, membership: { ...own.membership, role: "group_hr" } },
    { ...own, membership: { ...own.membership, active: false } },
    { ...own, membership: null },
    { ...own, employee: null },
    { ...own, userId: 0 },
    { ...own, claim: { ...own.claim, organizationId: 0 } },
  ];
  for (const [index, input] of bad.entries()) {
    assert.equal(receiptGrantMatches(input, staffRoles), false,
      "invalid receipt worker/employer grant at scenario " + index);
  }
});

test("preauthorized People/payroll staff retain only current employer and unit grants", () => {
  const staff = {
    ...own,
    accountRole: "owner",
    accountEmployeeId: null,
    membership: { ...own.membership, role: "owner", workerEmployeeId: null },
  };
  assert.equal(receiptGrantMatches(staff, staffRoles), true, "company-wide owner");
  assert.equal(receiptGrantMatches({
    ...staff,
    membership: { ...staff.membership, role: "hr", orgUnitId: 3 },
  }, staffRoles), true, "HR assigned to the employee unit");
  for (const input of [
    { ...staff, membership: { ...staff.membership, role: "hr", orgUnitId: 99 } },
    { ...staff, membership: { ...staff.membership, role: "hr", orgUnitId: -1 } },
    { ...staff, membership: { ...staff.membership, role: "group_hr" } },
    { ...staff, membership: { ...staff.membership, role: "employee" } },
    { ...staff, membership: { ...staff.membership, active: false } },
    { ...staff, membership: { ...staff.membership, organizationId: 90 } },
    { ...staff, employee: { ...own.employee, organizationId: 90 } },
  ]) {
    assert.equal(receiptGrantMatches(input, staffRoles), false);
  }
  assert.equal(receiptGrantMatches({
    ...staff,
    employee: { ...own.employee, orgUnitId: null },
    membership: { ...staff.membership, role: "hr", orgUnitId: 3 },
  }, staffRoles), false, "a unit-scoped staff grant never authorizes a company-wide worker");
});
