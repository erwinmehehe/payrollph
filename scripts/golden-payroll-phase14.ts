/**
 * Golden payroll certification, Phase 14: one statutory de minimis ceiling shared by imported history and calculated payroll.
 * A company that switches payroll provider mid-year brings the earlier months as imported history (with the previous provider's
 * de minimis totals by category); the real engine calculates the later months, including its own de minimis grants. The RR 29-2025
 * ceiling for a category and statutory period applies once to the worker, so the real runYearEndAnnualization() must count the
 * imported and the calculated amounts together. Every expected value is an immutable literal in
 * certification/golden-payroll-phase14.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { deMinimisGrants, employeePayProfiles, employees, historicalPayrollEntries, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type ImportedRow = {
  grossPay: number; basicSalary: number; netPay: number; taxWithheld: number;
  sssEmployee: number; philHealthEmployee: number; pagIbigEmployee: number; thirteenthMonth: number;
  deMinimisBreakdown?: Record<string, number>;
};
type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  employees: Record<string, {
    description: string; imported: ImportedRow;
    grant: { benefitType: string; amount: number; frequency: string; effectiveOn: string };
    yearEnd: Money; breakdown: Record<string, number>;
  }>;
  limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase14.json";
const artifactPath = "qa-artifacts/golden-payroll-phase14-reconciliation.json";
const TAX_YEAR = 2026;
const SOURCE_SYSTEM = "golden-phase14-previous-provider";
const MONTHLY_SALARY = 30000;
// 2026 is not a leap year.
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const cents = (value: number, label: string) => {
  assert.ok(Number.isFinite(value), `${label}: non-finite amount`);
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), `${label}: unsafe centavo amount`);
  return result;
};

/** Compares numbers to the centavo and strings exactly; returns human-readable failures. */
function compare(id: string, expected: Money, actual: Record<string, unknown>) {
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
  return { periodStart, periodEnd, payDate: periodEnd, label: `Phase 14 cutoff ${cutoff}` };
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P14-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: MONTHLY_SALARY.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: MONTHLY_SALARY.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

async function runCutoff(orgId: number, cutoff: number, expectedEntries: number) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.payDate,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, expectedEntries, `cutoff ${cutoff}: expected ${expectedEntries} payroll entries, got ${rows.length}`);
  // The year-end annualization reads Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
}

const importedValues = (orgId: number, employeeId: number, row: ImportedRow, payDate: string, sourceReference: string) => ({
  organizationId: orgId, employeeId, sourceSystem: SOURCE_SYSTEM, sourceReference, periodLabel: `Previous provider ${payDate}`, payDate,
  grossPay: row.grossPay.toFixed(2), basicSalary: row.basicSalary.toFixed(2), netPay: row.netPay.toFixed(2), taxWithheld: row.taxWithheld.toFixed(2),
  sssEmployee: row.sssEmployee.toFixed(2), philHealthEmployee: row.philHealthEmployee.toFixed(2), pagIbigEmployee: row.pagIbigEmployee.toFixed(2),
  thirteenthMonth: row.thirteenthMonth.toFixed(2),
  ...(row.deMinimisBreakdown ? { deMinimisBreakdown: row.deMinimisBreakdown } : {}),
});

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P14 shared de minimis ceiling", legalName: "Golden P14 shared de minimis ceiling Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const workers = new Map<string, typeof employees.$inferSelect>();
    for (const [id] of specs) workers.set(id, await hire(org.id, id));
    for (const [id, spec] of specs) {
      const employee = workers.get(id)!;
      // Six imported months, exactly as the importer stores them (pay date = last day of the month).
      for (let month = 1; month <= 6; month++) {
        const payDate = `${TAX_YEAR}-${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`;
        await db.insert(historicalPayrollEntries).values(importedValues(org.id, employee.id, spec.imported, payDate, `P14-${id}-${month}`));
      }
      // The engine's own de minimis grant for the months after the switch.
      await db.insert(deMinimisGrants).values({
        organizationId: org.id, employeeId: employee.id, benefitType: spec.grant.benefitType, amount: spec.grant.amount.toFixed(2),
        frequency: spec.grant.frequency, active: true, effectiveOn: spec.grant.effectiveOn,
      });
    }
    // The engine calculates only the months after the switch.
    for (let cutoff = 13; cutoff <= 24; cutoff++) await runCutoff(org.id, cutoff, specs.length);

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase14");
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
      };
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
      const breakdown = row.breakdown as Record<string, unknown> | null;
      for (const message of compare(`${id} breakdown`, spec.breakdown, breakdown ?? {})) fail(id, message);
    }
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      results.push(outcome(id, "engine", spec.yearEnd, row ? { taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue) } : undefined, failuresById.get(id) ?? []));
    }
  } finally {
    await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 14 compares exact centavos");
  const results: CaseResult[] = [];
  try {
    results.push(...await runEngine(catalog));
  } catch (error) {
    results.push({ id: "engine", part: "engine", status: "failed", expected: {}, actual: undefined, failures: [errorText(error)] });
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
