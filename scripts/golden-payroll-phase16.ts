/**
 * Golden payroll certification, Phase 16: a hire that starts INSIDE a cutoff.
 * Phase 9 certified a mid-year hire on a cutoff boundary. This phase runs the real engine for cutoffs 13-24 for two workers
 * hired on 2026-07-09 (mid-cutoff) and 2026-07-16 (first day of the second cutoff) and checks, per payslip, the earned
 * fraction of the salary, the provisional first-cutoff and month-final true-up statutory deductions, the withholding and the
 * net pay, then that the real runYearEndAnnualization() refunds exactly what was over-withheld. Every expected value is an
 * immutable hand-derived literal in certification/golden-payroll-phase16.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type Slip = { grossPay: number; sss: number; philHealth: number; pagIbig: number; withholding: number; netPay: number; status: string };
type Spec = {
  description: string; startDate: string; firstCutoff: number; cutoffs: Record<string, Slip>; steadyFromCutoff: number; yearEnd: Money;
};
type Catalog = {
  version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[];
  employees: Record<string, Spec>; steadyCutoff: Slip; limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase16.json";
const artifactPath = "qa-artifacts/golden-payroll-phase16-reconciliation.json";
const TAX_YEAR = 2026;
const MONTHLY_SALARY = 30000;
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
    label: `Phase 16 cutoff ${cutoff}`,
  };
}

const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string, startDate: string) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P16-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: MONTHLY_SALARY.toFixed(2), mwe: false, region: "NCR", startDate,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: MONTHLY_SALARY.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
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

async function runCutoff(orgId: number, cutoff: number, employeeIds: Map<number, string>, expectedIds: Set<string>) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  const seenIds = new Set<string>();
  const observed = new Map<string, Slip>();
  for (const row of rows) {
    const key = employeeIds.get(row.employeeId);
    assert.ok(key, `cutoff ${cutoff}: unknown employee ${row.employeeId}`);
    seenIds.add(key);
    const items = row.lineItems as Array<{ code?: string; amount?: string | number }>;
    observed.set(key, {
      grossPay: Number(row.grossPay),
      sss: deductionLine(key, cutoff, items, "SSS", false),
      philHealth: deductionLine(key, cutoff, items, "PHIC", false),
      pagIbig: deductionLine(key, cutoff, items, "HDMF", false),
      withholding: deductionLine(key, cutoff, items, "WHT", true),
      netPay: Number(row.netPay),
      status: row.status,
    });
  }
  assert.deepEqual([...seenIds].sort(), [...expectedIds].sort(), `cutoff ${cutoff}: employees on the run differ from those employed`);
  // The year-end annualization reads Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
  return observed;
}

function expectedSlip(catalog: Catalog, spec: Spec, cutoff: number): Slip | null {
  if (cutoff < spec.firstCutoff) return null;
  return spec.cutoffs[String(cutoff)] ?? (cutoff >= spec.steadyFromCutoff ? catalog.steadyCutoff : null);
}

function checkCutoffs(catalog: Catalog, id: string, spec: Spec, byCutoff: Map<number, Slip>) {
  const failures: string[] = [];
  for (let cutoff = 13; cutoff <= 24; cutoff++) {
    const want = expectedSlip(catalog, spec, cutoff);
    const seen = byCutoff.get(cutoff);
    if (!want) { if (seen) failures.push(`${id} cutoff ${cutoff}: has a payslip before the start date`); continue; }
    if (!seen) { failures.push(`${id} cutoff ${cutoff}: not observed`); continue; }
    for (const key of ["grossPay", "sss", "philHealth", "pagIbig", "withholding", "netPay"] as const) {
      if (cents(seen[key], id) !== cents(want[key], id)) failures.push(`${id} cutoff ${cutoff} ${key}: expected ₱${want[key].toFixed(2)}, got ₱${seen[key].toFixed(2)}`);
    }
    if (seen.status !== want.status) failures.push(`${id} cutoff ${cutoff} status: expected ${want.status}, got ${seen.status}`);
  }
  return failures;
}

async function requireDisposablePhase16() {
  // This harness creates synthetic payroll runs and marks them Released for
  // ANNUALIZATION ONLY. Never allow it to touch a developer/customer database.
  for (const [name, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    GOLDEN_PHASE16_DISPOSABLE: "github-actions-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(process.env[name], expected, "PHASE16_REFUSED: unsafe " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
  ]) {
    assert.ok(!process.env[name], "PHASE16_REFUSED: provider credential " + name);
  }
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "PHASE16_REFUSED: PG16 required");
  const { rows: [count] } = await pool.query("SELECT COUNT(*)::int AS n FROM organizations");
  assert.equal(count.n, 0, "PHASE16_REFUSED: database must contain no employers");
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P16 mid-cutoff hires", legalName: "Golden P16 mid-cutoff hires Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const workers = new Map<string, typeof employees.$inferSelect>();
    for (const [id, spec] of specs) workers.set(id, await hire(org.id, id, spec.startDate));
    const idByEmployee = new Map<number, string>([...workers].map(([id, employee]) => [employee.id, id]));
    const observed = new Map<string, Map<number, Slip>>(specs.map(([id]) => [id, new Map()]));
    for (let cutoff = 13; cutoff <= 24; cutoff++) {
      const employed = new Set(specs.filter(([, spec]) => cutoff >= spec.firstCutoff).map(([id]) => id));
      const perWorker = await runCutoff(org.id, cutoff, idByEmployee, employed);
      for (const [id, slip] of perWorker) observed.get(id)!.set(cutoff, slip);
    }
    for (const [id, spec] of specs) for (const message of checkCutoffs(catalog, id, spec, observed.get(id)!)) fail(id, message);

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase16");
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
        { firstCutoff: observed.get(id)!.get(spec.firstCutoff), nextCutoff: observed.get(id)!.get(spec.firstCutoff + 1), taxDue: row ? Number(row.taxDue) : undefined, adjustment: row ? Number(row.adjustment) : undefined },
        failuresById.get(id) ?? []));
    }
  } finally {
    await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  await requireDisposablePhase16();
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 16 compares exact centavos");
  assert.ok(catalog.limitations.length > 0, "Phase 16 must document what it does not certify");
  const results = await runEngine(catalog);
  const failures = results.flatMap((result) => result.failures);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    phase: "golden-payroll-phase16", catalogVersion: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length, results,
  }, null, 2));
  for (const result of results) console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
  if (failures.length) {
    for (const message of failures) console.error(`  ${message}`);
    throw new Error(`Golden payroll Phase 16 failed: ${failures.length} mismatch(es).`);
  }
  console.log(`Golden payroll Phase 16: ${results.length}/${results.length} cases passed.`);
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
