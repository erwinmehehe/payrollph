/**
 * Golden payroll certification, Phase 20: a minimum wage earner (MWE) in a provider-switch year. For an MWE the basic is exempt, so an
 * ordinary calculated cutoff withholds nothing and only the overflow of the shared PHP 90,000 pool is taxable (the imported 13th month
 * still shrinks the room; an unreadable import assumes nothing; a legacy MWE flag without wage-order evidence holds the run). Year-end
 * annualization behaves differently: it cannot annualize an MWE whose employer has imported history, so it SKIPS and reports that worker
 * (summary and audit, no adjustment row) while every other worker settles, and an MWE hired after the switch annualizes normally. It runs the real engine
 * for cutoffs 13-24 and the real runYearEndAnnualization(). Every expected value is an immutable hand-derived literal in
 * certification/golden-payroll-phase20.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeeMweClassifications, employeePayProfiles, employees, historicalPayrollEntries, organizations, payrollEntries, payrollRuns, supplementaryEarnings, yearEndAdjustments } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type Slip = { grossPay: number; sss: number; philHealth: number; pagIbig: number; withholding: number; netPay: number; status: string; poolFlag: boolean; legacyMweFlag: boolean };
type Spec = {
  scenario: string; mwe: boolean; classification: "approved" | "legacy" | "none"; monthlySalary: number; startDate: string;
  imported: { thirteenthMonth: number; unreadableMonth: number | null } | null;
  description: string; supplementary: Array<{ cutoff: number; earningType: string; label: string; amount: number }>;
  steadyCutoff: Slip; cutoffs: Record<string, Slip>; yearEnd?: Money; skippedAtYearEnd?: boolean;
};
type Scenario = { description: string; yearEnd: "none" | "skip" | "annualize"; skipped?: string[]; skipMessage?: string };
type Catalog = { version: string; toleranceCentavos: number; scenarios: Record<string, Scenario>; employees: Record<string, Spec>; limitations: string[] };
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase20.json";
const artifactPath = "qa-artifacts/golden-payroll-phase20-reconciliation.json";
const TAX_YEAR = 2026;
const SOURCE_SYSTEM = "golden-phase20-previous-provider";
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const POOL_FLAG = "does not identify the shared PHP 90,000";
const LEGACY_MWE_FLAG = "MWE tax classification is using a legacy employee flag";
const SSS_PHIC_HDMF_NON_MWE = { sss: 1750, philHealth: 1500, pagIbig: 200, withholding: 6518.2 };

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
    label: `Phase 20 cutoff ${cutoff}`,
  };
}

const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string, spec: Spec) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P20-${id.slice(0, 20)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: spec.monthlySalary.toFixed(2), mwe: spec.mwe, region: "NCR", startDate: spec.startDate,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: spec.monthlySalary.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  if (spec.classification === "approved") {
    // Fixture row: the approval workflow and the evidenced-wage equality rule are not part of this certification.
    await db.insert(employeeMweClassifications).values({
      organizationId: orgId, employeeId: employee.id, isMwe: true, region: "NCR", employeeDailyWage: "755.00", statutoryMinimumWage: "755.00",
      wageOrderReference: "FICTIONAL-WO-GOLDEN-20", evidenceReference: "Golden Phase 20 fixture evidence", effectiveFrom: spec.startDate,
      status: "approved", requestedByName: "Golden certification", decidedByName: "Golden certification",
    });
  }
  return employee;
}

/** Sum of the deduction lines with one code. A payslip deduction is a negative line; a reversed sign must never certify. */
function deductionLine(key: string, cutoff: number, items: Array<{ code?: string; amount?: string | number }>, code: string, allowAbsent: boolean) {
  const lines = items.filter((item) => item.code === code);
  if (lines.length === 0) {
    assert.ok(allowAbsent, `${key} cutoff ${cutoff}: expected a ${code} deduction line`);
    return 0;
  }
  assert.equal(lines.length, 1, `${key} cutoff ${cutoff}: expected exactly one ${code} deduction line`);
  const raw = lines[0].amount;
  assert.ok(raw !== undefined && (typeof raw !== "string" || raw.trim().length > 0), `${key} cutoff ${cutoff}: ${code} amount missing`);
  const value = Number(raw);
  assert.ok(Number.isFinite(value) && value <= 0, `${key} cutoff ${cutoff}: ${code} must be a finite deduction (negative line), got ${String(raw)}`);
  return -value;
}

