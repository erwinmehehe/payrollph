/** Golden Phase 4 rendered PDF acceptance supplement (fictional source data only).
 * The Phase 4 DB engine reconciles stored centavos; this test exercises the same
 * presentation adapter as the self-service PDF route and inspects the emitted PDF.
 * Browser rendering, authentication and real employer acceptance are separate.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { renderPayslipPdf } from "../src/lib/payslip-pdf";
import { deductionDisplayAmount, payslipSectionTotals, splitPayslipLines } from "../src/lib/payslip-line-buckets";

const peso = (n: number) =>
  `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const basicCutoff = [
  { code: "BASIC", label: "Basic pay", amount: "15000.00" },
  { code: "SSS", label: "SSS contribution", amount: "-750.00" },
  { code: "PHIC", label: "PhilHealth contribution", amount: "-375.00" },
  { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: "-100.00" },
  { code: "WHT", label: "Withholding tax", amount: "-503.70" },
];

function assertActualPdfSettlement(
  kind: "refund" | "collection",
  signedYearEndAmount: string,
  expectedDeductions: number,
  expectedNet: number,
  expectedDisplayedYearEnd: string,
) {
  const label = kind === "refund" ? "BIR year-end tax refund" : "BIR year-end additional tax";
  const items = [
    ...basicCutoff,
    { code: "YE-TAX-101", label, amount: signedYearEndAmount },
  ];
  const sections = splitPayslipLines(items);
  const totals = payslipSectionTotals(items);
  assert.deepEqual(sections.earnings.map((item) => item.code), ["BASIC"]);
  assert.deepEqual(sections.deductions.map((item) => item.code), ["SSS", "PHIC", "HDMF", "WHT", "YE-TAX-101"]);
  assert.equal(totals.earnings, 15000);
  assert.equal(Math.round(totals.deductions * 100), Math.round(expectedDeductions * 100));
  assert.equal(Math.round((totals.earnings - totals.deductions) * 100), Math.round(expectedNet * 100));

  // Use precisely the same split/map/renderer sequence as GET /api/self/payslips/[id].
  const rendered = renderPayslipPdf({
    employerName: "Fictional Golden Payroll Employer",
    employeeName: "Fictional Certification Worker",
    employeeNo: "P4-PDF-SYNTHETIC",
    title: "QA Only",
    periodLabel: "Dec 1-15, 2026",
    payDate: "2026-12-15",
    ruleVersion: "PHASE-4-PDF-TEST",
    gross: 15000,
    deductions: expectedDeductions,
    net: expectedNet,
    lines: sections.earnings.map((item) => ({
      label: item.label,
      amount: peso(Number(item.amount)),
    })),
    contributions: sections.deductions.map((item) => ({
      label: item.label,
      amount: peso(deductionDisplayAmount(item)),
    })),
  });
  assert.ok(rendered.length > 500, "PDF buffer must not be empty");
  const pdf = rendered.toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"), "production renderer must output a real PDF");
  assert.ok(pdf.trimEnd().endsWith("%%EOF"), "production renderer must close the PDF");

  // Assert the actual PDF content, including ordering of the positive stored refund
  // in the DEDUCTIONS block rather than in the EARNINGS block.
  const earningsAt = pdf.indexOf("(EARNINGS) Tj");
  const deductionsAt = pdf.indexOf("(DEDUCTIONS) Tj");
  const yearEndAt = pdf.indexOf(`(${label}) Tj`);
  const deductionTotalAt = pdf.indexOf("(TOTAL DEDUCTIONS) Tj");
  assert.ok(earningsAt > 0 && deductionsAt > earningsAt && deductionTotalAt > deductionsAt);
  assert.ok(yearEndAt > deductionsAt && yearEndAt < deductionTotalAt,
    "tax settlement must appear only inside the PDF deductions section");
  assert.ok(pdf.includes(`(${expectedDisplayedYearEnd}) Tj`), "PDF must print the signed credit/collection as expected");
  for (const [heading, value] of [
    ["GROSS PAY", 15000],
    ["TOTAL DEDUCTIONS", expectedDeductions],
    ["NET PAY", expectedNet],
  ] as const) {
    const at = pdf.indexOf(`(${heading}) Tj`);
    assert.ok(at > 0, `PDF must contain ${heading}`);
    assert.ok(pdf.slice(at, at + 220).includes(`(${peso(value)}) Tj`),
      `PDF ${heading} must show ${peso(value)}`);
  }
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(`qa-artifacts/golden-phase4-${kind}-payslip.pdf`, rendered);
}

test("rendered Phase 4 refund payslip keeps PHP 1,200 as a deduction credit, not extra gross pay", () => {
  assertActualPdfSettlement("refund", "1200.00", 528.70, 14471.30, "PHP -1,200.00");
});

test("rendered Phase 4 collection payslip keeps PHP 800 as an additional deduction", () => {
  assertActualPdfSettlement("collection", "-800.00", 2528.70, 12471.30, "PHP 800.00");
});

test("authenticated employee PDF route still binds shared economic buckets to the PDF renderer", () => {
  const source = readFileSync("src/app/api/self/payslips/[id]/route.ts", "utf8");
  assert.match(source, /const sections = splitPayslipLines\(items\)/);
  assert.match(source, /deductionDisplayAmount\(item\)/);
  assert.match(source, /renderPayslipPdf\(\{/);
  assert.match(source, /eq\(payrollRuns.status, "Released"\)/);
  assert.match(source, /assertMembership\(session.id, employee.organizationId\)/);
});
