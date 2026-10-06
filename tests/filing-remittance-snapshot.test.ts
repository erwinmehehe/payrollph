import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFilingToRemittance,
  summarizeMonthlyContributionFile,
} from "../src/lib/filing-remittance-snapshot";

test("SSS filing snapshot ignores comments and sums employee totals", () => {
  const snapshot = summarizeMonthlyContributionFile({
    agency: "SSS",
    form: "R-3",
    applicableMonth: "2026-09",
    body: [
      "# DRAFT ONLY",
      "SSSNo,LastName,FirstName,Total_Contribution",
      "01,Reyes,Ana,1500.00",
      "02,Cruz,Ben,2250.50",
    ].join("\n"),
  });
  assert.deepEqual(snapshot, {
    applicableMonth: "2026-09",
    employeeCount: 2,
    reportedTotal: 3750.5,
  });
});

test("PhilHealth and Pag-IBIG snapshots use their own total columns", () => {
  const philHealth = summarizeMonthlyContributionFile({
    agency: "PhilHealth",
    form: "RF-1",
    applicableMonth: "2026-09",
    body: [
      "PIN,LastName,TotalPremium",
      "01,Reyes,1000.00",
      "02,Cruz,1200.00",
    ].join("\n"),
  });
  const pagIbig = summarizeMonthlyContributionFile({
    agency: "Pag-IBIG",
    form: "MCRF",
    applicableMonth: "2026-09",
    body: [
      "PagIBIGMID,LastName,TotalContribution",
      "01,Reyes,400.00",
      "02,Cruz,400.00",
    ].join("\n"),
  });

  assert.equal(philHealth?.reportedTotal, 2200);
  assert.equal(pagIbig?.reportedTotal, 800);
});


test("BIR 1601-C snapshot reads the one-row monthly withholding worksheet", () => {
  const snapshot = summarizeMonthlyContributionFile({
    agency: "BIR",
    form: "1601-C",
    applicableMonth: "2026-09",
    body: [
      "# DRAFT ONLY",
      "Form,ApplicableMonth,WithholdingTax,Employees,PayrollRunsIncluded,Status",
      "1601-C,2026-09,12500.25,18,2,DRAFT",
    ].join("\n"),
  });
  assert.deepEqual(snapshot, {
    applicableMonth: "2026-09",
    employeeCount: 18,
    reportedTotal: 12500.25,
  });
});

test("BIR 1601-C snapshot permits an overremittance from year-end adjustments", () => {
  const snapshot = summarizeMonthlyContributionFile({
    agency: "BIR",
    form: "1601-C",
    applicableMonth: "2026-12",
    body: [
      "Form,ApplicableMonth,WithholdingTax,Employees,PayrollRunsIncluded,Status",
      "1601-C,2026-12,-250.00,5,1,DRAFT",
    ].join("\n"),
  });
  assert.equal(snapshot?.reportedTotal, -250);
});

test("non-contribution forms do not invent a remittance snapshot", () => {
  assert.equal(summarizeMonthlyContributionFile({
    agency: "BIR",
    form: "1604-C",
    applicableMonth: "2026-09",
    body: "Anything",
  }), null);
});

test("filing/remittance comparison catches count and amount mismatches", () => {
  const matched = compareFilingToRemittance({
    filingEmployeeCount: 20,
    filingTotal: 50000,
    remittanceEmployeeCount: 20,
    remittanceTotal: 50000,
  });
  assert.equal(matched.matched, true);

  const mismatch = compareFilingToRemittance({
    filingEmployeeCount: 19,
    filingTotal: 49900,
    remittanceEmployeeCount: 20,
    remittanceTotal: 50000,
  });
  assert.equal(mismatch.matched, false);
  assert.equal(mismatch.employeeCountDifference, -1);
  assert.equal(mismatch.totalDifference, -100);
});
