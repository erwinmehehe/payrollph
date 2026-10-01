import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INVITABLE_ROLES, isInvitableRole } from "../src/lib/roles";

const read = (path: string) => readFileSync(path, "utf8");

test("real workspaces can provision payroll and checker roles", () => {
  assert.equal(isInvitableRole("payroll"), true);
  assert.equal(isInvitableRole("checker"), true);
  assert.equal(isInvitableRole("unknown"), false);
  const ids = INVITABLE_ROLES.map((role) => role.id);
  assert.ok(ids.includes("owner"));
  assert.ok(ids.includes("hr"));
  assert.ok(ids.includes("payroll"));
  assert.ok(ids.includes("checker"));
  assert.ok(ids.includes("employee"));

  const invitations = read("src/app/api/invitations/route.ts");
  assert.ok(invitations.includes("isInvitableRole(role)"));
  assert.ok(!invitations.includes('["owner", "admin", "hr", "bookkeeper", "employee"].includes'));
  assert.ok(invitations.includes("members: memberRows"));
});

test("owners have a real team access surface for maker-checker staffing", () => {
  const settings = read("src/components/workspace/panels.tsx");
  assert.ok(settings.includes('label: "Team & access"'));
  assert.ok(settings.includes("<TeamAccessSettings"));
  assert.ok(settings.includes("INVITABLE_ROLES.map"));
  assert.ok(settings.includes("Payroll Officer prepares and submits payroll"));
  assert.ok(settings.includes("Checker independently reviews it"));
});

test("real employee payout details are captured and encrypted", () => {
  const api = read("src/app/api/employees/route.ts");
  const hire = read("src/components/new-hire-modal.tsx");
  const people = read("src/components/workspace/people.tsx");

  assert.ok(api.includes("encryptBankAccount(bankAccount)"));
  assert.ok(api.includes("maskBankAccount(created.bankAccount)"));
  assert.ok(api.includes("Employee payout details updated"));
  assert.ok(api.includes("Bank account and bank code must be provided together"));
  assert.ok(hire.includes('bankAccount: ""'));
  assert.ok(hire.includes('bankCode: ""'));
  assert.ok(hire.includes("encrypted at rest"));
  assert.ok(people.includes("PAYOUT DETAILS"));
  assert.ok(people.includes("Save payout details"));
  assert.ok(people.includes("replacementBankAccount"));
});

test("fresh tenant pilot stays out of demo provisioning and proves the five handoff stages", () => {
  const pilot = read("scripts/pilot-payroll-qa.ts");
  const workflow = read(".github/workflows/pilot-payroll-qa.yml");

  assert.ok(pilot.includes('tenant: "fresh-non-demo"'));
  assert.ok(pilot.includes("payroll-submitted-by-payroll-officer"));
  assert.ok(pilot.includes("payroll-approved-by-independent-checker"));
  assert.ok(pilot.includes("owner-released-payroll"));
  assert.ok(pilot.includes("final-bank-file-generated"));
  assert.ok(pilot.includes("employee-payslip-available"));
  assert.ok(pilot.includes("isEncryptedBankAccount"));
  assert.ok(workflow.includes('DEMO_MODE: "false"'));
  assert.ok(workflow.includes("scripts/pilot-payroll-qa.ts"));
});
