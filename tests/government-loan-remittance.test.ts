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
