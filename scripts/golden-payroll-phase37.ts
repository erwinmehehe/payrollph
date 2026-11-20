/**
 * Golden payroll certification, Phase 37: a mid-year raise flows through every cutoff, year end and final pay.
 * Six monthly workers are hired on 2026-01-01 at 30,000 and paid by the real engine for all 24 cutoffs on disposable PostgreSQL 16.
 * Five get a raise (36,000 or 40,000) recorded just before the cutoff that contains the effective date, exactly as the employees API
 * writes it (a pay revision plus the new stored rate); one records the same raise while an earlier cutoff is still unprocessed.
 * Each cutoff's gross pay, contributions and withholding is compared with the hand-derived catalog; then the real
 * runYearEndAnnualization() and the real computeFinalPay() (fed the year-to-date inputs exactly as the Separation API derives them)
 * are compared with it. Every expected value is an immutable literal in certification/golden-payroll-phase37.json and is never
 * computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employeePayRevisions, employees, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import { computeFinalPay, readBasicAndThirteenth, releasedExemptAllowanceYtd } from "../src/lib/final-pay";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type Segment = { cutoffs: [number, number]; grossPay: number; contributions: number; withholding: number };
type Raise = { effectiveDate: string; newSalary: number; recordedBeforeCutoff: number };
type Spec = {
  description: string;
  monthlySalary: number;
  raise?: Raise;
  schedule: Segment[];
  yearEnd: Money;
  finalPayInputs: Money;
  finalPay: Money;
};
type Catalog = {
  version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[];
  employees: Record<string, Spec>; limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase37.json";
const artifactPath = "qa-artifacts/golden-payroll-phase37-reconciliation.json";
const TAX_YEAR = 2026;
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
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
    label: `Phase 37 cutoff ${cutoff}`,
  };
}

/** The schedule row that applies to a cutoff; the catalog must cover every cutoff exactly once. */
function expectedFor(spec: Spec, cutoff: number) {
  const rows = spec.schedule.filter((segment) => cutoff >= segment.cutoffs[0] && cutoff <= segment.cutoffs[1]);
  assert.equal(rows.length, 1, `cutoff ${cutoff}: the catalog schedule must cover it exactly once`);
  return rows[0];
}

const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string, salary: number) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P37-${id.slice(-12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: salary.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: salary.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

/** What the employees API writes for a raise: the pay revision (previous and new rate) and the new stored rate. */
async function recordRaise(orgId: number, employeeId: number, previousSalary: number, raise: Raise) {
  await db.insert(employeePayRevisions).values({
    employeeId, organizationId: orgId, effectiveDate: raise.effectiveDate,
    previousPayBasis: "monthly", previousRateAmount: previousSalary.toFixed(2), previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00",
    newPayBasis: "monthly", newRateAmount: raise.newSalary.toFixed(2), newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00",
    reason: "Golden Phase 37 raise", createdBy: "Golden certification",
  });
  await db.update(employeePayProfiles).set({ rateAmount: raise.newSalary.toFixed(2) }).where(eq(employeePayProfiles.employeeId, employeeId));
  await db.update(employees).set({ basicRate: raise.newSalary.toFixed(2) }).where(eq(employees.id, employeeId));
}

async function runCutoff(orgId: number, cutoff: number, specs: Array<[string, Spec]>, workers: Map<string, number>, fail: (id: string, message: string) => void) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, specs.length, `cutoff ${cutoff}: expected ${specs.length} payroll entries, got ${rows.length}`);
  for (const [id, spec] of specs) {
    const row = rows.find((item) => item.employeeId === workers.get(id));
    assert.ok(row, `cutoff ${cutoff}: no payroll entry for ${id}`);
    const flags = ((row.trace as { flags?: unknown } | null)?.flags ?? []) as unknown[];
    assert.equal(row.status, "Ready", `cutoff ${cutoff} ${id}: payroll entry must calculate without exceptions (${row.status}: ${JSON.stringify(flags)})`);
    const parsed = readBasicAndThirteenth(row.lineItems, { taxYear: TAX_YEAR, sourceYearByAdjustmentId: new Map() });
    const want = expectedFor(spec, cutoff);
    for (const message of compare(`${id} cutoff ${cutoff}`, { grossPay: want.grossPay, contributions: want.contributions, withholding: want.withholding },
      { grossPay: Number(row.grossPay), contributions: parsed.contributions, withholding: parsed.taxWithheld })) fail(id, message);
  }
  // The year-end annualization and the final-pay derivation read Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
}

