/** Synthetic only: preserve fail-closed identity validation while reporting other discrepancies. */
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateParallelPayrollReconciliation, JOURNAL_COLUMNS, PAYROLL_COLUMNS,
  type ParallelCycle, type ParallelReconciliationManifest,
} from "../src/lib/private-parallel-payroll-reconciliation";

const ENTITY = "SYNTHETIC_579_ENTITY";
const PERIOD = "2026-10";
const workerKey = (index: number) => createHmac("sha256", "fictional-579-test-only")
  .update("fictional-worker-" + index).digest("hex");
const csv = (columns: readonly string[], rows: string[][]) =>
  [columns.join(","), ...rows.map(row => row.join(","))].join("\n") + "\n";

const payrollRows = [
  [workerKey(1), ENTITY, PERIOD, "20000.00", "18500.00", "875.00", "500.00", "100.00",
    "1520.00", "0.00", "0.00", "5.00", "17000.00", "1750.00", "15.00", "500.00", "100.00"],
  [workerKey(2), ENTITY, PERIOD, "15000.00", "13775.00", "750.00", "375.00", "100.00",
    "0.00", "500.00", "300.00", "0.00", "12975.00", "1500.00", "15.00", "375.00", "100.00"],
];
const journalRows = [
  ["PAYROLL_GROSS", ENTITY, PERIOD, "35000.00", "0.00"],
  ["BANK_NET", ENTITY, PERIOD, "0.00", "29975.00"],
  ["SSS_PAYABLE", ENTITY, PERIOD, "0.00", "4905.00"],
  ["PHILHEALTH_PAYABLE", ENTITY, PERIOD, "0.00", "1750.00"],
  ["PAGIBIG_PAYABLE", ENTITY, PERIOD, "0.00", "400.00"],
  ["BIR_WHT_PAYABLE", ENTITY, PERIOD, "0.00", "1520.00"],
  ["GOVERNMENT_LOANS_PAYABLE", ENTITY, PERIOD, "0.00", "500.00"],
  ["COMPANY_LOANS_PAYABLE", ENTITY, PERIOD, "0.00", "300.00"],
  ["OTHER_DEDUCTIONS_PAYABLE", ENTITY, PERIOD, "0.00", "5.00"],
  ["EMPLOYER_STATUTORY_EXPENSE", ENTITY, PERIOD, "4355.00", "0.00"],
];

test("a gross-to-net defect must not hide separate centavo and tax mismatches", (t) => {
  const root = mkdtempSync(join(tmpdir(), "fictional-579-all-errors-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = payrollRows.map(row => [...row]);
  candidate[0][8] = "1520.02";
  candidate[0][12] = "16999.98"; // Independently valid two-cent employee variance.
  candidate[1][12] = "12976.11"; // Separate invalid cash identity; must still BLOCK.
  const bodies = {
    incumbentPayroll: csv(PAYROLL_COLUMNS, payrollRows),
    linawPayroll: csv(PAYROLL_COLUMNS, candidate),
    incumbentJournal: csv(JOURNAL_COLUMNS, journalRows),
    linawJournal: csv(JOURNAL_COLUMNS, journalRows),
  };
  const cycle = { period: PERIOD } as ParallelCycle;
  for (const role of ["incumbentPayroll", "linawPayroll", "incumbentJournal", "linawJournal"] as const) {
    const content = bodies[role];
    const filePath = role + ".csv"; // Four DISTINCT physical sources, even where bytes match.
    writeFileSync(join(root, filePath), content, { flag: "wx", mode: 0o600 });
    cycle[role] = { filePath, sha256: createHash("sha256").update(content).digest("hex") };
  }
  const manifest: ParallelReconciliationManifest = { schemaVersion: 1, legalEntityCode: ENTITY, cycles: [cycle] };
  const result = evaluateParallelPayrollReconciliation(manifest, root, { mode: "pilot" });
  assert.equal(result.status, "reconciliation-blocked");
  assert.equal(result.verifiedFileHashCount, 4);
  assert.equal(result.results[0]?.matchedEmployees, 2);
  assert.ok(result.issues.some(issue => issue.includes("Gross-to-net cash identity failed")));
  assert.ok(result.issues.some(issue => issue.includes("payroll withholding_tax")));
  assert.ok(result.issues.some(issue => issue.includes("payroll net_pay")));
  assert.equal(result.results[0]?.employeeFieldVarianceCounts.withholding_tax, 1);
  assert.equal(result.results[0]?.employeeFieldVarianceCounts.net_pay, 2);
  const report = JSON.stringify(result);
  assert.ok(!report.includes(workerKey(1)) && !report.includes(workerKey(2)));
  assert.ok(!report.includes("20000.00") && !report.includes("12976.11"));
});
