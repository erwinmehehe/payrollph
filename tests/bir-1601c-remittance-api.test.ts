import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/bir-1601c-remittances/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const panel = readFileSync("src/components/workspace/bir-1601c-remittance-panel.tsx", "utf8");
const exportsView = readFileSync("src/components/workspace/exports.tsx", "utf8");
const filingStore = readFileSync("src/lib/filing-evidence-store.ts", "utf8");

test("BIR 1601-C reconciliation is a first-class monthly payroll control", () => {
  assert.ok(schema.includes('export const birWithholdingRemittanceBatches = pgTable('));
  assert.ok(schema.includes('expectedTaxWithheld: numeric("expected_tax_withheld"'));
  assert.ok(schema.includes('filingValidationId: integer("filing_validation_id")'));
  assert.ok(schema.includes('paymentRecordedByUserId: integer("payment_recorded_by_user_id")'));
});

test("BIR liability is snapshotted only from closed released payroll paid in the month", () => {
  assert.ok(route.includes("applicableMonth >= currentManilaMonth()"));
  assert.ok(route.includes("gte(payrollRuns.payDate, start)"));
  assert.ok(route.includes("lte(payrollRuns.payDate, end)"));
  assert.ok(route.includes('run.status !== "Released"'));
  assert.ok(route.includes("buildBir1601cRemittanceSnapshot"));
});

test("payment is blocked until current accepted filing evidence matches payroll", () => {
  assert.ok(route.includes('eq(governmentFilingValidations.agency, "BIR")'));
  assert.ok(route.includes('eq(governmentFilingValidations.form, "1601-C")'));
  assert.ok(route.includes("BIR_1601C_GENERATOR_VERSION"));
  assert.ok(route.includes("compareBir1601cFiling"));
  assert.ok(route.includes("if (!check.matched || !filing)"));
});

test("BIR payment evidence is immutable and mutations use payroll security gates", () => {
  assert.ok(route.includes("BIR 1601-C payment evidence is immutable once reconciled."));
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("!access.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
});

test("existing immutable filing records can backfill newly-derived BIR snapshot metadata", () => {
  assert.ok(filingStore.includes("Snapshot metadata is deterministically derived from the already-hashed file."));
  assert.ok(filingStore.includes("reportedTotal: remittanceSnapshot.reportedTotal.toFixed(2)"));
  assert.ok(filingStore.includes("existing.applicableMonth !== remittanceSnapshot.applicableMonth"));
});

test("Exports shows the BIR withholding reconciliation next to filing evidence", () => {
  assert.ok(panel.includes("BIR 1601-C RECONCILIATION"));
  assert.ok(panel.includes("Accepted 1601-C matches payroll."));
  assert.ok(panel.includes("Record BIR payment / no-payment-due close"));
  assert.ok(exportsView.includes("<Bir1601cRemittancePanel"));
});
