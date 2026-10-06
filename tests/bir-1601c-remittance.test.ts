import assert from "node:assert/strict";
import test from "node:test";
import {
  bir1601cDeadlines,
  buildBir1601cRemittanceSnapshot,
  canRecordBir1601cPayment,
  compareBir1601cFiling,
} from "../src/lib/bir-1601c-remittance";

test("non-eFPS 1601-C uses the 10th, except December uses January 15", () => {
  assert.deepEqual(bir1601cDeadlines({
    applicableMonth: "2026-09",
    filingChannel: "non_efps",
  }), {
    filingDueDate: "2026-10-10",
    paymentDueDate: "2026-10-10",
  });

  assert.deepEqual(bir1601cDeadlines({
    applicableMonth: "2026-12",
    filingChannel: "non_efps",
  }), {
    filingDueDate: "2027-01-15",
    paymentDueDate: "2027-01-15",
  });
});

test("eFPS filing is staggered by group but monthly payment is controlled to the 15th", () => {
  const expected = {
    A: "2026-10-15",
    B: "2026-10-14",
    C: "2026-10-13",
    D: "2026-10-12",
    E: "2026-10-11",
  } as const;

  for (const [group, filingDueDate] of Object.entries(expected)) {
    assert.deepEqual(bir1601cDeadlines({
      applicableMonth: "2026-09",
      filingChannel: "efps",
      efpsGroup: group as keyof typeof expected,
    }), {
      filingDueDate,
      paymentDueDate: "2026-10-15",
    });
  }
});

test("1601-C snapshot uses actual released payroll withholding and signed year-end adjustments", () => {
  const snapshot = buildBir1601cRemittanceSnapshot({
    applicableMonth: "2026-12",
    payrollRunCount: 2,
    entries: [
      {
        employeeId: 1,
        lineItems: [
          { code: "WHT", amount: "-1000" },
          { code: "YE-TAX-REFUND", amount: "250" },
        ],
      },
      {
        employeeId: 2,
        lineItems: [
          { code: "WHT", amount: "-600" },
          { code: "YE-TAX-COLLECTION", amount: "-100" },
        ],
      },
    ],
  });

  assert.equal(snapshot.employeeCount, 2);
  assert.equal(snapshot.payrollRunCount, 2);
  assert.equal(snapshot.expectedTaxWithheld, 1450);
  assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/);
});

test("BIR filing comparison requires both total and employee population to match", () => {
  assert.equal(compareBir1601cFiling({
    expectedTaxWithheld: 12500,
    expectedEmployeeCount: 18,
    reportedTotal: 12500,
    reportedEmployeeCount: 18,
  }).matched, true);

  const mismatch = compareBir1601cFiling({
    expectedTaxWithheld: 12500,
    expectedEmployeeCount: 18,
    reportedTotal: 12400,
    reportedEmployeeCount: 17,
  });
  assert.equal(mismatch.matched, false);
  assert.equal(mismatch.totalDifference, -100);
  assert.equal(mismatch.employeeCountDifference, -1);
});

test("BIR payment blocks underpayment and requires an explanation for penalties", () => {
  assert.equal(canRecordBir1601cPayment({
    expectedTaxWithheld: 1000,
    amountPaid: 999,
    paymentReference: "BIR-001",
  }).ok, false);

  assert.equal(canRecordBir1601cPayment({
    expectedTaxWithheld: 1000,
    amountPaid: 1000,
    paymentReference: "BIR-001",
  }).ok, true);

  assert.equal(canRecordBir1601cPayment({
    expectedTaxWithheld: 1000,
    amountPaid: 1010,
    paymentReference: "BIR-001",
  }).ok, false);

  assert.equal(canRecordBir1601cPayment({
    expectedTaxWithheld: 1000,
    amountPaid: 1010,
    paymentReference: "BIR-001",
    paymentVarianceNote: "BIR interest and compromise penalty",
  }).ok, true);
});

test("zero tax due can reconcile without inventing a payment reference", () => {
  assert.equal(canRecordBir1601cPayment({
    expectedTaxWithheld: 0,
    amountPaid: 0,
    paymentReference: "",
  }).ok, true);
});
