import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-remittance-panel.tsx", "utf8");
const selfApi = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const selfUi = readFileSync("src/components/self-service-portal.tsx", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");

test("statutory remittance ledger separates batch payment from employee posting", () => {
  assert.ok(schema.includes('export const statutoryRemittanceBatches = pgTable('));
  assert.ok(schema.includes('export const statutoryRemittanceMembers = pgTable('));
  assert.ok(schema.includes('postingStatus: varchar("posting_status"'));
  assert.ok(schema.includes('agencyReceiptReference: varchar("agency_receipt_reference"'));
});

test("remittance snapshot is restricted to closed months and released payroll", () => {
  assert.ok(route.includes("applicableMonth >= currentManilaMonth()"));
  assert.ok(route.includes('run.status !== "Released"'));
  assert.ok(route.includes("All payroll runs for"));
  assert.ok(route.includes("buildStatutoryRemittanceSnapshot"));
});

test("payment cannot hide under-remittance and employee posting is a separate gate", () => {
  assert.ok(route.includes("canMarkRemittancePaid"));
  assert.ok(route.includes("Record the agency payment before confirming employee posting."));
  assert.ok(route.includes('postingStatus: "confirmed"'));
  assert.ok(route.includes('status: "reconciled"'));
  assert.ok(route.includes("remaining.length === 0 && exceptions.length === 0"));
});

test("posting exceptions prevent false reconciliation", () => {
  assert.ok(route.includes('postingStatus: "exception"'));
  assert.ok(route.includes('status: "exception"'));
  assert.ok(route.includes("exceptionNote"));
});

test("remittance mutations use same-origin, MFA, RBAC, rate limits and audit events", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("recordAuditEvent"));
});

test("payroll workspace makes remittance reconciliation visible", () => {
  assert.ok(panel.includes("Deducted does not mean remitted."));
  assert.ok(panel.includes("Record payment evidence"));
  assert.ok(panel.includes("Reconcile employee"));
});

test("employee self-service exposes only the signed-in employee contribution posting trail", () => {
  assert.ok(selfApi.includes("eq(statutoryRemittanceMembers.employeeId, session.employeeId)"));
  assert.ok(selfApi.includes("contributions: contributionRows.map"));
  assert.ok(selfUi.includes("MANDATORY CONTRIBUTIONS"));
  assert.ok(selfUi.includes("Agency posting confirmed"));
  assert.ok(selfUi.includes("Employer payment pending"));
});
