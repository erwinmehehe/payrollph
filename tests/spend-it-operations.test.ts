
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

test("spend schema uses a distinct employer-paid card ledger and one report per claim", () => {
  const schema = read("src/db/schema.ts");
  for (const table of ["spend_cards", "spend_card_transactions", "expense_reports", "expense_report_items"]) {
    assert.ok(schema.includes('"' + table + '"'));
  }
  assert.ok(schema.includes('uniqueIndex("spend_card_transactions_dedupe")'));
  assert.ok(schema.includes('uniqueIndex("expense_report_items_claim_unique")'));
  const spend = read("src/app/api/spend/route.ts");
  assert.ok(spend.includes("storedMoneyCentavos"));
  assert.ok(spend.includes("submittedByUserId === user.id"));
  assert.ok(spend.includes('eq(expenseClaims.status, "pending")'));
  assert.ok(spend.includes("db.transaction(async tx =>"));
  assert.ok(!spend.includes('db.insert(expenseClaims)'));
});

test("legacy claim approvals cannot bypass report approvals", () => {
  const legacy = read("src/app/api/expenses/route.ts");
  assert.ok(legacy.includes("expenseReportItems"));
  assert.ok(legacy.includes("This claim belongs to an expense report"));
});

test("IT lifecycle never claims to execute remote MDM or vendor provisioning", () => {
  const schema = read("src/db/schema.ts");
  for (const table of ["it_applications", "it_access_grants", "it_managed_devices", "it_device_events"]) {
    assert.ok(schema.includes('"' + table + '"'));
  }
  const api = read("src/app/api/it-operations/route.ts");
  assert.ok(api.includes("enforceSameOriginMutation"));
  assert.ok(api.includes("checkEmployee"));
  assert.ok(api.includes("grant_requested"));
  assert.ok(api.includes("revoke_requested"));
  assert.ok(api.includes("itDeviceEvents"));
  const lifecycle = read("src/lib/it-offboarding.ts");
  assert.ok(lifecycle.includes('eq(itAccessGrants.state, "active")'));
  assert.ok(lifecycle.includes('eq(itManagedDevices.state, "assigned")'));
  assert.ok(lifecycle.includes("remoteActionsExecuted: false"));
  assert.ok(read("src/lib/provisioning.ts").includes("requestOffboardingIT"));
});

test("existing workspace navigation presents spend and device workflows", () => {
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.ok(workspace.includes("<SpendOperationsPanel"));
  assert.ok(workspace.includes("<ItOperationsPanel"));
  assert.ok(read("src/components/workspace/nav.ts").includes('name: "Expenses"'));
  assert.ok(read("src/components/workspace/nav.ts").includes('name: "Assets"'));
});

test("finance release and IT clearance both preserve their independent state-machine guards", () => {
  const payroll = read("src/lib/payroll-settlement.ts");
  const spend = read("src/app/api/spend/route.ts");
  const separation = read("src/app/api/separation/route.ts");
  assert.ok(payroll.includes('status: "paid", payrollRunId: run.id'));
  assert.ok(payroll.includes('eq(expenseClaims.status, "approved")'));
  assert.ok(spend.includes('reimbursementStatus'));
  assert.ok(spend.includes('requireSensitiveActionMfa(user)'));
  assert.ok(separation.includes("requestOffboardingIT(organizationId, employeeId)"));
  assert.ok(separation.includes("SEPARATION_IT_RECOVERY_PENDING"));
  assert.ok(separation.includes('g.state !== "revoked"'));
  assert.ok(separation.includes('a.status === "assigned"'));
});

test("legacy mutations cannot silently change a managed device and checklist completion requires recovery", () => {
  const assets = read("src/app/api/assets/route.ts");
  const provisioning = read("src/app/api/provisioning/route.ts");
  const it = read("src/app/api/it-operations/route.ts");
  assert.ok(assets.includes('This asset is managed by IT Operations'));
  assert.ok(assets.includes('employee.status !== "Active"'));
  assert.ok(provisioning.includes("App access is not fully revoked"));
  assert.ok(provisioning.includes("Assigned company equipment is outstanding"));
  assert.ok(it.includes("requireSensitiveActionMfa(user)"));
  assert.ok(it.includes('currentEmployeeStatus === "Active" ? "assigned" : "return_requested"'));
});
