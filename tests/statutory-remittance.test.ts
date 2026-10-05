import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStatutoryRemittanceSnapshot,
  canMarkRemittancePaid,
  nominalRemittanceDueDate,
  statutorySharesForEntry,
} from "../src/lib/statutory-remittance";

function trace(inputs: string[]) {
  return { inputs };
}

test("SSS remittance includes employee deduction, employer share, and EC", () => {
  const shares = statutorySharesForEntry({
    employeeId: 1,
    lineItems: [{ code: "SSS", amount: -750 }],
    trace: trace(["sssEmployerCutoff=1500.00", "sssEmployerEcCutoff=30.00"]),
  }, "SSS");

  assert.deepEqual(shares, { employeeShare: 750, employerShare: 1530 });
});

test("Pag-IBIG remittance includes voluntary employee savings without inventing employer counterpart", () => {
  const shares = statutorySharesForEntry({
    employeeId: 1,
    lineItems: [
      { code: "HDMF", amount: -200 },
      { code: "HDMF_VOL", amount: -300 },
    ],
    trace: trace(["pagIbigEmployerCutoff=200.00"]),
  }, "Pag-IBIG");

  assert.deepEqual(shares, { employeeShare: 500, employerShare: 200 });
});

test("monthly snapshot aggregates multiple released cutoffs per employee", () => {
  const snapshot = buildStatutoryRemittanceSnapshot({
    agency: "PhilHealth",
    applicableMonth: "2026-09",
    employees: [{ id: 1, employeeNo: "EMP-001" }],
    entries: [
      {
        employeeId: 1,
        lineItems: [{ code: "PHIC", amount: -375 }],
        trace: trace(["philHealthEmployerCutoff=375.00"]),
      },
      {
        employeeId: 1,
        lineItems: [{ code: "PHIC", amount: -375 }],
        trace: trace(["philHealthEmployerCutoff=375.00"]),
      },
    ],
  });

  assert.equal(snapshot.employeeCount, 1);
  assert.equal(snapshot.expectedEmployeeShare, 750);
  assert.equal(snapshot.expectedEmployerShare, 750);
  assert.equal(snapshot.expectedTotal, 1500);
  assert.equal(snapshot.members[0].totalContribution, 1500);
  assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/);
});

test("nominal deadlines follow current agency schedules", () => {
  assert.equal(nominalRemittanceDueDate({
    agency: "SSS",
    applicableMonth: "2026-09",
    legalName: "Linaw Inc.",
  }), "2026-10-31");

  assert.equal(nominalRemittanceDueDate({
    agency: "PhilHealth",
    applicableMonth: "2026-09",
    legalName: "Linaw Inc.",
    philHealthEmployerNo: "12-34567890-4",
  }), "2026-10-15");

  assert.equal(nominalRemittanceDueDate({
    agency: "PhilHealth",
    applicableMonth: "2026-09",
    legalName: "Linaw Inc.",
    philHealthEmployerNo: "12-34567890-8",
  }), "2026-10-20");

  assert.equal(nominalRemittanceDueDate({
    agency: "Pag-IBIG",
    applicableMonth: "2026-09",
    legalName: "Linaw Inc.",
  }), "2026-10-19");
});

test("payment gate blocks underpayment but permits evidenced penalties", () => {
  assert.equal(canMarkRemittancePaid({
    expectedTotal: 1000,
    amountPaid: 999,
    paymentReference: "PRN-1",
    agencyReceiptReference: "OR-1",
  }).ok, false);

  assert.equal(canMarkRemittancePaid({
    expectedTotal: 1000,
    amountPaid: 1000,
    paymentReference: "PRN-1",
    agencyReceiptReference: "OR-1",
  }).ok, true);

  assert.equal(canMarkRemittancePaid({
    expectedTotal: 1000,
    amountPaid: 1010,
    paymentReference: "PRN-1",
    agencyReceiptReference: "OR-1",
  }).ok, false);

  assert.equal(canMarkRemittancePaid({
    expectedTotal: 1000,
    amountPaid: 1010,
    paymentReference: "PRN-1",
    agencyReceiptReference: "OR-1",
    paymentVarianceNote: "Agency late-payment penalty",
  }).ok, true);
});
