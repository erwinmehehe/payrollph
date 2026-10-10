import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  reconcileBirEmployerYear,
  type BirEmployerReconciliationInput,
} from "../src/lib/bir-employer-reconciliation";
import { renderBir2316ReviewHtml } from "../src/lib/bir-2316-print";

const sample: BirEmployerReconciliationInput = {
  legalEntityId: 17, taxYear: 2026,
  runs: [
    { id: 101, legalEntityId: 17, payDate: "2026-09-30", status: "Released" },
    { id: 102, legalEntityId: 17, payDate: "2026-12-31", status: "Released" },
  ],
  entries: [
    { payrollRunId: 101, employeeId: 1, grossPay: "10000", lineItems: [{ code: "WHT", amount: "-1000" }] },
    { payrollRunId: 102, employeeId: 1, grossPay: "20000", lineItems: [
      { code: "WHT", amount: "-500" }, { code: "YE-TAX-18", amount: "-250" },
    ] },
  ],
  annualized: [{
    employeeId: 1, employeeNo: "A1", firstName: "Ana", lastName: "Santos",
    employeeLegalEntityId: 17, mwe: false, grossCompensation: "30000.00",
    nonTaxable: "0.00", taxableIncome: "30000.00", taxDue: "1750.00",
    taxWithheld: "1500.00", adjustment: "250.00", status: "settled",
  }],
  historicalEmployeeIds: [],
  monthlyBatches: [
    { applicableMonth: "2026-09", expectedTaxWithheld: "1000.00", status: "reconciled" },
    { applicableMonth: "2026-12", expectedTaxWithheld: "750.00", status: "reconciled" },
  ],
};
const blockers = (report: ReturnType<typeof reconcileBirEmployerYear>) =>
  report.issues.filter(issue => issue.severity === "blocker").map(issue => issue.code);

test("one employer, settled adjustments and matched 1601-C month closes produce scoped totals", () => {
  const result = reconcileBirEmployerYear(sample);
  assert.equal(result.sourceStatus, "review-required");
  assert.deepEqual(blockers(result), []);
  assert.equal(result.totals.employees, 1);
  assert.equal(result.totals.payrollActualWithheld, "1750.00");
  assert.equal(result.totals.annualTaxDue, "1750.00");
  assert.equal(result.monthly.length, 2);
  assert.match(result.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.canGenerateDat, false, "CPA / BIR layout verification is separate");
});

test("refund sign is respected, never added to BIR tax liability", () => {
  const result = reconcileBirEmployerYear({
    ...sample,
    entries: sample.entries.map(entry => entry.payrollRunId === 102
      ? { ...entry, lineItems: [{ code: "WHT", amount: "-800" }, { code: "YE-TAX-19", amount: "250" }] }
      : entry),
    annualized: sample.annualized.map(row => ({ ...row, taxWithheld: "1800.00", taxDue: "1550.00", adjustment: "-250.00" })),
    monthlyBatches: [
      sample.monthlyBatches[0],
      { applicableMonth: "2026-12", expectedTaxWithheld: "550.00", status: "reconciled" },
    ],
  });
  assert.equal(result.totals.payrollActualWithheld, "1550.00");
  assert.ok(!blockers(result).includes("WITHHOLDING_MISMATCH"));
});

test("legal employer transfers fail rather than splitting organization-wide year end", () => {
  const result = reconcileBirEmployerYear({
    ...sample,
    runs: [...sample.runs, { id: 103, legalEntityId: 22, payDate: "2026-11-30", status: "Released" }],
    entries: [...sample.entries, { payrollRunId: 103, employeeId: 1, grossPay: "999", lineItems: [{ code: "WHT", amount: "-100" }] }],
  });
  assert.ok(blockers(result).includes("CROSS_EMPLOYER_PAY"));
  assert.equal(result.sourceStatus, "blocked");
});

test("null employer run and draft run are blocked", () => {
  const result = reconcileBirEmployerYear({
    ...sample,
    runs: [
      ...sample.runs,
      { id: 103, legalEntityId: null, payDate: "2026-11-15", status: "Released" },
      { id: 104, legalEntityId: 17, payDate: "2026-12-20", status: "Draft" },
    ],
    entries: [
      ...sample.entries,
      { payrollRunId: 103, employeeId: 1, grossPay: "500", lineItems: [] },
    ],
  });
  assert.ok(blockers(result).includes("CROSS_EMPLOYER_PAY"));
  assert.ok(blockers(result).includes("UNRELEASED_PAYROLL"));
});

