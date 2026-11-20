/**
 * Golden payroll certification, Phase 34: final pay honours a previous provider's imported de minimis pay the way year end does.
 * Year end applies each imported row's deMinimisBreakdown (ceiling per statutory period; the part inside is exempt, the part above
 * joins the shared 90,000 pool). The Separation API loads the same imported rows but takes its de minimis totals only from the released
 * engine payslips. Five workers on the same salary, whose first six months are imported (as the migration importer stores them) and
 * whose last six are calculated by the real engine (cutoffs 13-24), run through the real runYearEndAnnualization() and the real
 * computeFinalPay() fed the year-to-date inputs exactly as the Separation API derives them from the released and the imported rows.
 * Every expected value is an immutable hand-derived literal in certification/golden-payroll-phase34.json and is never computed
 * with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { deMinimisGrants, employeePayProfiles, employees, historicalPayrollEntries, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import { importedDeMinimisFinalPayAdjustment } from "../src/lib/final-pay-imported-de-minimis";
import { computeFinalPay, readBasicAndThirteenth, releasedExemptAllowanceYtd } from "../src/lib/final-pay";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type ImportedRow = {
  grossPay: number; basicSalary: number; netPay: number; taxWithheld: number; sssEmployee: number; philHealthEmployee: number; pagIbigEmployee: number;
  thirteenthMonth: number; deMinimisBreakdown?: Record<string, number>;
};
type Spec = {
  description: string;
  monthlySalary?: number;
  grant?: { benefitType: string; amount: number; frequency: string };
  imported: ImportedRow;
  yearEnd: Money;
  finalPayInputs: Money;
  finalPay: Money;
};
type Catalog = {
  version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[];
  employees: Record<string, Spec>; limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase34.json";
const artifactPath = "qa-artifacts/golden-payroll-phase34-reconciliation.json";
const TAX_YEAR = 2026;
const MONTHLY_SALARY = 30000;
const SOURCE_SYSTEM = "golden-phase34-previous-provider";
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
    label: `Phase 34 cutoff ${cutoff}`,
  };
}

const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string, salary: number) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P34-${id.slice(-12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    // Employed all year: six imported months, then the 12 engine cutoffs.
    basicRate: salary.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: salary.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

async function runCutoff(orgId: number, cutoff: number, specs: Array<[string, Spec]>, workers: Map<string, number>) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, specs.length, `cutoff ${cutoff}: expected ${specs.length} payroll entries, got ${rows.length}`);
  // The engine flags a worker whose imported history carries de minimis it must share a ceiling with: the estimate may miss other
  // prior-provider benefits in the shared 90,000 pool, so the entry is an Exception until reconciled. Only that one flag, and only for
  // a worker who has both imported de minimis and an engine grant, is accepted here; every other entry must be Ready.
  const sharedCeilingWorkers = new Set(specs.filter(([, spec]) => spec.grant && spec.imported.deMinimisBreakdown).map(([id]) => workers.get(id)));
  for (const row of rows) {
    const flags = ((row.trace as { flags?: unknown } | null)?.flags ?? []) as unknown[];
    const acceptedFlag = row.status === "Exception" && sharedCeilingWorkers.has(row.employeeId) && flags.length === 1 &&
      String(flags[0]).startsWith("Imported payroll history does not identify the shared PHP 90,000 benefit pool in full.");
    assert.ok(row.status === "Ready" || acceptedFlag, `cutoff ${cutoff}: payroll entry ${row.id} must calculate without exceptions (${row.status}: ${JSON.stringify(flags)})`);
  }
  // The year-end annualization and the final-pay derivation read Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
}

async function requireDisposablePhase34() {
  // This harness creates synthetic payroll runs and marks them Released for
  // ANNUALIZATION ONLY. Never allow it to touch a developer/customer database.
  for (const [name, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    GOLDEN_PHASE34_DISPOSABLE: "github-actions-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(process.env[name], expected, "PHASE34_REFUSED: unsafe " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
  ]) {
    assert.ok(!process.env[name], "PHASE34_REFUSED: provider credential " + name);
  }
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "PHASE34_REFUSED: PG16 required");
  const { rows: [count] } = await pool.query("SELECT COUNT(*)::int AS n FROM organizations");
  assert.equal(count.n, 0, "PHASE34_REFUSED: database must contain no employers");
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P34 final pay imported de minimis", legalName: "Golden P34 final pay imported de minimis Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const hired = new Map<string, typeof employees.$inferSelect>();
    for (const [id, spec] of specs) hired.set(id, await hire(org.id, id, spec.monthlySalary ?? MONTHLY_SALARY));
    const workers = new Map<string, number>([...hired].map(([id, employee]) => [id, employee.id]));
    // A grant, where a case has one, is active from the first engine cutoff, so the yearly ceiling is consumed cutoff by cutoff.
    for (const [id, spec] of specs) {
      if (!spec.grant) continue;
      await db.insert(deMinimisGrants).values({
        organizationId: org.id, employeeId: workers.get(id)!, benefitType: spec.grant.benefitType, amount: spec.grant.amount.toFixed(2),
        frequency: spec.grant.frequency, active: true, effectiveOn: `${TAX_YEAR}-07-01`,
      });
    }
    // Six imported months per worker, exactly as the importer stores them (pay date = last day of the month).
    for (const [id, spec] of specs) {
      for (let month = 1; month <= 6; month++) {
        const row = spec.imported;
        await db.insert(historicalPayrollEntries).values({
          organizationId: org.id, employeeId: workers.get(id)!, sourceSystem: SOURCE_SYSTEM, sourceReference: `P34-${id}-${month}`,
          periodLabel: `Previous provider ${month}`, payDate: `${TAX_YEAR}-${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`,
          grossPay: row.grossPay.toFixed(2), basicSalary: row.basicSalary.toFixed(2), netPay: row.netPay.toFixed(2), taxWithheld: row.taxWithheld.toFixed(2),
          sssEmployee: row.sssEmployee.toFixed(2), philHealthEmployee: row.philHealthEmployee.toFixed(2), pagIbigEmployee: row.pagIbigEmployee.toFixed(2),
          thirteenthMonth: row.thirteenthMonth.toFixed(2),
          ...(row.deMinimisBreakdown ? { deMinimisBreakdown: row.deMinimisBreakdown } : {}),
        });
      }
    }
    for (let cutoff = 13; cutoff <= 24; cutoff++) await runCutoff(org.id, cutoff, specs, workers);

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase34");
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
      assert.equal(rows.length, 12, `${id}: expected 12 released rows for final pay`);
      // The imported rows must really be there; otherwise the case would pass vacuously.
      const imported = await db.select().from(historicalPayrollEntries).where(and(eq(historicalPayrollEntries.organizationId, org.id), eq(historicalPayrollEntries.employeeId, workers.get(id)!)));
      assert.equal(imported.length, 6, `${id}: expected 6 imported rows`);
      let releasedBasicYtd = 0, thirteenthPaidYtd = 0, grossCompensationYtd = 0, statutoryContributionsYtd = 0, taxWithheldYtd = 0, deMinimisPaidYtd = 0, deMinimisExcessYtd = 0;
      for (const row of rows) {
        const parsed = readBasicAndThirteenth(row.lineItems, { taxYear: TAX_YEAR, sourceYearByAdjustmentId: new Map() });
        releasedBasicYtd += parsed.basic; thirteenthPaidYtd += parsed.thirteenthPaid;
        statutoryContributionsYtd += parsed.contributions; taxWithheldYtd += parsed.taxWithheld;
        deMinimisPaidYtd += parsed.deMinimisPaid; deMinimisExcessYtd += parsed.deMinimisExcess;
        // The Separation API's expression: ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid).
        grossCompensationYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid);
      }
      // The Separation API's historical loop, and the basic it passes as historicalBasicYtd (the sum of the imported basic salaries).
      let historicalBasicYtd = 0;
      for (const row of imported) {
        thirteenthPaidYtd += Number(row.thirteenthMonth);
        statutoryContributionsYtd += Number(row.sssEmployee) + Number(row.philHealthEmployee) + Number(row.pagIbigEmployee);
        taxWithheldYtd += Number(row.taxWithheld);
        grossCompensationYtd += Math.max(0, Number(row.grossPay) - Number(row.thirteenthMonth));
        historicalBasicYtd += Number(row.basicSalary);
      }
      // The Separation API's expressions: the released-row paid less excess and excess, plus the imported de minimis adjustment that
      // shares one statutory ceiling per category and period with the engine lines (the same delta year end applies).
      const importedDeMinimis = importedDeMinimisFinalPayAdjustment(imported, rows);
      const routeInputs = {
        releasedBasicYtd, historicalBasicYtd, thirteenthPaidYtd, grossCompensationYtd, statutoryContributionsYtd, taxWithheldYtd, releasedExemptAllowanceYtd: releasedExemptAllowanceYtd(rows),
        deMinimisYtd: Math.max(0, deMinimisPaidYtd - deMinimisExcessYtd) + importedDeMinimis.exempt, deMinimisExcessYtd: deMinimisExcessYtd + importedDeMinimis.excess,
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
      results.push(outcome(id, "engine", { yearEnd: spec.yearEnd, finalPayInputs: spec.finalPayInputs, finalPay: spec.finalPay },
        { taxDue: row ? Number(row.taxDue) : undefined, adjustment: row ? Number(row.adjustment) : undefined, finalPayTaxDue: finalPay.get(id)?.taxDue, finalPayRefund: finalPay.get(id)?.taxAdjustment, netFinalPay: finalPay.get(id)?.netFinalPay },
        failuresById.get(id) ?? []));
    }
  } finally {
    await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    await db.delete(historicalPayrollEntries).where(eq(historicalPayrollEntries.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  await requireDisposablePhase34();
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 34 compares exact centavos");
  assert.ok(catalog.limitations.length > 0, "Phase 34 must document what it does not certify");
  const results = await runEngine(catalog);
  const failures = results.flatMap((result) => result.failures);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    phase: "golden-payroll-phase34", catalogVersion: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length, results,
  }, null, 2));
  for (const result of results) console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
  if (failures.length) {
    for (const message of failures) console.error(`  ${message}`);
    throw new Error(`Golden payroll Phase 34 failed: ${failures.length} mismatch(es).`);
  }
  console.log(`Golden payroll Phase 34: ${results.length}/${results.length} cases passed.`);
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
