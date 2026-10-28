import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGovernmentLoanRemittanceSnapshot,
  canConfirmGovernmentLoanPosting,
  canRecordGovernmentLoanRemittance,
  governmentLoanAgency,
  governmentLoanRemittanceDueDate,
} from "../src/lib/government-loan-remittance";

test("government loan agency classification excludes company loans", () => {
  assert.equal(governmentLoanAgency("SSS Salary Loan"), "SSS");
  assert.equal(governmentLoanAgency("SSS Calamity Loan"), "SSS");
  assert.equal(governmentLoanAgency("Pag-IBIG Multi-Purpose Loan (MPL)"), "Pag-IBIG");
  assert.equal(governmentLoanAgency("HDMF Calamity Loan"), "Pag-IBIG");
  assert.equal(governmentLoanAgency("Company Emergency Loan"), null);
});

test("monthly snapshot uses actual released payroll loan deductions", () => {
  const snapshot = buildGovernmentLoanRemittanceSnapshot({
    agency: "SSS",
    applicableMonth: "2026-09",
    loans: [{
      id: 10,
      employeeId: 1,
      employeeNo: "EMP-001",
      loanType: "SSS Salary Loan",
      referenceNo: "SL-001",
    }, {
      id: 20,
      employeeId: 1,
      employeeNo: "EMP-001",
      loanType: "Company Emergency Loan",
      referenceNo: "CO-001",
    }],
    entries: [{
      employeeId: 1,
      lineItems: [
        { code: "LOAN-10", amount: "-500.00" },
        { code: "LOAN-20", amount: "-750.00" },
      ],
    }, {
      employeeId: 1,
      lineItems: [{ code: "LOAN-10", amount: "-500.00" }],
    }],
  });

  assert.equal(snapshot.employeeCount, 1);
  assert.equal(snapshot.loanCount, 1);
  assert.equal(snapshot.expectedTotal, 1000);
  assert.equal(snapshot.members[0].deductedAmount, 1000);
  assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/);
});

test("government loan control deadlines follow agency rules", () => {
  assert.equal(governmentLoanRemittanceDueDate("SSS", "2026-09"), "2026-10-31");
  assert.equal(governmentLoanRemittanceDueDate("Pag-IBIG", "2026-09"), "2026-10-15");
});

test("payment gate blocks under-remittance and requires variance evidence for excess", () => {
  assert.equal(canRecordGovernmentLoanRemittance({
    expectedTotal: 1000,
    amountPaid: 900,
    paymentReference: "PRN-123",
    agencyAcknowledgementReference: "ACK-123",
  }).ok, false);

  assert.equal(canRecordGovernmentLoanRemittance({
    expectedTotal: 1000,
    amountPaid: 1000,
    paymentReference: "PRN-123",
    agencyAcknowledgementReference: "ACK-123",
  }).ok, true);

  assert.equal(canRecordGovernmentLoanRemittance({
    expectedTotal: 1000,
    amountPaid: 1010,
    paymentReference: "PRN-123",
    agencyAcknowledgementReference: "ACK-123",
  }).ok, false);

  assert.equal(canRecordGovernmentLoanRemittance({
    expectedTotal: 1000,
    amountPaid: 1010,
    paymentReference: "PRN-123",
    agencyAcknowledgementReference: "ACK-123",
    paymentVarianceNote: "Late remittance penalty",
  }).ok, true);
});

test("member posting must match the exact payroll-deducted loan amount", () => {
  assert.equal(canConfirmGovernmentLoanPosting({
    expectedAmount: 500,
    postedAmount: 499,
    postingReference: "POST-1",
  }).ok, false);

  assert.equal(canConfirmGovernmentLoanPosting({
    expectedAmount: 500,
    postedAmount: 500,
    postingReference: "POST-1",
  }).ok, true);
});

test("remittance month validator rejects silent rollover, coercion and unknown agency", () => {
  for (const agency of ["SSS", "Pag-IBIG"] as const) {
    for (const month of ["2026-00", "2026-13", "2026-99", "2026-9",
      "0099-12", "0000-01", "2026-02-30", "2026-10\n", ""]) {
      assert.throws(() => governmentLoanRemittanceDueDate(agency, month),
        /Valid agency and applicableMonth/, agency + ": " + month);
    }
  }
  assert.throws(() => governmentLoanRemittanceDueDate(
    "Fake Agency" as "SSS", "2026-09",
  ), /Valid agency/);
  assert.throws(() => governmentLoanRemittanceDueDate(
    "SSS", 202609 as unknown as string,
  ), /Valid agency/);
  assert.equal(governmentLoanRemittanceDueDate("SSS", "2026-12"), "2027-01-31");
  assert.equal(governmentLoanRemittanceDueDate("Pag-IBIG", "2026-12"), "2027-01-15");
  assert.throws(() => governmentLoanRemittanceDueDate("SSS", "9999-12"), /supported calendar/);
});

test("non-finite and fractional-cent remittance payments fail before database formatting", () => {
  const valid = {
    expectedTotal: 125.01, amountPaid: 125.01,
    paymentReference: "PRN-12345", agencyAcknowledgementReference: "ACK-12345",
  };
  for (const invalid of [NaN, Infinity, -Infinity, 0, -0.01, -125, 125.001,
    125.005, 10_000_000_000, Number.MAX_VALUE]) {
    assert.equal(canRecordGovernmentLoanRemittance({ ...valid, amountPaid: invalid }).ok,
      false, "reject paid " + String(invalid));
    assert.equal(canRecordGovernmentLoanRemittance({ ...valid, expectedTotal: invalid }).ok,
      false, "reject expected " + String(invalid));
  }
  assert.equal(canRecordGovernmentLoanRemittance(valid).ok, true);
  assert.equal(canRecordGovernmentLoanRemittance({ ...valid, amountPaid: 125 }).ok,
    true, "preserve the existing one-cent payment tolerance");
});

test("non-finite and fractional-cent agency posting evidence fails closed", () => {
  const valid = { expectedAmount: 125.01, postedAmount: 125.01, postingReference: "POST-12345" };
  for (const invalid of [NaN, Infinity, -Infinity, 0, -1, 125.001, 125.005,
    10_000_000_000, Number.MAX_VALUE]) {
    assert.equal(canConfirmGovernmentLoanPosting({ ...valid, postedAmount: invalid }).ok,
      false, "reject posted " + String(invalid));
    assert.equal(canConfirmGovernmentLoanPosting({ ...valid, expectedAmount: invalid }).ok,
      false, "reject expected " + String(invalid));
  }
  assert.equal(canConfirmGovernmentLoanPosting(valid).ok, true);
  assert.equal(canConfirmGovernmentLoanPosting({ ...valid, postedAmount: 125 }).ok,
    true, "preserve the existing one-cent posting tolerance");
});