async function runCutoff(orgId: number, cutoff: number, workers: Map<string, number>, specs: Array<[string, Spec]>, employeeIds: Map<number, string>) {
  const period = cutoffPeriod(cutoff);
  for (const [id, spec] of specs) {
    for (const earning of spec.supplementary.filter((item) => item.cutoff === cutoff)) {
      await db.insert(supplementaryEarnings).values({
        organizationId: orgId, employeeId: workers.get(id)!, earningType: earning.earningType, label: earning.label,
        amount: earning.amount.toFixed(2), taxable: true, includeInSssBase: false, includeInPagIbigBase: false,
        effectiveDate: period.periodEnd, status: "approved", createdBy: "Golden certification",
      });
    }
  }
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, specs.length, `cutoff ${cutoff}: expected ${specs.length} payroll entries, got ${rows.length}`);
  const observed = new Map<string, Slip>();
  for (const row of rows) {
    const key = employeeIds.get(row.employeeId);
    assert.ok(key, `cutoff ${cutoff}: unknown employee ${row.employeeId}`);
    const items = row.lineItems as Array<{ code?: string; amount?: string | number }>;
    const flags = ((row.trace as { flags?: unknown })?.flags ?? []) as unknown[];
    observed.set(key, {
      grossPay: Number(row.grossPay),
      sss: deductionLine(key, cutoff, items, "SSS", false),
      philHealth: deductionLine(key, cutoff, items, "PHIC", false),
      pagIbig: deductionLine(key, cutoff, items, "HDMF", false),
      // An MWE with no taxable compensation may carry no withholding line at all; a missing line is exactly zero.
      withholding: deductionLine(key, cutoff, items, "WHT", true),
      netPay: Number(row.netPay),
      status: row.status,
      poolFlag: flags.some((flag) => String(flag).includes(POOL_FLAG)),
      legacyMweFlag: flags.some((flag) => String(flag).includes(LEGACY_MWE_FLAG)),
    });
  }
  // The year-end annualization reads Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
  return observed;
}

function checkCutoffs(id: string, spec: Spec, byCutoff: Map<number, Slip>) {
  const failures: string[] = [];
  for (let cutoff = 13; cutoff <= 24; cutoff++) {
    const want = spec.cutoffs[String(cutoff)] ?? spec.steadyCutoff;
    const seen = byCutoff.get(cutoff);
    if (!seen) { failures.push(`${id} cutoff ${cutoff}: not observed`); continue; }
    for (const key of ["grossPay", "sss", "philHealth", "pagIbig", "withholding", "netPay"] as const) {
      if (cents(seen[key], id) !== cents(want[key], id)) failures.push(`${id} cutoff ${cutoff} ${key}: expected ₱${want[key].toFixed(2)}, got ₱${seen[key].toFixed(2)}`);
    }
    if (seen.status !== want.status) failures.push(`${id} cutoff ${cutoff} status: expected ${want.status}, got ${seen.status}`);
    if (seen.poolFlag !== want.poolFlag) failures.push(`${id} cutoff ${cutoff} pool review flag: expected ${want.poolFlag}, got ${seen.poolFlag}`);
    if (seen.legacyMweFlag !== want.legacyMweFlag) failures.push(`${id} cutoff ${cutoff} legacy MWE flag: expected ${want.legacyMweFlag}, got ${seen.legacyMweFlag}`);
  }
  return failures;
}

