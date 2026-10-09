import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  centsAsPesos,
  compareReleasedPayrollWithVerifiedAmounts,
  fingerprintReleasedPayrollEntry,
  pesosToCentavos,
} from "../src/lib/payroll-overpayment-preview";

test("PHP arithmetic uses exact centavos without floats, exponent formats or accidental negatives", () => {
  for (const [raw, expected] of [
    ["0", 0], ["0.00", 0], ["0.01", 1],
    ["1", 100], ["1.2", 120], ["1.20", 120],
    ["999999999.99", 99_999_999_999],
  ] as const) assert.equal(pesosToCentavos(raw), expected, raw);
  for (const raw of [
    "-1", "1.000", "01.20", "2e4", "Infinity", "NaN",
    "9999999999", "1,000.00", "", " ", ".5", "1.",
    null, undefined, {}, Number.NaN,
  ]) assert.equal(pesosToCentavos(raw), null, String(raw));
  assert.equal(centsAsPesos(1), "0.01");
  assert.equal(centsAsPesos(123456), "1234.56");
  assert.equal(centsAsPesos(-123456), "-1234.56");
  assert.throws(() => centsAsPesos(10.5), /integer/);
});

test("possible overpayment means discrepancies only, NOT recoverable money", () => {
  const result = compareReleasedPayrollWithVerifiedAmounts(
    { grossPay: "20000.00", deductions: "3000.00", netPay: "17000.00" },
    { grossPay: "18500.00", netPay: "15800.00" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.variance.reviewStatus, "possible_overpayment");
  assert.equal(result.variance.grossDifference, "1500.00");
  assert.equal(result.variance.netDifference, "1200.00");
  assert.equal(result.variance.verifiedImpliedDeductions, "2700.00");
  assert.equal(result.variance.automatedRecoveryAllowed, false);
  assert.equal(result.variance.hasSourceArithmeticWarning, false);
});

test("underpayments, mixed signs and no variance cannot be mistaken for recoverable debt", () => {
  const source = { grossPay: "1000.00", deductions: "200.00", netPay: "800.00" };
  const scenarios: Array<{
    grossPay: string; netPay: string;
    expected: "possible_underpayment" | "mixed_variance" | "no_variance";
  }> = [
    { grossPay: "1100.00", netPay: "900.00", expected: "possible_underpayment" },
    { grossPay: "900.00", netPay: "850.00", expected: "mixed_variance" },
    { grossPay: "1000.00", netPay: "800.00", expected: "no_variance" },
  ];
  for (const item of scenarios) {
    const result = compareReleasedPayrollWithVerifiedAmounts(source, item);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.variance.reviewStatus, item.expected);
      assert.equal(result.variance.automatedRecoveryAllowed, false);
    }
  }
});

test("inconsistent verified source values fail closed rather than estimating deductions", () => {
  const source = { grossPay: "1000.00", deductions: "100.00", netPay: "900.00" };
  const invalid = compareReleasedPayrollWithVerifiedAmounts(source, {
    grossPay: "900.00", netPay: "950.00",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "INCONSISTENT_VERIFIED_VALUES");

  const incorrect = compareReleasedPayrollWithVerifiedAmounts(source, {
    grossPay: "1.234", netPay: "700.00",
  });
  assert.equal(incorrect.ok, false);
  if (!incorrect.ok) assert.equal(incorrect.code, "INVALID_AMOUNT");
});

test("inconsistent original released register is flagged for independent review", () => {
  const result = compareReleasedPayrollWithVerifiedAmounts(
    { grossPay: "1000.00", deductions: "100.00", netPay: "875.00" },
    { grossPay: "950.00", netPay: "830.00" },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variance.hasSourceArithmeticWarning, true);
});

test("source fingerprint seals the payroll entry, amount, trace, status and line items", () => {
  const source = {
    entryId: 101, runId: 44, employeeId: 9,
    grossPay: "20000.00", deductions: "3000.00", netPay: "17000.00",
    status: "Ready",
    lineItems: [{ code: "BASIC", amount: "20000.00" }],
    trace: { engineVersion: "2026.10" },
  };
  const original = fingerprintReleasedPayrollEntry(source);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(fingerprintReleasedPayrollEntry({ ...source }), original);
  assert.notEqual(fingerprintReleasedPayrollEntry({ ...source, netPay: "17000.01" }), original);
  assert.notEqual(fingerprintReleasedPayrollEntry({ ...source, deductions: "3000.01" }), original);
  assert.notEqual(fingerprintReleasedPayrollEntry({ ...source, status: "Recalculated" }), original);
  assert.notEqual(fingerprintReleasedPayrollEntry({
    ...source, lineItems: [{ code: "BASIC", amount: "19999.99" }],
  }), original);
  assert.notEqual(fingerprintReleasedPayrollEntry({
    ...source, trace: { engineVersion: "changed" },
  }), original);
  assert.notEqual(fingerprintReleasedPayrollEntry({ ...source, employeeId: 10 }), original);
});

test("review route is default-off, tenant-scoped, MFA-protected and cannot mutate money or HCM state", () => {
  const route = readFileSync("src/app/api/payroll-overpayment-preview/route.ts", "utf8");
  const source = readFileSync("src/lib/payroll-overpayment-preview-server.ts", "utf8");
  const client = readFileSync("src/components/payroll-overpayment-preview-panel.tsx", "utf8");
  const compensation = readFileSync("src/components/compensation-panel.tsx", "utf8");

  assert.ok(route.includes('process.env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "true"'));
  assert.ok(route.includes("if (!previewEnabled())"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("PAYROLL_TAX_APPROVER_ROLES"));
  assert.ok(route.includes("!access?.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("eq(payrollRuns.organizationId, organizationId)"));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(route.includes("loadReleasedOverpaymentEvidence("));
  assert.ok(source.includes("entries.length !== 1"));
  assert.ok(source.includes("eq(payrollRuns.organizationId, organizationId)"));
  assert.ok(source.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes("fingerprintReleasedPayrollEntry("));
  assert.ok(route.includes("reviewOnly: true"));
  assert.ok(route.includes("saved: false"));
  for (const forbidden of [
    "db.insert(", "db.update(", "db.delete(",
    "tx.insert(", "tx.update(", "tx.delete(",
    "enqueuePayrollRun(", "drainPayrollQueue(", "recordAuditEvent(",
  ]) assert.ok(!route.includes(forbidden), "Do not allow money or employee mutation via preview: " + forbidden);
  assert.ok(client.includes("Results are not saved"));
  assert.ok(client.includes("controller.abort()"));
  assert.ok(client.includes("setPreview(null)"));
  assert.ok(client.includes("automatedRecoveryAllowed"));
  assert.ok(compensation.includes("<PayrollOverpaymentPreviewPanel organizationId={organizationId} />"));
});
