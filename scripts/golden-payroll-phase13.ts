/**
 * Golden payroll certification, Phase 13: imported prior-provider history in the year-end annualization.
 * A company that switches payroll provider mid-year brings the earlier months as imported history (source-of-truth totals).
 * The real payroll engine calculates the months after the switch (cutoffs 13-24); imported rows for January to June are
 * inserted as the migration importer stores them; the real runYearEndAnnualization() joins both. Every expected value is an
 * immutable literal in certification/golden-payroll-phase13.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, historicalPayrollEntries, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type ImportedRow = {
  grossPay: number; basicSalary: number; netPay: number; taxWithheld: number;
  sssEmployee: number; philHealthEmployee: number; pagIbigEmployee: number; thirteenthMonth: number;
  deMinimisBreakdown?: Record<string, number>;
};
type ExtraRow = ImportedRow & { payDate: string; sourceReference: string };
type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  employees: Record<string, {
    description: string; imported: ImportedRow; importedOverrides: Record<string, Partial<ImportedRow>>; extraRows?: ExtraRow[];
    yearEnd: Money; breakdown: Record<string, number>;
  }>;
  controls: {
    description: string; monthlySalary: number; startCutoff: number;
    missingBasicRefusal: string; mweRefusal: string; duplicateSourceRefusal: string; cleanYearEnd: Money;
    deMinimisLeaveDaysRefusal: string; deMinimisUnknownCategoryRefusal: string; deMinimisAboveGrossRefusal: string;
  };
  limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase13.json";
const artifactPath = "qa-artifacts/golden-payroll-phase13-reconciliation.json";
const TAX_YEAR = 2026;
const SOURCE_SYSTEM = "golden-phase13-previous-provider";
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
  return { periodStart, periodEnd, payDate: periodEnd, label: `Phase 13 cutoff ${cutoff}` };
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string, monthlySalary: number, options: { mwe?: boolean } = {}) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P13-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: monthlySalary.toFixed(2), mwe: options.mwe ?? false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: monthlySalary.toFixed(2),
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

async function rejects(promise: Promise<unknown>, needle: string) {
  try { await promise; } catch (error) { return errorText(error).includes(needle) || String((error as { cause?: unknown })?.cause ?? "").includes(needle) ? null : `expected "${needle}", got ${errorText(error)}`; }
  return `expected "${needle}", but the call succeeded`;
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P13 provider switch", legalName: "Golden P13 provider switch Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const [controlOrg] = await db.insert(organizations).values({ name: "Golden P13 controls", legalName: "Golden P13 controls Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const orgIds = [org.id, controlOrg.id];
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const workers = new Map<string, typeof employees.$inferSelect>();
    for (const [id] of specs) workers.set(id, await hire(org.id, id, 30000));
    // Six imported months per worker, exactly as the importer stores them (pay date = last day of the month).
    for (const [id, spec] of specs) {
      const employee = workers.get(id)!;
      for (let month = 1; month <= 6; month++) {
        const payDate = `${TAX_YEAR}-${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`;
        const row = { ...spec.imported, ...(spec.importedOverrides[String(month)] ?? {}) };
        await db.insert(historicalPayrollEntries).values(importedValues(org.id, employee.id, row, payDate, `P13-${id}-${month}`));
      }
      for (const extra of spec.extraRows ?? []) await db.insert(historicalPayrollEntries).values(importedValues(org.id, employee.id, extra, extra.payDate, extra.sourceReference));
    }
    // The engine calculates only the months after the switch.
    for (let cutoff = 13; cutoff <= 24; cutoff++) await runCutoff(org.id, cutoff, specs.length);

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase13");
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
        taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
      };
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
      const breakdown = row.breakdown as Record<string, unknown> | null;
      for (const message of compare(`${id} breakdown`, spec.breakdown, breakdown ?? {})) fail(id, message);
    }
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      results.push(outcome(id, "engine", spec.yearEnd, row ? { taxDue: Number(row.taxDue), taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome } : undefined, failuresById.get(id) ?? []));
    }

    // ---- Controls: a separate employer with one calculated cutoff, each refusal on its own.
    const control = catalog.controls;
    const controlFailures: string[] = [];
    const check = (message: string | null, label: string) => { if (message) controlFailures.push(`${label}: ${message}`); };
    const worker = await hire(controlOrg.id, "controls", control.monthlySalary);
    await runCutoff(controlOrg.id, control.startCutoff, 1);
    const settledRows = async () => (await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, controlOrg.id))).length;
    const goodRow: ImportedRow = catalog.employees.sameFiguresAsOneEmployer.imported;
    const importedRows = () => db.select().from(historicalPayrollEntries).where(eq(historicalPayrollEntries.organizationId, controlOrg.id));

    // An imported row without basic salary earned cannot be annualized (the 13th month would be wrong).
    await db.insert(historicalPayrollEntries).values({ ...importedValues(controlOrg.id, worker.id, goodRow, `${TAX_YEAR}-01-31`, "CTRL-NO-BASIC"), basicSalary: null });
    check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase13"), control.missingBasicRefusal), "imported row without basic salary earned");
    if (await settledRows() !== 0) controlFailures.push("a refused settlement must leave no adjustment rows");
    await db.delete(historicalPayrollEntries).where(eq(historicalPayrollEntries.organizationId, controlOrg.id));

    // A source reference is unique per worker and source system.
    await db.insert(historicalPayrollEntries).values(importedValues(controlOrg.id, worker.id, goodRow, `${TAX_YEAR}-01-31`, "CTRL-DUP"));
    check(await rejects(db.insert(historicalPayrollEntries).values(importedValues(controlOrg.id, worker.id, goodRow, `${TAX_YEAR}-02-28`, "CTRL-DUP")), control.duplicateSourceRefusal), "a repeated source reference");
    if ((await importedRows()).length !== 1) controlFailures.push("a refused duplicate must not add an imported row");

    // De minimis detail that cannot be proven against its statutory ceiling is refused, never guessed.
    const refusedDeMinimis = async (breakdown: Record<string, number>, grossPay: number, needle: string, label: string) => {
      await db.insert(historicalPayrollEntries).values(importedValues(controlOrg.id, worker.id, { ...goodRow, grossPay, deMinimisBreakdown: breakdown }, `${TAX_YEAR}-03-31`, "CTRL-DM"));
      check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase13"), needle), label);
      if (await settledRows() !== 0) controlFailures.push(`${label}: a refused settlement must leave no adjustment rows`);
      await db.delete(historicalPayrollEntries).where(and(eq(historicalPayrollEntries.organizationId, controlOrg.id), eq(historicalPayrollEntries.sourceReference, "CTRL-DM")));
    };
    await refusedDeMinimis({ monetizedVacationLeaveDays: 5 }, 30000, control.deMinimisLeaveDaysRefusal, "monetized leave days in imported de minimis");
    await refusedDeMinimis({ madeUpBenefit: 100 }, 30000, control.deMinimisUnknownCategoryRefusal, "an unknown imported de minimis category");
    await refusedDeMinimis({ riceSubsidy: 2500 }, 2000, control.deMinimisAboveGrossRefusal, "imported de minimis above the row's gross pay");

    // A minimum wage earner cannot be annualized from imported totals (no statutory-wage versus taxable-supplementary breakdown).
    await db.update(employees).set({ mwe: true }).where(eq(employees.id, worker.id));
    check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase13"), control.mweRefusal), "minimum wage earner with imported history");
    if (await settledRows() !== 0) controlFailures.push("a refused MWE settlement must leave no adjustment rows");
    await db.update(employees).set({ mwe: false }).where(eq(employees.id, worker.id));

    // With no imported history the same worker settles on the one calculated cutoff.
    await db.delete(historicalPayrollEntries).where(eq(historicalPayrollEntries.organizationId, controlOrg.id));
    await runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase13");
    const [cleanRow] = await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, controlOrg.id));
    if (!cleanRow) controlFailures.push("the clean settlement produced no adjustment row");
    else {
      for (const message of compare("clean year-end", control.cleanYearEnd, {
        grossCompensation: Number(cleanRow.grossCompensation), thirteenthMonth: Number(cleanRow.thirteenthMonth), nonTaxable: Number(cleanRow.nonTaxable),
        statutoryContributions: Number(cleanRow.statutoryContributions), taxableIncome: Number(cleanRow.taxableIncome), taxDue: Number(cleanRow.taxDue),
        taxWithheld: Number(cleanRow.taxWithheld), adjustment: Number(cleanRow.adjustment), outcome: cleanRow.outcome,
      })) controlFailures.push(message);
      const importedCount = (cleanRow.breakdown as { importedHistoryRows?: number } | null)?.importedHistoryRows;
      if (importedCount !== 0) controlFailures.push(`a settlement without imported history must record 0 imported rows, got ${importedCount}`);
    }
    results.push(outcome("controls", "controls", control.cleanYearEnd, cleanRow ? { taxDue: Number(cleanRow.taxDue), adjustment: Number(cleanRow.adjustment) } : undefined, controlFailures));
  } finally {
    for (const orgId of orgIds) {
      await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
  }
  return results;
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 13 compares exact centavos");
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
