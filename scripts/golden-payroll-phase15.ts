/**
 * Golden payroll certification, Phase 15: withholding and review holds in the CALCULATED cutoffs of a provider-switch year.
 * Phase 14 certified the year-end settlement. This phase runs the real engine for cutoffs 13-24 after six imported months and
 * checks, per cutoff, the withholding on the payslip, the run status and the review flags, then that the real
 * runYearEndAnnualization() closes the year exactly (tax due - everything withheld). Every expected value is an immutable
 * hand-derived literal in certification/golden-payroll-phase15.json and is never computed with PayrollPH functions.
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
type Spec = {
  description: string; imported: ImportedRow;
  grant: { benefitType: string; amount: number; frequency: string; effectiveOn: string } | null;
  cutoffs: { withholdingEachCutoff: number; withholdingOverrides?: Record<string, number>; status: string; noBreakdownFlagFrom: number | null; poolFlagFrom: number | null };
  yearEnd: Money;
};
type Catalog = { version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[]; employees: Record<string, Spec>; limitations: string[] };
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };
type CutoffObservation = { status: string; withholding: number; noBreakdownFlag: boolean; poolFlag: boolean };

const catalogPath = "certification/golden-payroll-phase15.json";
const artifactPath = "qa-artifacts/golden-payroll-phase15-reconciliation.json";
const TAX_YEAR = 2026;
const SOURCE_SYSTEM = "golden-phase15-previous-provider";
const MONTHLY_SALARY = 30000;
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const NO_BREAKDOWN_FLAG = "has no de minimis category breakdown";
const POOL_FLAG = "does not identify the shared PHP 90,000";

const cents = (value: number, label: string) => {
  assert.ok(Number.isFinite(value), `${label}: non-finite amount`);
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), `${label}: unsafe centavo amount`);
  return result;
};

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
  return {
    periodStart: `${TAX_YEAR}-${pad(month)}-${firstHalf ? "01" : "16"}`,
    periodEnd: `${TAX_YEAR}-${pad(month)}-${firstHalf ? "15" : pad(MONTH_END[month - 1])}`,
    label: `Phase 15 cutoff ${cutoff}`,
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P15-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: MONTHLY_SALARY.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: MONTHLY_SALARY.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

/** Runs one calculated cutoff for everyone and returns what each payslip and its review state show. */
async function runCutoff(orgId: number, cutoff: number, employeeIds: Map<number, string>) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, employeeIds.size, `cutoff ${cutoff}: expected ${employeeIds.size} payroll entries, got ${rows.length}`);
  const observed = new Map<string, CutoffObservation>();
  for (const row of rows) {
    const key = employeeIds.get(row.employeeId);
    assert.ok(key, `cutoff ${cutoff}: unknown employee ${row.employeeId}`);
    const items = row.lineItems as Array<{ code?: string; amount?: string | number }>;
    const wht = items.find((item) => item.code === "WHT");
    assert.ok(wht, `${key} cutoff ${cutoff}: no withholding line`);
    const flags = ((row.trace as { flags?: unknown })?.flags ?? []) as unknown[];
    observed.set(key, {
      status: row.status,
      withholding: Math.abs(Number(wht.amount)),
      noBreakdownFlag: flags.some((flag) => String(flag).includes(NO_BREAKDOWN_FLAG)),
      poolFlag: flags.some((flag) => String(flag).includes(POOL_FLAG)),
    });
  }
  // The year-end annualization reads Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
  return observed;
}

