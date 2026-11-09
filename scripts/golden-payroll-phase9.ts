/**
 * Golden payroll certification, Phase 9: cross-period withholding and year-end annualization.
 * Phases 1-8 each certify a single cutoff. The engine withholds every semi-monthly cutoff independently, so a whole
 * year is only corrected by the year-end annualization. Part A runs the real annualize() on hand-derived cases.
 * Part B runs the real payroll engine for all 24 cutoffs of 2026 for four employees (steady, high earner, mid-year hire,
 * mid-year raise), then the real runYearEndAnnualization over the released year. Every expected value is an immutable
 * literal in certification/golden-payroll-phase9.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import { annualize, type AnnualizationInput } from "../src/lib/annualization";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Segment = { fromCutoff: number; toCutoff: number; expected: Record<string, number> };
type YearEnd = Record<string, number | string>;
type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  annualize: Record<string, { description: string; input: AnnualizationInput; expected: Record<string, number | string> }>;
  fullYear: {
    employees: Record<string, { description: string; monthlySalary: number; raiseToMonthlySalary?: number; raiseAtCutoff?: number; startCutoff: number; segments: Segment[]; yearEnd: YearEnd }>;
  };
  limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type Entry = typeof payrollEntries.$inferSelect;

const catalogPath = "certification/golden-payroll-phase9.json";
const artifactPath = "qa-artifacts/golden-payroll-phase9-reconciliation.json";
const TAX_YEAR = 2026;
// 2026 is not a leap year.
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const cents = (value: number, label: string) => {
  assert.ok(Number.isFinite(value), `${label}: non-finite amount`);
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), `${label}: unsafe centavo amount`);
  return result;
};
const lines = (entry: Entry) => (Array.isArray(entry.lineItems) ? entry.lineItems as PayrollLine[] : []);
const lineAmount = (entry: Entry, code: string) => Number(lines(entry).find((item) => String(item.code ?? "") === code)?.amount ?? 0);
function traceNumber(entry: Entry, key: string) {
  const inputs = (entry.trace as { inputs?: unknown } | null)?.inputs;
  const raw = Array.isArray(inputs) ? inputs.find((item) => typeof item === "string" && item.startsWith(`${key}=`)) : undefined;
  return typeof raw === "string" ? Number(raw.slice(key.length + 1)) : Number.NaN;
}
function assertPayslipReconciles(entry: Entry, label: string) {
  const items = lines(entry);
  assert.ok(items.length > 0, `${label}: a calculated payslip must contain line items`);
  const totals = payslipSectionTotals(items);
  const gross = cents(Number(entry.grossPay), label), deductions = cents(Number(entry.deductions), label), net = cents(Number(entry.netPay), label);
  assert.equal(cents(totals.earnings, label), gross, `${label}: printed earnings differ from stored gross`);
  assert.equal(cents(totals.deductions, label), deductions, `${label}: printed deductions differ from stored deductions`);
  assert.equal(gross - deductions, net, `${label}: gross - deductions differs from stored net`);
}

/** Compares numbers to the centavo and strings exactly; returns human-readable failures. */
function compare(id: string, expected: Record<string, number | string>, actual: Record<string, unknown>) {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(key in actual, `${id}: unknown expected key ${key}`);
    const got = actual[key];
    if (typeof value === "string") {
      if (got !== value) failures.push(`${id} ${key}: expected ${value}, got ${String(got)}`);
    } else if (!Number.isFinite(Number(got)) || cents(Number(got), id) !== cents(value, id)) {
      failures.push(`${id} ${key}: expected ₱${value.toFixed(2)}, got ₱${Number(got).toFixed(2)}`);
    }
  }
  return failures;
}

