import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canSyncLinkedEmployeeEmail } from "../src/lib/account";

const own = {
  userId: 11,
  role: "employee",
  employeeId: 17,
  employee: { id: 17, organizationId: 41 },
  membership: {
    userId: 11,
    organizationId: 41,
    active: true,
    role: "employee",
    workerEmployeeId: 17,
  },
};

test("verified account email may update only its actively linked ESS worker", () => {
  assert.equal(canSyncLinkedEmployeeEmail(own), true);
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, workerEmployeeId: null },
  }), true, "legacy null worker link may rely on the account ESS pointer and same-employer membership");
});

test("another employer grant never authorizes a foreign linked worker", () => {
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, employee: { id: 17, organizationId: 99 },
  }), false, "victim employer does not match actor membership");
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, employeeId: 99,
  }), false, "account ESS pointer must match the locked worker row");
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, organizationId: 99 },
  }), false, "an unrelated active employer grant is not a worker grant");
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, userId: 12 },
  }), false, "membership belongs to another user");
});

test("revoked, incompatible and unassigned links fail closed", () => {
  assert.equal(canSyncLinkedEmployeeEmail({ ...own, membership: null }), false);
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, active: false },
  }), false);
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, role: "group_hr" },
  }), false);
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, role: "owner" },
  }), false);
  assert.equal(canSyncLinkedEmployeeEmail({
    ...own, membership: { ...own.membership, workerEmployeeId: 999 },
  }), false, "explicit worker grant cannot point to another employee");
  assert.equal(canSyncLinkedEmployeeEmail({ ...own, role: "owner" }), false);
  assert.equal(canSyncLinkedEmployeeEmail({ ...own, employeeId: null }), false);
  assert.equal(canSyncLinkedEmployeeEmail({ ...own, employee: null }), false);
});

test("verification source locks token and current tenant grant, and scopes the worker UPDATE", () => {
  const source = readFileSync("src/app/api/account/email/verify/route.ts", "utf8");
  assert.match(source, /eq\(emailChangeTokens\.tokenHash, sha256\(token\)\)/);
  assert.match(source, /isNull\(emailChangeTokens\.usedAt\)/);
  assert.match(source, /for\("update"\)/, "token, account and employee must be locked before update");
  assert.match(source, /for\("share"\)/, "active employer grant must be locked before worker update");
  assert.match(source, /eq\(userOrganizations\.userId, currentAccount\.id\)/);
  assert.match(source, /eq\(userOrganizations\.organizationId, linkedEmployee\.organizationId\)/);
  assert.match(source, /eq\(userOrganizations\.active, true\)/);
  assert.match(source, /canSyncLinkedEmployeeEmail\(/);
  assert.match(source, /eq\(employees\.organizationId, linkedEmployee\.organizationId\)/);
  assert.match(source, /if \(currentAccount\.employeeId != null\)/);
  assert.doesNotMatch(source, /where\(eq\(employees\.id, account\.employeeId\)\)/,
    "never update employee contact by an unscoped account pointer");
});
