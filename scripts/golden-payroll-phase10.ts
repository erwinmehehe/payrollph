/**
 * Golden payroll certification, Phase 10: a 13th month PAID inside a cutoff, and the December year-end binding.
 * Phase 9 certified the annualization with the 13th month accrued at year end. This runs the real payroll engine for all
 * 24 cutoffs of 2026 for four employees whose 13th month (and one bonus) is paid as an approved supplementary earning,
 * checks every cutoff's payslip, runs the real runYearEndAnnualization over the released year, then binds the adjustment to
 * the freshly calculated December 31 cutoff exactly as the year-end route does, recalculates it and checks the final payslip.
 * Every expected value is an immutable literal in certification/golden-payroll-phase10.json and is never computed with
 * PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollRuns, supplementaryEarnings, yearEndAdjustments } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Segment = { fromCutoff: number; toCutoff: number; expected: Record<string, number> };
type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  employees: Record<string, {
    description: string; monthlySalary: number;
    supplementary: Array<{ cutoff: number; earningType: string; label: string; amount: number }>;
    segments: Segment[];
    yearEnd: Record<string, number | string>;
    afterBinding: { netPay: number; yearEndLineAmount: number };
  }>;
  limitations: string[];
};
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type Entry = typeof payrollEntries.$inferSelect;
type CaseResult = { id: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase10.json";
const artifactPath = "qa-artifacts/golden-payroll-phase10-reconciliation.json";
const TAX_YEAR = 2026;
const FINAL_CUTOFF = 24;
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
const yearEndLine = (entry: Entry) => lines(entry).find((item) => String(item.code ?? "").startsWith("YE-TAX"));
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
  // A year-end refund is a credit against deductions in the printed payslip, so only the net identity must always hold.
  assert.equal(cents(totals.earnings, label), gross, `${label}: printed earnings differ from stored gross`);
  assert.equal(gross - deductions, net, `${label}: gross - deductions differs from stored net`);
}

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
  return { periodStart, periodEnd, payDate: periodEnd, label: `Phase 10 cutoff ${cutoff}` };
}

function actualOf(entry: Entry) {
  return {
    grossPay: Number(entry.grossPay),
    sss: Math.abs(lineAmount(entry, "SSS")),
    philHealth: Math.abs(lineAmount(entry, "PHIC")),
    pagIbig: Math.abs(lineAmount(entry, "HDMF")),
    taxableCompensation: traceNumber(entry, "taxableCompensation"),
    withholdingTax: Math.abs(lineAmount(entry, "WHT")),
    benefitPoolTaxableCurrent: traceNumber(entry, "benefitPoolTaxableCurrent"),
    netPay: Number(entry.netPay),
  };
}

async function runFullYear(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P10 full year", legalName: "Golden P10 full year Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const workers = new Map<string, number>();
  const perCutoff = new Map<string, Map<number, Entry>>();
  const finalAfterBinding = new Map<string, Entry>();
  const failuresByEmployee = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresByEmployee.set(id, [...(failuresByEmployee.get(id) ?? []), message]);
  const adjustmentRows = new Map<string, typeof yearEndAdjustments.$inferSelect>();
  try {
    for (const [id, spec] of specs) {
      const [employee] = await db.insert(employees).values({
        organizationId: org.id, employeeNo: `P10-${id.slice(0, 11)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
        basicRate: spec.monthlySalary.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
      }).returning();
      await db.insert(employeePayProfiles).values({
        employeeId: employee.id, organizationId: org.id, payBasis: "monthly", rateAmount: spec.monthlySalary.toFixed(2),
        standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
      });
      workers.set(id, employee.id);
      perCutoff.set(id, new Map());
    }

    let finalRunId = 0;
    for (let cutoff = 1; cutoff <= FINAL_CUTOFF; cutoff++) {
      const period = cutoffPeriod(cutoff);
      // Supplementary earnings are approved before the cutoff that pays them and effective on its pay date.
      for (const [id, spec] of specs) {
        for (const earning of spec.supplementary.filter((item) => item.cutoff === cutoff)) {
          await db.insert(supplementaryEarnings).values({
            organizationId: org.id, employeeId: workers.get(id)!, earningType: earning.earningType, label: earning.label,
            amount: earning.amount.toFixed(2), taxable: true, includeInSssBase: false, includeInPagIbigBase: false,
            effectiveDate: period.payDate, status: "approved", createdBy: "Golden certification",
          });
        }
      }
      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
        periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.payDate,
      }).returning();
      await enqueuePayrollRun(run.id, 25);
      await drainPayrollQueue(10, run.id);
      const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      assert.equal(rows.length, specs.length, `cutoff ${cutoff}: expected ${specs.length} payroll entries, got ${rows.length}`);
      for (const [id] of specs) {
        const entry = rows.find((row) => row.employeeId === workers.get(id));
        if (entry) perCutoff.get(id)!.set(cutoff, entry);
      }
      if (cutoff < FINAL_CUTOFF) await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
      else finalRunId = run.id;
    }

    for (const [id, spec] of specs) {
      for (const segment of spec.segments) {
        for (let cutoff = segment.fromCutoff; cutoff <= segment.toCutoff; cutoff++) {
          const entry = perCutoff.get(id)?.get(cutoff);
          if (!entry) { fail(id, `cutoff ${cutoff}: no payroll entry`); continue; }
          try { assertPayslipReconciles(entry, `${id} cutoff ${cutoff}`); } catch (error) { fail(id, error instanceof Error ? error.message : String(error)); }
          for (const message of compare(`${id} cutoff ${cutoff}`, segment.expected, actualOf(entry))) fail(id, message);
          if (cutoff !== FINAL_CUTOFF && yearEndLine(entry)) fail(id, `cutoff ${cutoff}: unexpected year-end tax line before the binding`);
        }
      }
      if (perCutoff.get(id)!.size !== FINAL_CUTOFF) fail(id, `expected ${FINAL_CUTOFF} cutoffs, found ${perCutoff.get(id)!.size}`);
    }

    // December binding, exactly as the year-end route: the final cutoff is freshly calculated (Needs review), included in
    // the annualization, the approved adjustment is bound to it, and the run is requeued in the same transaction.
    const [finalRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, finalRunId));
    assert.equal(finalRun.status, "Needs review", "the final cutoff must be freshly calculated before binding");
    assert.ok(String(finalRun.periodEnd).endsWith("-12-31"), "the bound cutoff must end on December 31");
    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase10", {
      includePayrollRunId: finalRunId, bindToPayrollRunId: finalRunId, approvedBy: "Golden certification",
      onBoundToPayrollRun: async (tx) => { await enqueuePayrollRun(finalRunId, undefined, tx); },
    });
    await drainPayrollQueue(10, finalRunId);
    const rebuilt = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, finalRunId));
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const employeeId = workers.get(id)!;
      const row = adjustments.find((item) => item.employeeId === employeeId);
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      adjustmentRows.set(id, row);
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
        taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
      };
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
      const summed = [...perCutoff.get(id)!.values()].reduce((sum, entry) => sum + cents(Math.abs(lineAmount(entry, "WHT")), id), 0);
      if (summed !== cents(Number(row.taxWithheld), id)) fail(id, `year-end tax withheld ${row.taxWithheld} differs from the sum of cutoff withholding lines ${(summed / 100).toFixed(2)}`);
      if (row.status !== "approved" || row.payrollRunId !== finalRunId) fail(id, `adjustment must be approved and bound to the final cutoff (status ${row.status}, run ${row.payrollRunId})`);

      const entry = rebuilt.find((item) => item.employeeId === employeeId);
      if (!entry) { fail(id, "final cutoff has no entry after binding"); continue; }
      finalAfterBinding.set(id, entry);
      try { assertPayslipReconciles(entry, `${id} final cutoff after binding`); } catch (error) { fail(id, error instanceof Error ? error.message : String(error)); }
      const line = yearEndLine(entry);
      if (!line) { fail(id, "recalculated final payslip has no year-end tax line"); continue; }
      const lineValue = Number(line.amount);
      // The payslip shows the adjustment as a deduction when collected (negative) and a credit when refunded (positive).
      for (const message of compare(`${id} final payslip`, spec.afterBinding, { netPay: Number(entry.netPay), yearEndLineAmount: lineValue })) fail(id, message);
      if (cents(Math.abs(lineValue), id) !== cents(Math.abs(Number(row.adjustment)), id)) fail(id, "year-end payslip line differs from the bound adjustment");
      if (cents(Math.abs(lineAmount(entry, "WHT")), id) !== cents(spec.segments.find((s) => s.fromCutoff <= FINAL_CUTOFF && FINAL_CUTOFF <= s.toCutoff)!.expected.withholdingTax, id)) {
        fail(id, "binding the year-end adjustment must not change the final cutoff's own withholding");
      }
    }
    for (const [id, spec] of specs) {
      const failures = failuresByEmployee.get(id) ?? [];
      const row = adjustmentRows.get(id);
      const entry = finalAfterBinding.get(id);
      results.push({
        id, status: failures.length ? "failed" : "passed", expected: { yearEnd: spec.yearEnd, afterBinding: spec.afterBinding },
        actual: row ? { taxDue: Number(row.taxDue), taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome, finalNet: entry ? Number(entry.netPay) : null } : undefined,
        failures,
      });
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 10 compares exact centavos");
  let results: CaseResult[];
  try {
    results = await runFullYear(catalog);
  } catch (error) {
    results = [{ id: "fullYear", status: "failed", expected: {}, actual: undefined, failures: [error instanceof Error ? error.message : String(error)] }];
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