async function requireDisposablePhase37() {
  // This harness creates synthetic payroll runs and marks them Released for
  // ANNUALIZATION ONLY. Never allow it to touch a developer/customer database.
  for (const [name, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    GOLDEN_PHASE37_DISPOSABLE: "github-actions-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(process.env[name], expected, "PHASE37_REFUSED: unsafe " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
  ]) {
    assert.ok(!process.env[name], "PHASE37_REFUSED: provider credential " + name);
  }
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "PHASE37_REFUSED: PG16 required");
  const { rows: [count] } = await pool.query("SELECT COUNT(*)::int AS n FROM organizations");
  assert.equal(count.n, 0, "PHASE37_REFUSED: database must contain no employers");
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P37 mid-year raise", legalName: "Golden P37 mid-year raise Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const hired = new Map<string, typeof employees.$inferSelect>();
    for (const [id, spec] of specs) hired.set(id, await hire(org.id, id, spec.monthlySalary));
    const workers = new Map<string, number>([...hired].map(([id, employee]) => [id, employee.id]));

    for (let cutoff = 1; cutoff <= 24; cutoff++) {
      // A raise is recorded before the cutoff the catalog names, in the order the employees API allows.
      for (const [id, spec] of specs) {
        if (spec.raise && spec.raise.recordedBeforeCutoff === cutoff) await recordRaise(org.id, workers.get(id)!, spec.monthlySalary, spec.raise);
      }
      await runCutoff(org.id, cutoff, specs, workers, fail);
    }

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase37");
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!);
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
        taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
      };
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
    }

    // Final pay: derive the year-to-date inputs from the released rows exactly as the Separation API does, then run computeFinalPay.
    const finalPay = new Map<string, ReturnType<typeof computeFinalPay>>();
    for (const [id, spec] of specs) {
      const rows = await db.select({ lineItems: payrollEntries.lineItems, grossPay: payrollEntries.grossPay, payDate: payrollRuns.payDate }).from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(eq(payrollRuns.organizationId, org.id), eq(payrollEntries.employeeId, workers.get(id)!), eq(payrollRuns.status, "Released")));
      assert.equal(rows.length, 24, `${id}: expected 24 released rows for final pay`);
      let releasedBasicYtd = 0, thirteenthPaidYtd = 0, grossCompensationYtd = 0, statutoryContributionsYtd = 0, taxWithheldYtd = 0, deMinimisPaidYtd = 0, deMinimisExcessYtd = 0;
      for (const row of rows) {
        const parsed = readBasicAndThirteenth(row.lineItems, { taxYear: TAX_YEAR, sourceYearByAdjustmentId: new Map() });
        releasedBasicYtd += parsed.basic; thirteenthPaidYtd += parsed.thirteenthPaid;
        statutoryContributionsYtd += parsed.contributions; taxWithheldYtd += parsed.taxWithheld;
        deMinimisPaidYtd += parsed.deMinimisPaid; deMinimisExcessYtd += parsed.deMinimisExcess;
        // The Separation API's expression: ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid).
        grossCompensationYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid);
      }
      const routeInputs = {
        releasedBasicYtd, historicalBasicYtd: 0, thirteenthPaidYtd, grossCompensationYtd, statutoryContributionsYtd, taxWithheldYtd, releasedExemptAllowanceYtd: releasedExemptAllowanceYtd(rows),
        deMinimisYtd: Math.max(0, deMinimisPaidYtd - deMinimisExcessYtd), deMinimisExcessYtd,
      };
      for (const message of compare(`${id} final-pay inputs`, spec.finalPayInputs, routeInputs)) fail(id, message);
      const result = computeFinalPay({
        releasedBasicYtd, historicalBasicYtd: routeInputs.historicalBasicYtd, unpaidBasicSalary: 0, thirteenthPaidYtd: routeInputs.thirteenthPaidYtd, grossCompensationYtd: routeInputs.grossCompensationYtd,
        releasedExemptAllowanceYtd: routeInputs.releasedExemptAllowanceYtd,
        deMinimisYtd: routeInputs.deMinimisYtd, deMinimisExcessYtd: routeInputs.deMinimisExcessYtd, statutoryContributionsYtd: routeInputs.statutoryContributionsYtd, taxWithheldYtd: routeInputs.taxWithheldYtd, mwe: false, mweTaxableSupplementaryCompensationYtd: 0,
        leaveMonetizationPay: 0, taxableLeaveMonetizationPay: 0, separationPay: 0, retirementPay: 0, taxableSeparationPay: 0, taxableRetirementPay: 0,
        otherBenefits: 0, finalStatutoryDeductions: 0, loanDeductions: 0,
      });
      for (const message of compare(`${id} final pay`, spec.finalPay, result)) fail(id, message);
      const settlement = adjustments.find((item) => item.employeeId === workers.get(id)!);
      assert.ok(settlement, `${id}: missing year-end settlement`);
      for (const message of compare(`${id} year-end parity`, {
        taxDue: Number(settlement.taxDue), taxAdjustment: -Number(settlement.adjustment),
        taxableIncome: Number(settlement.taxableIncome), nonTaxable: Number(settlement.nonTaxable),
      }, { ...result.annualization, taxAdjustment: result.taxAdjustment })) fail(id, message);
      finalPay.set(id, result);
    }
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!);
      results.push(outcome(id, "engine", { schedule: spec.schedule, yearEnd: spec.yearEnd, finalPayInputs: spec.finalPayInputs, finalPay: spec.finalPay },
        { taxDue: row ? Number(row.taxDue) : undefined, adjustment: row ? Number(row.adjustment) : undefined, finalPayTaxDue: finalPay.get(id)?.taxDue, finalPayRefund: finalPay.get(id)?.taxAdjustment, netFinalPay: finalPay.get(id)?.netFinalPay },
        failuresById.get(id) ?? []));
    }
  } finally {
    await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  await requireDisposablePhase37();
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 37 compares exact centavos");
  assert.ok(catalog.limitations.length > 0, "Phase 37 must document what it does not certify");
  const results = await runEngine(catalog);
  const failures = results.flatMap((result) => result.failures);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    phase: "golden-payroll-phase37", catalogVersion: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length, results,
  }, null, 2));
  for (const result of results) console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
  if (failures.length) {
    for (const message of failures) console.error(`  ${message}`);
    throw new Error(`Golden payroll Phase 37 failed: ${failures.length} mismatch(es).`);
  }
  console.log(`Golden payroll Phase 37: ${results.length}/${results.length} cases passed.`);
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