async function requireDisposablePhase20() {
  // This harness creates synthetic payroll runs and marks them Released for
  // ANNUALIZATION ONLY. Never allow it to touch a developer/customer database.
  for (const [name, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    GOLDEN_PHASE20_DISPOSABLE: "github-actions-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(process.env[name], expected, "PHASE20_REFUSED: unsafe " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
  ]) {
    assert.ok(!process.env[name], "PHASE20_REFUSED: provider credential " + name);
  }
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "PHASE20_REFUSED: PG16 required");
  const { rows: [count] } = await pool.query("SELECT COUNT(*)::int AS n FROM organizations");
  assert.equal(count.n, 0, "PHASE20_REFUSED: database must contain no employers");
}

async function runScenario(name: string, scenario: Scenario, specs: Array<[string, Spec]>) {
  const results: CaseResult[] = [];
  const [org] = await db.insert(organizations).values({ name: `Golden P20 ${name}`, legalName: `Golden P20 ${name} Inc.`, plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>(specs.map(([id]) => [id, []]));
  const fail = (id: string, message: string) => failuresById.get(id)!.push(message);
  try {
    const hired = new Map<string, typeof employees.$inferSelect>();
    for (const [id, spec] of specs) hired.set(id, await hire(org.id, id, spec));
    const workers = new Map<string, number>([...hired].map(([id, employee]) => [id, employee.id]));
    const idByEmployee = new Map<number, string>([...hired].map(([id, employee]) => [employee.id, id]));
    for (const [id, spec] of specs) {
      if (!spec.imported) continue;
      const employee = hired.get(id)!;
      for (let month = 1; month <= 6; month++) {
        const payDate = `${TAX_YEAR}-${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`;
        // The previous provider paid any 13th month in its June row; the amount is exempt, so contributions and tax stay ordinary.
        const thirteenth = month === 6 ? spec.imported.thirteenthMonth : 0;
        const gross = spec.monthlySalary + thirteenth;
        const contributions = spec.mwe
          ? { sss: 850, philHealth: 425, pagIbig: 200, withholding: 0 }
          : SSS_PHIC_HDMF_NON_MWE;
        await db.insert(historicalPayrollEntries).values({
          organizationId: org.id, employeeId: employee.id, sourceSystem: SOURCE_SYSTEM, sourceReference: `P20-${id}-${month}`, periodLabel: `Previous provider ${payDate}`, payDate,
          grossPay: gross.toFixed(2), basicSalary: spec.monthlySalary.toFixed(2),
          netPay: (gross - contributions.sss - contributions.philHealth - contributions.pagIbig - contributions.withholding).toFixed(2), taxWithheld: contributions.withholding.toFixed(2),
          sssEmployee: contributions.sss.toFixed(2), philHealthEmployee: contributions.philHealth.toFixed(2), pagIbigEmployee: contributions.pagIbig.toFixed(2),
          thirteenthMonth: thirteenth.toFixed(2),
          ...(spec.imported.unreadableMonth === month ? {} : { deMinimisBreakdown: {} }),
        });
      }
    }
    const observed = new Map<string, Map<number, Slip>>(specs.map(([id]) => [id, new Map()]));
    for (let cutoff = 13; cutoff <= 24; cutoff++) {
      const perWorker = await runCutoff(org.id, cutoff, workers, specs, idByEmployee);
      for (const [id, slip] of perWorker) observed.get(id)!.set(cutoff, slip);
    }
    for (const [id, spec] of specs) for (const message of checkCutoffs(id, spec, observed.get(id)!)) fail(id, message);

    const actualYearEnd = new Map<string, unknown>();
    if (scenario.yearEnd === "skip" || scenario.yearEnd === "annualize") {
      const summary = await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase20");
      const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
      for (const [id, spec] of specs) {
        const row = adjustments.find((item) => item.employeeId === workers.get(id)!);
        if (spec.skippedAtYearEnd) {
          if (row) fail(id, "a skipped worker must have no year-end adjustment row (no refund, collection or payroll line)");
          continue;
        }
        if (!row) { fail(id, "no year-end adjustment row"); continue; }
        const actual = {
          grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
          statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
          taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
        };
        actualYearEnd.set(id, actual);
        if (spec.yearEnd) for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
      }
      // Skipped workers are reported (never silently dropped) and must not count as annualized employees.
      const expectedSkipped = (scenario.yearEnd === "skip" ? scenario.skipped ?? [] : []).map((id) => workers.get(id)!).sort();
      const reported = summary.skippedEmployees.map((item) => item.employeeId).sort();
      const failures: string[] = [];
      if (JSON.stringify(reported) !== JSON.stringify(expectedSkipped)) failures.push(`${name}: expected skipped workers ${JSON.stringify(expectedSkipped)}, summary reported ${JSON.stringify(reported)}`);
      if (scenario.yearEnd === "skip" && !summary.skippedEmployees.every((item) => item.message.includes(scenario.skipMessage!))) failures.push(`${name}: skip reason must contain "${scenario.skipMessage}"`);
      if (summary.employees !== adjustments.length) failures.push(`${name}: summary counted ${summary.employees} employees but ${adjustments.length} adjustment rows exist`);
      if (scenario.yearEnd === "skip") {
        const audit = await pool.query("SELECT metadata FROM audit_events WHERE organization_id = $1 AND action = 'Year-end annualization computed' ORDER BY id DESC LIMIT 1", [org.id]);
        const meta = audit.rows[0]?.metadata as { skippedEmployees?: number; skippedEmployeeIds?: number[] } | undefined;
        if (meta?.skippedEmployees !== expectedSkipped.length || JSON.stringify([...(meta?.skippedEmployeeIds ?? [])].sort()) !== JSON.stringify(expectedSkipped)) {
          failures.push(`${name}: the audit event must record the skipped workers, got ${JSON.stringify(meta)}`);
        }
      }
      if (scenario.yearEnd === "skip") {
        results.push(outcome(`${name}:yearEndSkipReported`, "engine", { skippedEmployeeIds: expectedSkipped, adjustmentRows: specs.length - expectedSkipped.length }, { skippedEmployeeIds: reported, adjustmentRows: adjustments.length }, failures));
      } else if (failures.length) {
        for (const message of failures) fail(specs[0][0], message);
      }
    }
    for (const [id, spec] of specs) {
      results.push(outcome(id, "engine", { cutoff23: spec.cutoffs["23"] ?? spec.steadyCutoff, yearEnd: spec.yearEnd ?? null },
        { cutoff13: observed.get(id)!.get(13), cutoff23: observed.get(id)!.get(23), cutoff24: observed.get(id)!.get(24), yearEnd: actualYearEnd.get(id) ?? null },
        failuresById.get(id)!));
    }
  } finally {
    await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  for (const [name, scenario] of Object.entries(catalog.scenarios)) {
    const specs = Object.entries(catalog.employees).filter(([, spec]) => spec.scenario === name);
    assert.ok(specs.length > 0, `scenario ${name} has no workers`);
    results.push(...await runScenario(name, scenario, specs));
  }
  const unassigned = Object.entries(catalog.employees).filter(([, spec]) => !(spec.scenario in catalog.scenarios));
  assert.equal(unassigned.length, 0, "every worker must belong to a declared scenario");
  return results;
}

async function main() {
  await requireDisposablePhase20();
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 20 compares exact centavos");
  assert.ok(catalog.limitations.length > 0, "Phase 20 must document what it does not certify");
  const results = await runEngine(catalog);
  const failures = results.flatMap((result) => result.failures);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    phase: "golden-payroll-phase20", catalogVersion: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length, results,
  }, null, 2));
  for (const result of results) console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
  if (failures.length) {
    for (const message of failures) console.error(`  ${message}`);
    throw new Error(`Golden payroll Phase 20 failed: ${failures.length} mismatch(es).`);
  }
  console.log(`Golden payroll Phase 20: ${results.length}/${results.length} cases passed.`);
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