test("imported payroll without employer ownership is blocked for legal-employer filing", () => {
  const result = reconcileBirEmployerYear({ ...sample, historicalEmployeeIds: [1] });
  assert.ok(blockers(result).includes("IMPORTED_HISTORY_SCOPE"));
});

test("missing or mismatched 1601-C records cannot pass employer readiness", () => {
  const result = reconcileBirEmployerYear({
    ...sample, monthlyBatches: [{ applicableMonth: "2026-09", expectedTaxWithheld: "900", status: "reconciled" }],
  });
  assert.ok(blockers(result).includes("MONTHLY_1601C_NOT_RECONCILED"));
  assert.ok(blockers(result).includes("MONTHLY_1601C_AMOUNT_MISMATCH"));
});

test("a missing annualization row cannot be silently omitted", () => {
  const result = reconcileBirEmployerYear({ ...sample, annualized: [] });
  assert.ok(blockers(result).includes("ANNUALIZATION_MISSING"));
});

test("unsettled adjustments and mismatched year-end withholding are rejected", () => {
  const result = reconcileBirEmployerYear({
    ...sample, annualized: sample.annualized.map(row => ({ ...row, taxWithheld: "1000.00", status: "approved" })),
  });
  assert.ok(blockers(result).includes("UNSETTLED_YEAR_END"));
  assert.ok(blockers(result).includes("WITHHOLDING_MISMATCH"));
});

test("MWE needs statutory premium split for D2 even when totals match", () => {
  const result = reconcileBirEmployerYear({
    ...sample, annualized: sample.annualized.map(row => ({ ...row, mwe: true })),
  });
  assert.ok(blockers(result).includes("MWE_PREMIUM_SPLIT_REQUIRED"));
});

test("printable Form 2316 worksheet is clearly non-official and escapes hostile names", () => {
  const html = renderBir2316ReviewHtml({
    taxYear: 2026, employerName: "<ACME & Co>", employerTin: "123456789-0000",
    employeeNo: "A1", employeeName: "<ScRiPt>alert(1)</ScRiPt> & <svg onload=alert(1)>",
    employeeTin: "987654321-0000", employmentStart: "2026-01-01",
    mwe: false, sourceStatus: "settled", ruleVersion: "PH-2026.03",
    grossCompensation: "500000", exemptBenefitPool: "50000", deMinimis: "0",
    statutoryContributions: "12000", nonTaxable: "62000", taxableIncome: "438000",
    taxDue: "30100", withheldBeforeYearEnd: "30000", yearEndAdjustment: "100",
  });
  assert.match(html, /DRAFT - NOT AN OFFICIAL BIR FORM 2316/);
  assert.ok(html.includes("&lt;ScRiPt&gt;alert(1)&lt;/ScRiPt&gt;"));
  assert.ok(html.includes("&lt;svg onload=alert(1)&gt;"));
  assert.ok(html.includes("&lt;ACME &amp; Co&gt;"));
  assert.equal(html.toLowerCase().includes("<script"), false, "no script element may survive HTML escaping");
  assert.equal(html.toLowerCase().includes("<svg onload"), false, "no inline event-handler element may survive HTML escaping");
  assert.match(html, /30,100\.00/);
  assert.match(html, /REQUIRES VERIFIED/);
  assert.doesNotMatch(html, /window\.print\(/);
});

test("both BIR reporting endpoints require company-wide payroll role and recent MFA", () => {
  const annualRoute = readFileSync("src/app/api/bir/annual-employer/route.ts", "utf8");
  const yearEndRoute = readFileSync("src/app/api/year-end/route.ts", "utf8");
  assert.match(annualRoute, /PAYROLL_OPERATOR_ROLES/);
  assert.match(annualRoute, /access\?\.companyWide/);
  assert.match(annualRoute, /requireSensitiveActionMfa\(user\)/);
  assert.match(yearEndRoute, /format === "2316-print"/);
  assert.match(yearEndRoute, /Content-Security-Policy/);
  assert.match(yearEndRoute, /no-store, private/);
});