function cutoffPeriod(cutoff: number) {
  assert.ok(cutoff >= 1 && cutoff <= 24, "cutoff must be 1-24");
  const month = Math.ceil(cutoff / 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  const firstHalf = cutoff % 2 === 1;
  const periodStart = `${TAX_YEAR}-${pad(month)}-${firstHalf ? "01" : "16"}`;
  const periodEnd = `${TAX_YEAR}-${pad(month)}-${firstHalf ? "15" : pad(MONTH_END[month - 1])}`;
  return { periodStart, periodEnd, payDate: periodEnd, label: `Phase 9 cutoff ${cutoff}` };
}

function actualOf(entry: Entry) {
  return {
    grossPay: Number(entry.grossPay),
    sss: Math.abs(lineAmount(entry, "SSS")),
    philHealth: Math.abs(lineAmount(entry, "PHIC")),
    pagIbig: Math.abs(lineAmount(entry, "HDMF")),
    taxableCompensation: traceNumber(entry, "taxableCompensation"),
    withholdingTax: Math.abs(lineAmount(entry, "WHT")),
  };
}

function runAnnualizeCases(catalog: Catalog) {
  return Object.entries(catalog.annualize).map(([id, spec]) => {
    let failures: string[] = [];
    let actual: Record<string, unknown> | undefined;
    try {
      const result = annualize(spec.input);
      actual = { ...result };
      failures = compare(id, spec.expected, actual);
    } catch (error) {
      failures = [error instanceof Error ? error.message : String(error)];
    }
    const result: CaseResult = { id, part: "annualize", status: failures.length ? "failed" : "passed", expected: spec.expected, actual, failures };
    return result;
  });
}

async function runFullYear(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.fullYear.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P9 full year", legalName: "Golden P9 full year Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const workers = new Map<string, number>();
  const perCutoff = new Map<string, Map<number, Entry>>();
  const failuresByEmployee = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresByEmployee.set(id, [...(failuresByEmployee.get(id) ?? []), message]);
  try {
    const hire = async (id: string, monthlySalary: number, startDate: string) => {
      const [employee] = await db.insert(employees).values({
        organizationId: org.id, employeeNo: `P9-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
        basicRate: monthlySalary.toFixed(2), mwe: false, region: "NCR", startDate,
      }).returning();
      await db.insert(employeePayProfiles).values({
        employeeId: employee.id, organizationId: org.id, payBasis: "monthly", rateAmount: monthlySalary.toFixed(2),
        standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
      });
      workers.set(id, employee.id);
      perCutoff.set(id, new Map());
    };
    for (const [id, spec] of specs) if (spec.startCutoff === 1) await hire(id, spec.monthlySalary, `${TAX_YEAR}-01-01`);

    for (let cutoff = 1; cutoff <= 24; cutoff++) {
      // Employees hired part-way through the year join immediately before their first cutoff; raises apply before theirs.
      for (const [id, spec] of specs) {
        if (spec.startCutoff === cutoff && cutoff > 1) await hire(id, spec.monthlySalary, cutoffPeriod(cutoff).periodStart);
        if (spec.raiseAtCutoff === cutoff && spec.raiseToMonthlySalary) {
          await db.update(employees).set({ basicRate: spec.raiseToMonthlySalary.toFixed(2) }).where(eq(employees.id, workers.get(id)!));
          await db.update(employeePayProfiles).set({ rateAmount: spec.raiseToMonthlySalary.toFixed(2) }).where(eq(employeePayProfiles.employeeId, workers.get(id)!));
        }
      }
      const period = cutoffPeriod(cutoff);
      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
        periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.payDate,
      }).returning();
      await enqueuePayrollRun(run.id, 25);
      await drainPayrollQueue(10, run.id);
      const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      const expectedCount = specs.filter(([, s]) => s.startCutoff <= cutoff).length;
      assert.equal(rows.length, expectedCount, `cutoff ${cutoff}: expected ${expectedCount} payroll entries, got ${rows.length}`);
      for (const [id] of specs) {
        const entry = rows.find((row) => row.employeeId === workers.get(id));
        if (entry) perCutoff.get(id)!.set(cutoff, entry);
      }
      // The year-end annualization reads Released runs; the release approval workflow is not part of this certification.
      await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
    }

    // Per-cutoff reconciliation against the hand-derived segments.
    for (const [id, spec] of specs) {
      for (const segment of spec.segments) {
        for (let cutoff = segment.fromCutoff; cutoff <= segment.toCutoff; cutoff++) {
          const entry = perCutoff.get(id)?.get(cutoff);
          if (!entry) { fail(id, `cutoff ${cutoff}: no payroll entry`); continue; }
          try { assertPayslipReconciles(entry, `${id} cutoff ${cutoff}`); } catch (error) { fail(id, error instanceof Error ? error.message : String(error)); }
          for (const message of compare(`${id} cutoff ${cutoff}`, segment.expected, actualOf(entry))) fail(id, message);
        }
      }
      const expectedCutoffs = 24 - spec.startCutoff + 1;
      if (perCutoff.get(id)!.size !== expectedCutoffs) fail(id, `expected ${expectedCutoffs} cutoffs, found ${perCutoff.get(id)!.size}`);
    }

    // Real year-end annualization over the released year.
    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase9");
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id));
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
        taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
      };
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
      // The annual withholding must equal the sum of the 24 (or 12) per-cutoff withholding lines the employee saw.
      const summed = [...perCutoff.get(id)!.values()].reduce((sum, entry) => sum + cents(Math.abs(lineAmount(entry, "WHT")), id), 0);
      if (summed !== cents(Number(row.taxWithheld), id)) fail(id, `year-end tax withheld ${row.taxWithheld} differs from the sum of cutoff withholding lines ${(summed / 100).toFixed(2)}`);
    }
    for (const [id, spec] of specs) {
      const failures = failuresByEmployee.get(id) ?? [];
      const row = adjustments.find((item) => item.employeeId === workers.get(id));
      results.push({ id, part: "fullYear", status: failures.length ? "failed" : "passed", expected: spec.yearEnd, actual: row ? { taxDue: Number(row.taxDue), taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome } : undefined, failures });
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 9 compares exact centavos");
  const results: CaseResult[] = [...runAnnualizeCases(catalog)];
  try {
    results.push(...await runFullYear(catalog));
  } catch (error) {
    results.push({ id: "fullYear", part: "fullYear", status: "failed", expected: {}, actual: undefined, failures: [error instanceof Error ? error.message : String(error)] });
  }
  const failed = results.filter((r) => r.status === "failed");
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    version: catalog.version,
    catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failed.length ? "failed" : "passed",
    caseCount: results.length,
    sources: catalog.sources,
    assumptions: catalog.assumptions,
    results,
    limitations: catalog.limitations,
  }, null, 2) + "\n");
  for (const r of failed) console.error(`FAILED ${r.id}\n  ${r.failures.join("\n  ")}`);
  console.log(JSON.stringify({ status: failed.length ? "failed" : "passed", caseCount: results.length, failed: failed.map((r) => r.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().finally(() => pool.end());
