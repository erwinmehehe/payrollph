/**
 * Golden payroll Phase 11: loans and other payroll deductions.
 * Real enqueue/drain against a disposable PostgreSQL database for every
 * payroll case; independently hand-derived centavo literals live in JSON.
 * No release, payment, remittance or production activation occurs here.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeeLoans, employeePayProfiles, employees, loanPayments, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { exactLoanPaymentReplayMatches, settlePayrollLoanBalance } from "../src/lib/payroll-loan-settlement";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";

type LoanSpec = {
  loanType: string; cutoffDeduction: number; remainingBalance: number;
  status?: string; startDate?: string; endDate?: string;
};
type CaseSpec = {
  description: string; monthlySalary: number; voluntaryPagIbigMonthly?: number;
  loans?: LoanSpec[]; expectedLines: Array<number | null>;
  expected: Record<string, number>; expectedStatus?: string; expectedFlag?: string;
};
type Catalog = {
  version: string; toleranceCentavos: 0; sources: Record<string, string>;
  assumptions: string[]; cases: Record<string, CaseSpec>;
  settlements: Record<string, { input: { plannedDeduction: string; remainingBalance: string; totalPaid: string }; expected: { deduction: string; remainingBalance: string; totalPaid: string; status: string } }>;
  settlementRefusals: Record<string, { plannedDeduction: string; remainingBalance: string; totalPaid: string }>;
  replays: Record<string, { planned: string; stored: string; expected: boolean }>;
  limitations: string[];
};
type Entry = typeof payrollEntries.$inferSelect;
type PayrollLine = { code?: string; amount?: string | number };
type Result = { id: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const CATALOG = "certification/golden-payroll-phase11.json";
const ARTIFACT = "qa-artifacts/golden-payroll-phase11-reconciliation.json";
const PERIOD = { periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15" };

function centavos(value: number, label: string): number {
  assert.ok(Number.isFinite(value), label + ": non-finite peso amount");
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), label + ": unsafe centavo integer");
  return result;
}
function items(entry: Entry): PayrollLine[] {
  return Array.isArray(entry.lineItems) ? entry.lineItems as PayrollLine[] : [];
}
function line(entry: Entry, code: string): number | null {
  const found = items(entry).find((item) => item.code === code);
  return found ? Number(found.amount) : null;
}
function deduction(entry: Entry, code: string): number {
  return Math.abs(line(entry, code) ?? 0);
}
function traceNumber(entry: Entry, name: string): number {
  const values = (entry.trace as { inputs?: unknown } | null)?.inputs;
  const value = Array.isArray(values) ? values.find((item) =>
    typeof item === "string" && item.startsWith(name + "=")) : undefined;
  return typeof value === "string" ? Number(value.slice(name.length + 1)) : NaN;
}
function flags(entry: Entry): string[] {
  const value = (entry.trace as { flags?: unknown } | null)?.flags;
  return Array.isArray(value) ? value.map(String) : [];
}
function reconcile(entry: Entry, id: string) {
  const printed = items(entry);
  assert.ok(printed.length > 0, id + ": missing payslip detail");
  const totals = payslipSectionTotals(printed);
  const gross = centavos(Number(entry.grossPay), id);
  const deductions = centavos(Number(entry.deductions), id);
  const net = centavos(Number(entry.netPay), id);
  assert.equal(centavos(totals.earnings, id), gross, id + ": printed earnings do not foot");
  assert.equal(centavos(totals.deductions, id), deductions, id + ": printed deductions do not foot");
  assert.equal(gross - deductions, net, id + ": gross less deductions differs from net");
}
function observed(entry: Entry) {
  return {
    grossPay: Number(entry.grossPay),
    sss: deduction(entry, "SSS"), philHealth: deduction(entry, "PHIC"),
    pagIbig: deduction(entry, "HDMF"), withholdingTax: deduction(entry, "WHT"),
    taxableCompensation: traceNumber(entry, "taxableCompensation"),
    voluntaryPagIbig: deduction(entry, "HDMF_VOL"),
    loanRequested: traceNumber(entry, "loanRequested"),
    loanDeducted: traceNumber(entry, "loanDeducted"),
    deductions: Number(entry.deductions), netPay: Number(entry.netPay),
  };
}
function compare(expected: Record<string, number>, actual: Record<string, number>, id: string) {
  for (const [name, value] of Object.entries(expected)) {
    assert.ok(Object.prototype.hasOwnProperty.call(actual, name), id + ": unknown golden field " + name);
    assert.equal(centavos(actual[name], id + " " + name), centavos(value, id + " " + name),
      id + " " + name + ": expected PHP " + value.toFixed(2) + ", got PHP " + Number(actual[name]).toFixed(2));
  }
}

async function runPayrollCase(id: string, spec: CaseSpec): Promise<Result> {
  const problems: string[] = [];
  let actual: unknown;
  const [org] = await db.insert(organizations).values({
    name: "Golden Phase 11 " + id, legalName: "Golden Phase 11 " + id + " Inc.",
    plan: "Core", statutoryDeductionTiming: "split",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "P11-" + id.slice(0, 24),
      firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
      basicRate: spec.monthlySalary.toFixed(2), mwe: false, region: "NCR",
      startDate: "2026-01-01",
      pagIbigVoluntaryMonthly: (spec.voluntaryPagIbigMonthly ?? 0).toFixed(2),
    }).returning();
    await db.insert(employeePayProfiles).values({
      organizationId: org.id, employeeId: employee.id, payBasis: "monthly",
      rateAmount: spec.monthlySalary.toFixed(2), standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
    });
    const seededLoans: Array<typeof employeeLoans.$inferSelect> = [];
    for (const [index, loan] of (spec.loans ?? []).entries()) {
      const [created] = await db.insert(employeeLoans).values({
        organizationId: org.id, employeeId: employee.id,
        loanType: loan.loanType, referenceNo: "P11-" + id.slice(0, 18) + "-" + index,
        principal: Math.max(100, loan.remainingBalance, loan.cutoffDeduction).toFixed(2),
        monthlyAmortization: (loan.cutoffDeduction * 2).toFixed(2),
        cutoffDeduction: loan.cutoffDeduction.toFixed(2),
        remainingBalance: loan.remainingBalance.toFixed(2), totalPaid: "0.00",
        status: loan.status ?? "active", startDate: loan.startDate ?? "2026-09-01",
        endDate: loan.endDate ?? null,
      }).returning();
      seededLoans.push(created);
    }
    assert.equal(spec.expectedLines.length, seededLoans.length, id + ": every seeded loan needs an expected line");
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "Golden Phase 11 " + id,
      scopeLabel: "All locations", status: "Draft", ...PERIOD,
    }).returning();
    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);
    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 1, id + ": expected one calculated payroll entry");
    const entry = entries[0];
    reconcile(entry, id);
    const numeric = observed(entry);
    compare(spec.expected, numeric, id);
    const actualLines = seededLoans.map((loan) => line(entry, "LOAN-" + loan.id));
    for (const [index, expected] of spec.expectedLines.entries()) {
      if (expected === null) {
        assert.equal(actualLines[index], null, id + ": unauthorized, out-of-period or zero-balance loan was printed");
      } else {
        assert.notEqual(actualLines[index], null, id + ": expected loan deduction was not printed");
        assert.equal(centavos(actualLines[index]!, id), -centavos(expected, id), id + ": wrong loan allocation");
      }
    }
    const permitted = new Set(seededLoans.map((loan) => "LOAN-" + loan.id));
    for (const printed of items(entry).filter((item) => String(item.code).startsWith("LOAN-"))) {
      assert.ok(permitted.has(String(printed.code)), id + ": unexpected loan source in payslip");
    }
    if (spec.expectedStatus) assert.equal(entry.status, spec.expectedStatus, id + ": unexpected exception status");
    const expectedFlag = spec.expectedFlag;
    if (expectedFlag) assert.ok(flags(entry).some((value) => value.includes(expectedFlag)),
      id + ": missing fail-closed warning: " + expectedFlag);
    const afterLoans = await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, org.id));
    assert.equal(afterLoans.length, seededLoans.length, id + ": calculation changed loan records");
    for (const original of seededLoans) {
      const after = afterLoans.find((loan) => loan.id === original.id);
      assert.ok(after, id + ": loan disappeared during calculation");
      assert.equal(after.remainingBalance, original.remainingBalance, id + ": balance changed before release");
      assert.equal(after.totalPaid, original.totalPaid, id + ": paid ledger changed before release");
      const payments = await db.select().from(loanPayments).where(eq(loanPayments.loanId, original.id));
      assert.equal(payments.length, 0, id + ": preview calculation created a loan payment");
    }
    actual = { ...numeric, loanLines: actualLines, status: entry.status, flags: flags(entry) };
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return { id, status: problems.length ? "failed" : "passed",
    expected: { ...spec.expected, loanLines: spec.expectedLines, expectedStatus: spec.expectedStatus, expectedFlag: spec.expectedFlag },
    actual, failures: problems };
}

function runSettlementCases(catalog: Catalog): Result[] {
  const results: Result[] = [];
  for (const [id, spec] of Object.entries(catalog.settlements)) {
    const problems: string[] = [];
    let actual: unknown;
    try {
      actual = settlePayrollLoanBalance(spec.input);
      assert.deepEqual(actual, spec.expected, id + ": exact-centavo settlement mismatch");
    } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    results.push({ id: "settlement/" + id, status: problems.length ? "failed" : "passed",
      expected: spec.expected, actual, failures: problems });
  }
  for (const [id, spec] of Object.entries(catalog.settlementRefusals)) {
    const problems: string[] = [];
    try {
      assert.throws(() => settlePayrollLoanBalance(spec), /LOAN_SETTLEMENT_INVALID_OR_EXCEEDS_BALANCE/,
        id + ": release-time centavo violation must refuse");
    } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    results.push({ id: "settlement-refusal/" + id, status: problems.length ? "failed" : "passed",
      expected: "LOAN_SETTLEMENT_INVALID_OR_EXCEEDS_BALANCE", failures: problems });
  }
  for (const [id, spec] of Object.entries(catalog.replays)) {
    const problems: string[] = [];
    let actual: boolean | undefined;
    try {
      actual = exactLoanPaymentReplayMatches(spec.planned, spec.stored);
      assert.equal(actual, spec.expected, id + ": loan-payment replay one-cent mismatch");
    } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    results.push({ id: "replay/" + id, status: problems.length ? "failed" : "passed",
      expected: spec.expected, actual, failures: problems });
  }
  return results;
}
async function main() {
  const raw = readFileSync(CATALOG, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 11 has zero centavo tolerance");
  assert.ok(Object.keys(catalog.cases).length >= 10, "Phase 11 needs a nontrivial engine-backed matrix");
  const results: Result[] = [];
  for (const [id, spec] of Object.entries(catalog.cases)) {
    try {
      results.push(await runPayrollCase(id, spec));
    } catch (error) {
      results.push({ id, status: "failed", expected: spec.expected,
        failures: [error instanceof Error ? error.message : String(error)] });
    }
  }
  results.push(...runSettlementCases(catalog));
  const failures = results.filter((result) => result.status === "failed");
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(ARTIFACT, JSON.stringify({
    version: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length,
    sources: catalog.sources, assumptions: catalog.assumptions, results, limitations: catalog.limitations,
  }, null, 2) + "\n");
  for (const result of failures) console.error("FAILED " + result.id + "\n  " + result.failures.join("\n  "));
  console.log(JSON.stringify({ status: failures.length ? "failed" : "passed", caseCount: results.length, failed: failures.map((r) => r.id) }));
  if (failures.length) process.exitCode = 1;
}
main().finally(() => pool.end());
