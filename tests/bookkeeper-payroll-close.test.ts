import assert from "node:assert/strict";
import test from "node:test";
import { buildBookkeeperPayrollClose } from "../src/lib/bookkeeper-payroll-close";

const liabilities = {
  sss: 12000,
  philHealth: 5000,
  pagIbig: 3000,
  birWithholding: 8000,
  governmentLoans: 1000,
  totalStatutoryLiabilities: 28000,
  netPayroll: 180000,
  employerStatutoryExpense: 11000,
};

const evidence = [
  { agency: "SSS", form: "R-3", status: "accepted", proven: true },
  { agency: "PhilHealth", form: "RF-1", status: "generated", proven: false },
  { agency: "Pag-IBIG", form: "MCRF", status: "accepted", proven: true },
  { agency: "BIR", form: "1604-C", status: "generated", proven: false },
];

test("bookkeeper close requires released payout and journal", () => {
  const state = buildBookkeeperPayrollClose({
    runStatus: "Released",
    payoutCompleted: false,
    journalExported: false,
    liabilities,
    filingEvidence: evidence,
  });
  assert.equal(state.canClose, false);
  assert.equal(state.hardBlockers.length, 2);
});

test("filing evidence gaps require acknowledgement but do not falsely block a semi-monthly close", () => {
  const state = buildBookkeeperPayrollClose({
    runStatus: "Released",
    payoutCompleted: true,
    journalExported: true,
    liabilities,
    filingEvidence: evidence,
  });
  assert.equal(state.canClose, true);
  assert.equal(state.requiresFilingEvidenceAcknowledgement, true);
  assert.equal(state.filingEvidenceProven.length, 2);
  assert.equal(state.filingEvidenceGaps.length, 2);
});

test("fully evidenced close needs no filing acknowledgement", () => {
  const state = buildBookkeeperPayrollClose({
    runStatus: "Released",
    payoutCompleted: true,
    journalExported: true,
    liabilities,
    filingEvidence: evidence.map((item) => ({ ...item, status: "accepted", proven: true })),
  });
  assert.equal(state.canClose, true);
  assert.equal(state.requiresFilingEvidenceAcknowledgement, false);
  assert.equal(state.filingEvidenceComplete, true);
});

test("closed payroll is immutable from the close workflow", () => {
  const state = buildBookkeeperPayrollClose({
    runStatus: "Released",
    payoutCompleted: true,
    journalExported: true,
    liabilities,
    filingEvidence: evidence,
    closedAt: "2026-10-03T05:00:00.000Z",
  });
  assert.equal(state.closed, true);
  assert.equal(state.canClose, false);
  assert.equal(state.closedAt, "2026-10-03T05:00:00.000Z");
});


test("journal and government worksheets read the statutory basis actually stored by payroll", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/exporters.ts", "utf8");
  assert.ok(source.includes('traceNumber(entry.trace, "statutoryMonthlyCompensation=")'));
  assert.ok(!source.includes("statutoryMonthlyRemuneration="));
});
