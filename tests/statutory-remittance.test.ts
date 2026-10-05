import assert from "node:assert/strict";
import test from "node:test";
import {
  remittanceAmountMatches,
  remittanceIsOverdue,
  statutoryRemittanceDeadline,
  statutoryRemittanceTotals,
} from "../src/lib/statutory-remittance";

const entries = [
  {
    employeeId: 1,
    payrollRunId: 10,
    lineItems: [
      { code: "SSS", amount: "-500.00" },
      { code: "PHIC", amount: "-300.00" },
      { code: "HDMF", amount: "-100.00" },
      { code: "HDMF_VOL", amount: "-50.00" },
    ],
    trace: {
      inputs: [
        "sssEmployerCutoff=1000.00",
        "sssEmployerEcCutoff=30.00",
        "philHealthEmployerCutoff=300.00",
        "pagIbigEmployerCutoff=100.00",
      ],
    },
  },
  {
    employeeId: 2,
    payrollRunId: 11,
    lineItems: [
      { code: "SSS", amount: "-600.00" },
      { code: "PHIC", amount: "-350.00" },
      { code: "HDMF", amount: "-100.00" },
    ],
    trace: {
      inputs: [
        "sssEmployerCutoff=1200.00",
        "sssEmployerEcCutoff=30.00",
        "philHealthEmployerCutoff=350.00",
        "pagIbigEmployerCutoff=100.00",
      ],
    },
  },
];

test("monthly statutory liability reconciles employee withholding plus employer share", () => {
  const totals = statutoryRemittanceTotals(entries);
  const sss = totals.find((row) => row.agency === "SSS")!;
  const ph = totals.find((row) => row.agency === "PhilHealth")!;
  const pagIbig = totals.find((row) => row.agency === "Pag-IBIG")!;

  assert.deepEqual(sss, {
    agency: "SSS",
    employeeAmount: 1100,
    employerAmount: 2260,
    totalAmount: 3360,
    employeeCount: 2,
    sourcePayrollRunIds: [10, 11],
  });
  assert.equal(ph.employeeAmount, 650);
  assert.equal(ph.employerAmount, 650);
  assert.equal(ph.totalAmount, 1300);
  assert.equal(pagIbig.employeeAmount, 250);
  assert.equal(pagIbig.employerAmount, 200);
  assert.equal(pagIbig.totalAmount, 450);
});

test("deadline helper follows current published employer schedules", () => {
  assert.equal(statutoryRemittanceDeadline({
    agency: "SSS",
    applicableMonth: "2026-08",
  }).dueDate, "2026-09-30");

  // October 31, 2026 is Saturday and November 2 is a proclaimed special
  // non-working day, so the next working day is November 3.
  assert.equal(statutoryRemittanceDeadline({
    agency: "SSS",
    applicableMonth: "2026-09",
  }).dueDate, "2026-11-03");

  assert.equal(statutoryRemittanceDeadline({
    agency: "PhilHealth",
    applicableMonth: "2026-08",
    philHealthEmployerNo: "PEN-1234",
  }).dueDate, "2026-09-15");

  assert.equal(statutoryRemittanceDeadline({
    agency: "PhilHealth",
    applicableMonth: "2026-08",
    philHealthEmployerNo: "PEN-1239",
  }).dueDate, "2026-09-21");

  assert.equal(statutoryRemittanceDeadline({
    agency: "Pag-IBIG",
    applicableMonth: "2026-08",
    employerName: "Acme Inc.",
  }).dueDate, "2026-09-14");

  assert.equal(statutoryRemittanceDeadline({
    agency: "Pag-IBIG",
    applicableMonth: "2026-08",
    employerName: "Zenith Inc.",
  }).dueDate, "2026-09-30");
});

test("missing PhilHealth PEN fails closed instead of guessing a deadline", () => {
  const result = statutoryRemittanceDeadline({
    agency: "PhilHealth",
    applicableMonth: "2026-08",
    philHealthEmployerNo: null,
  });
  assert.equal(result.dueDate, null);
  assert.match(result.dueRule, /PEN is missing/i);
});

test("payment evidence must match the payroll liability exactly", () => {
  assert.equal(remittanceAmountMatches(1234.56, 1234.56), true);
  assert.equal(remittanceAmountMatches(1234.56, 1234.57), false);
});

test("only unconfirmed obligations past their due date are overdue", () => {
  assert.equal(remittanceIsOverdue({
    dueDate: "2026-09-30",
    status: "pending",
    today: "2026-10-05",
  }), true);
  assert.equal(remittanceIsOverdue({
    dueDate: "2026-09-30",
    status: "confirmed",
    today: "2026-10-05",
  }), false);
});