function checkCutoffs(id: string, spec: Spec, byCutoff: Map<number, CutoffObservation>) {
  const failures: string[] = [];
  for (let cutoff = 13; cutoff <= 24; cutoff++) {
    const seen = byCutoff.get(cutoff);
    if (!seen) { failures.push(`${id} cutoff ${cutoff}: not observed`); continue; }
    const expectedWht = spec.cutoffs.withholdingOverrides?.[String(cutoff)] ?? spec.cutoffs.withholdingEachCutoff;
    if (cents(seen.withholding, id) !== cents(expectedWht, id)) failures.push(`${id} cutoff ${cutoff} withholding: expected ₱${expectedWht.toFixed(2)}, got ₱${seen.withholding.toFixed(2)}`);
    if (seen.status !== spec.cutoffs.status) failures.push(`${id} cutoff ${cutoff} status: expected ${spec.cutoffs.status}, got ${seen.status}`);
    const wantBreakdown = spec.cutoffs.noBreakdownFlagFrom !== null && cutoff >= spec.cutoffs.noBreakdownFlagFrom;
    if (seen.noBreakdownFlag !== wantBreakdown) failures.push(`${id} cutoff ${cutoff} no-breakdown review flag: expected ${wantBreakdown}, got ${seen.noBreakdownFlag}`);
    const wantPool = spec.cutoffs.poolFlagFrom !== null && cutoff >= spec.cutoffs.poolFlagFrom;
    if (seen.poolFlag !== wantPool) failures.push(`${id} cutoff ${cutoff} pool review flag: expected ${wantPool}, got ${seen.poolFlag}`);
  }
  return failures;
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P15 provider-switch cutoffs", legalName: "Golden P15 provider-switch cutoffs Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const workers = new Map<string, typeof employees.$inferSelect>();
    for (const [id] of specs) workers.set(id, await hire(org.id, id));
    const idByEmployee = new Map<number, string>([...workers].map(([id, employee]) => [employee.id, id]));
    for (const [id, spec] of specs) {
      const employee = workers.get(id)!;
      for (let month = 1; month <= 6; month++) {
        const payDate = `${TAX_YEAR}-${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`;
        const row = spec.imported;
        await db.insert(historicalPayrollEntries).values({
          organizationId: org.id, employeeId: employee.id, sourceSystem: SOURCE_SYSTEM, sourceReference: `P15-${id}-${month}`, periodLabel: `Previous provider ${payDate}`, payDate,
          grossPay: row.grossPay.toFixed(2), basicSalary: row.basicSalary.toFixed(2), netPay: row.netPay.toFixed(2), taxWithheld: row.taxWithheld.toFixed(2),
          sssEmployee: row.sssEmployee.toFixed(2), philHealthEmployee: row.philHealthEmployee.toFixed(2), pagIbigEmployee: row.pagIbigEmployee.toFixed(2),
          thirteenthMonth: row.thirteenthMonth.toFixed(2), ...(row.deMinimisBreakdown ? { deMinimisBreakdown: row.deMinimisBreakdown } : {}),
        });
      }
      if (spec.grant) {
        await db.insert(deMinimisGrants).values({
          organizationId: org.id, employeeId: employee.id, benefitType: spec.grant.benefitType, amount: spec.grant.amount.toFixed(2),
          frequency: spec.grant.frequency, active: true, effectiveOn: spec.grant.effectiveOn,
        });
      }
    }
    const observed = new Map<string, Map<number, CutoffObservation>>(specs.map(([id]) => [id, new Map()]));
    for (let cutoff = 13; cutoff <= 24; cutoff++) {
      const perWorker = await runCutoff(org.id, cutoff, idByEmployee);
      for (const [id, seen] of perWorker) observed.get(id)!.set(cutoff, seen);
    }
    for (const [id, spec] of specs) for (const message of checkCutoffs(id, spec, observed.get(id)!)) fail(id, message);

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase15");
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
    }
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      results.push(outcome(id, "engine", { cutoffs: spec.cutoffs, yearEnd: spec.yearEnd },
        { cutoff13: observed.get(id)!.get(13), cutoff24: observed.get(id)!.get(24), taxDue: row ? Number(row.taxDue) : undefined, adjustment: row ? Number(row.adjustment) : undefined },
        failuresById.get(id) ?? []));
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
  assert.equal(catalog.toleranceCentavos, 0, "Phase 15 compares exact centavos");
  const results: CaseResult[] = [];
  try {
    results.push(...await runEngine(catalog));
  } catch (error) {
    results.push({ id: "engine", part: "engine", status: "failed", expected: {}, actual: undefined, failures: [errorText(error)] });
  }
  const failed = results.filter((r) => r.status === "failed");
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    version: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"), status: failed.length ? "failed" : "passed",
    caseCount: results.length, sources: catalog.sources, assumptions: catalog.assumptions, results, limitations: catalog.limitations,
  }, null, 2) + "\n");
  for (const r of failed) console.error(`FAILED ${r.id}\n  ${r.failures.join("\n  ")}`);
  console.log(JSON.stringify({ status: failed.length ? "failed" : "passed", caseCount: results.length, failed: failed.map((r) => r.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().finally(() => pool.end());
