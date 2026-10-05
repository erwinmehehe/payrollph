import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/government-loan-remittances/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const panel = readFileSync("src/components/government-loan-remittance-panel.tsx", "utf8");
const loansPanel = readFileSync("src/components/loans-panel.tsx", "utf8");

test("government loan remittance is separate from ordinary loan balance tracking", () => {
  assert.ok(schema.includes('export const governmentLoanRemittanceBatches = pgTable('));
  assert.ok(schema.includes('export const governmentLoanRemittanceMembers = pgTable('));
  assert.ok(schema.includes('loanId: integer("loan_id").notNull().references(() => employeeLoans.id'));
  assert.ok(schema.includes('deductedAmount: numeric("deducted_amount"'));
});

test("remittance snapshot is restricted to closed months and released payroll", () => {
  assert.ok(route.includes("applicableMonth >= currentManilaMonth()"));
  assert.ok(route.includes('run.status !== "Released"'));
  assert.ok(route.includes("buildGovernmentLoanRemittanceSnapshot"));
  assert.ok(route.includes("payrollEntries.lineItems"));
});

test("government loan remittance mutations are payroll-only, company-wide and MFA protected", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("!access.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
});

test("payment and loan posting are separate immutable reconciliation stages", () => {
  assert.ok(route.includes("Loan remittance payment evidence is immutable once recorded."));
  assert.ok(route.includes("Record agency payment before confirming loan posting."));
  assert.ok(route.includes("Confirmed government loan posting evidence is immutable."));
  assert.ok(route.includes('status: "reconciled"'));
});

test("loan posting exceptions stop a false reconciled state", () => {
  assert.ok(route.includes('postingStatus: "exception"'));
  assert.ok(route.includes('status: "exception"'));
  assert.ok(route.includes("exceptionNote"));
});

test("Loans UI exposes SSS and Pag-IBIG government loan remittance controls", () => {
  assert.ok(panel.includes("PH GOVERNMENT LOAN REMITTANCE"));
  assert.ok(panel.includes("SSS Salary/Calamity Loans"));
  assert.ok(panel.includes("Pag-IBIG MPL/Calamity Loans"));
  assert.ok(panel.includes("Record agency payment"));
  assert.ok(loansPanel.includes("<GovernmentLoanRemittancePanel"));
});
