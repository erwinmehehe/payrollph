import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const store = readFileSync("src/lib/filing-evidence-store.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const alerts = readFileSync("src/lib/statutory-remittance-alerts.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-remittance-panel.tsx", "utf8");
const filingUi = readFileSync("src/components/workspace/filing-evidence.tsx", "utf8");
const route = readFileSync("src/app/api/compliance/filing-validations/route.ts", "utf8");

test("filing evidence schema stores immutable monthly reconciliation snapshot fields", () => {
  assert.ok(schema.includes('applicableMonth: varchar("applicable_month"'));
  assert.ok(schema.includes('employeeCount: integer("employee_count")'));
  assert.ok(schema.includes('reportedTotal: numeric("reported_total"'));
});

test("generated filing record snapshots totals from the exact file bytes", () => {
  assert.ok(store.includes("summarizeMonthlyContributionFile"));
  assert.ok(store.includes('String(run.periodEnd).slice(0, 7)'));
  assert.ok(store.includes("body: file.body"));
  assert.ok(store.includes("applicableMonth: remittanceSnapshot?.applicableMonth ?? null"));
  assert.ok(store.includes("reportedTotal: remittanceSnapshot ? remittanceSnapshot.reportedTotal.toFixed(2) : null"));
});

test("cross-check trusts only accepted current-version file-upload evidence", () => {
  assert.ok(state.includes('row.status === "accepted"'));
  assert.ok(state.includes('row.submissionMethod === "file_upload"'));
  assert.ok(state.includes("row.generatorVersion === definition.generatorVersion"));
  assert.ok(state.includes("row.applicableMonth === batch.applicableMonth"));
  assert.ok(state.includes("compareFilingToRemittance"));
});

test("filing mismatch creates a critical alert even after remittance reconciliation", () => {
  const mismatchPos = alerts.indexOf('batch.filingCheck?.status === "mismatch"');
  const reconciledPos = alerts.indexOf('batch.status === "reconciled"');
  assert.ok(mismatchPos > 0);
  assert.ok(reconciledPos > mismatchPos);
  assert.ok(alerts.includes('id: `filing:${batch.id}`'));
  assert.ok(alerts.includes('tone: "danger"'));
});

test("operators see matched, mismatched and unverified filing/remittance states", () => {
  assert.ok(panel.includes('batch.filingCheck?.status === "matched"'));
  assert.ok(panel.includes('batch.filingCheck?.status === "mismatch"'));
  assert.ok(panel.includes('batch.filingCheck?.status === "unverified"'));
  assert.ok(panel.includes("Accepted filing does not match this remittance liability."));
});

test("filing evidence UI and audit event expose the stored monthly snapshot", () => {
  assert.ok(filingUi.includes("Monthly snapshot"));
  assert.ok(filingUi.includes("record.employeeCount"));
  assert.ok(filingUi.includes("record.reportedTotal"));
  assert.ok(route.includes("employeeCount: record.employeeCount"));
  assert.ok(route.includes("reportedTotal: record.reportedTotal == null ? null : Number(record.reportedTotal)"));
});
