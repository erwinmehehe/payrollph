/**
 * Golden Payroll Phase 39: independent centavo proof of two effective-dated daily/hourly rate
 * changes per cutoff, overtime at three historical rates, rate decreases and stored-future revisions.
 * Real queued payroll engine, fictional punches, empty disposable PG16 only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employeePayRevisions, employees, organizations, overtimeRequests, payrollEntries, payrollRuns, timePunches } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";

type PayBasis = "daily" | "hourly";
type Money = Record<string, number>;
type PayChange = { effectiveDate: string; newRate: number; recordedBeforeCutoff: number };
type Overtime = { date: string; minutes: number };
type Spec = { description: string; payBasis: PayBasis; rate: number; changes?: PayChange[]; overtime?: Overtime[]; cutoffs: Money[] };
type Catalog = {
  version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[];
  employees: Record<string, Spec>; limitations: string[];
};
type Entry = typeof payrollEntries.$inferSelect;
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase39.json";
const artifactPath = "qa-artifacts/golden-payroll-phase39-reconciliation.json";
// Cutoff 1: Sep 1-15 (Sep 1-4, 7-11 and 14); cutoff 2: Sep 16-30 (Sep 16-18, 21-25 and 28-30). 2026-09-01 is a Tuesday.
const CUTOFFS = [
  { periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15", workDates: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"] },
  { periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-09-30", workDates: ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"] },
];

const cents = (value: number, label: string) => {
  assert.ok(Number.isFinite(value), `${label}: non-finite amount`);
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), `${label}: unsafe centavo amount`);
  return result;
};
const lines = (entry: Entry) => (Array.isArray(entry.lineItems) ? entry.lineItems as PayrollLine[] : []);
const lineAmount = (entry: Entry, code: string) => Number(lines(entry).find((item) => String(item.code ?? "") === code)?.amount ?? 0);
const monthlyEquivalent = (payBasis: PayBasis, rate: number) => (payBasis === "daily" ? rate * 22 : rate * 8 * 22);

function compare(id: string, expected: Money, actual: Record<string, number>) {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(key in actual, `${id}: unknown expected key ${key}`);
    const got = actual[key];
    if (!Number.isFinite(got) || cents(got, id) !== cents(value, id)) failures.push(`${id} ${key}: expected ₱${value.toFixed(2)}, got ₱${Number(got).toFixed(2)}`);
  }
  return failures;
}

/** What the employee sees must add up to the stored centavos. */
function payslipFailure(entry: Entry, label: string) {
  const items = lines(entry);
  if (items.length === 0) return `${label}: a calculated payslip must contain line items`;
  const totals = payslipSectionTotals(items);
  const gross = cents(Number(entry.grossPay), label), deductions = cents(Number(entry.deductions), label), net = cents(Number(entry.netPay), label);
  if (cents(totals.earnings, label) !== gross) return `${label}: printed earnings differ from stored gross`;
  if (cents(totals.deductions, label) !== deductions) return `${label}: printed deductions differ from stored deductions`;
  if (gross - deductions !== net) return `${label}: gross - deductions differs from stored net`;
  return null;
}

function actualOf(entry: Entry): Money {
  return {
    grossPay: Number(entry.grossPay),
    sss: Math.abs(lineAmount(entry, "SSS")),
    philHealth: Math.abs(lineAmount(entry, "PHIC")),
    pagIbig: Math.abs(lineAmount(entry, "HDMF")),
    withholdingTax: Math.abs(lineAmount(entry, "WHT")),
    netPay: Number(entry.netPay),
  };
}

async function addWorker(orgId: number, id: string, spec: Spec, ordinal: number) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P39-${String(ordinal).padStart(2, "0")}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: monthlyEquivalent(spec.payBasis, spec.rate).toFixed(2), startDate: "2026-01-01", restDay: null, region: "NCR",
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: spec.payBasis, rateAmount: spec.rate.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
/** One complete 09:00-18:00 punch with a punched 12:00-13:00 break per worked date (8 paid hours). A date with approved overtime is
 * punched out that many minutes after 18:00 and has an approved overtime request for the same minutes. */
async function punch(orgId: number, employeeId: number, workDates: string[], overtime: Overtime[] = []) {
  const extra = new Map(overtime.map((item) => [item.date, item.minutes]));
  for (const date of extra.keys()) assert.ok(workDates.includes(date), `overtime on ${date} must be on a worked date`);
  await db.insert(timePunches).values(workDates.map((workDate) => {
    const minutes = extra.get(workDate) ?? 0, out = new Date(at(workDate, "18:00").getTime() + minutes * 60_000);
    return {
      organizationId: orgId, employeeId, workDate, shiftStart: "09:00", shiftEnd: "18:00", status: "Complete",
      timeIn: at(workDate, "09:00"), timeOut: out, breakStart: at(workDate, "12:00"), breakEnd: at(workDate, "13:00"),
    };
  }));
  for (const [workDate, minutes] of extra) {
    await db.insert(overtimeRequests).values({
      organizationId: orgId, employeeId, workDate, requestedMinutes: minutes, reason: "Golden certification overtime",
      requestKind: "pre_approved", status: "approved", requestedBy: "Golden certification", decidedBy: "Golden certification",
      decidedAt: at(workDate, "08:00"), decisionNote: "Approved golden case",
    });
  }
}

/** Mirror the employee API's pay-revision row and its immediate stored-rate updates; no route claims. */
async function recordPayChange(orgId: number, employeeId: number, spec: Spec, change: PayChange, previousRate: number) {
  const row = (rate: number) => rate.toFixed(2);
  await db.insert(employeePayRevisions).values({
    employeeId, organizationId: orgId, effectiveDate: change.effectiveDate,
    previousPayBasis: spec.payBasis, previousRateAmount: row(previousRate), previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00",
    newPayBasis: spec.payBasis, newRateAmount: row(change.newRate), newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00",
    reason: "Golden Phase 39 rate change", createdBy: "Golden certification",
  });
  await db.update(employeePayProfiles).set({ rateAmount: row(change.newRate) }).where(eq(employeePayProfiles.employeeId, employeeId));
  await db.update(employees).set({ basicRate: monthlyEquivalent(spec.payBasis, change.newRate).toFixed(2) }).where(eq(employees.id, employeeId));
}

async function requireDisposablePhase39() {
  // This harness creates synthetic payroll runs and marks them Released so the second cutoff reads the first.
  // Never allow it to touch a developer/customer database.
  for (const [name, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    GOLDEN_PHASE39_DISPOSABLE: "github-actions-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(process.env[name], expected, "PHASE39_REFUSED: unsafe " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
  ]) {
    assert.ok(!process.env[name], "PHASE39_REFUSED: provider credential " + name);
  }
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "PHASE39_REFUSED: PG16 required");
  const { rows: [count] } = await pool.query("SELECT COUNT(*)::int AS n FROM organizations");
  assert.equal(count.n, 0, "PHASE39_REFUSED: database must contain no employers");
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P39 daily hourly raise", legalName: "Golden P39 daily hourly raise Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const actualById = new Map<string, Money[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const workers = new Map<string, number>();
    for (const [ordinal, [id, spec]] of specs.entries()) {
      assert.equal(spec.cutoffs.length, CUTOFFS.length, `${id}: the catalog must give both cutoffs`);
      for (const [index, change] of (spec.changes ?? []).entries()) {
        assert.ok(change.newRate > 0 && Number.isFinite(change.newRate), `${id}: invalid rate`);
        assert.ok(change.recordedBeforeCutoff === 1 || change.recordedBeforeCutoff === 2, `${id}: invalid recorded cutoff`);
        if (index > 0) {
          const prior = spec.changes![index - 1];
          assert.ok(change.effectiveDate > prior.effectiveDate, `${id}: changes must be chronological`);
          assert.ok(change.recordedBeforeCutoff >= prior.recordedBeforeCutoff, `${id}: recording order must not go backwards`);
        }
      }
      workers.set(id, (await addWorker(org.id, id, spec, ordinal + 1)).id);
    }
    for (const [index, cutoff] of CUTOFFS.entries()) {
      const number = index + 1;
      // Changes are recorded in chronological order before the configured cutoff.
      for (const [id, spec] of specs) {
        for (const [index, change] of (spec.changes ?? []).entries()) {
          if (change.recordedBeforeCutoff !== number) continue;
          const previousRate = index === 0 ? spec.rate : spec.changes![index - 1].newRate;
          await recordPayChange(org.id, workers.get(id)!, spec, change, previousRate);
        }
      }
      for (const [id, spec] of specs) await punch(org.id, workers.get(id)!, cutoff.workDates, (spec.overtime ?? []).filter((item) => cutoff.workDates.includes(item.date)));
      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id, periodLabel: `Phase 39 cutoff ${number}`, scopeLabel: "All locations", status: "Draft",
        periodStart: cutoff.periodStart, periodEnd: cutoff.periodEnd, payDate: cutoff.payDate,
      }).returning();
      await enqueuePayrollRun(run.id, 25);
      await drainPayrollQueue(10, run.id);
      const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      assert.equal(rows.length, specs.length, `cutoff ${number}: expected ${specs.length} payroll entries, got ${rows.length}`);
      for (const [id, spec] of specs) {
        const row = rows.find((item) => item.employeeId === workers.get(id));
        assert.ok(row, `cutoff ${number}: no payroll entry for ${id}`);
        const flags = ((row.trace as { flags?: unknown } | null)?.flags ?? []) as unknown[];
        if (row.status !== "Ready") fail(id, `cutoff ${number} ${id}: payroll entry must calculate without exceptions (${row.status}: ${JSON.stringify(flags)})`);
        const actual = actualOf(row);
        actualById.set(id, [...(actualById.get(id) ?? []), actual]);
        for (const message of compare(`${id} cutoff ${number}`, spec.cutoffs[index], actual)) fail(id, message);
        const broken = payslipFailure(row, `${id} cutoff ${number}`);
        if (broken) fail(id, broken);
      }
      // The second cutoff reads the first as the month's statutory ledger; the release approval workflow is not part of this certification.
      await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
    }
    for (const [id, spec] of specs) {
      results.push({ id, part: "engine", status: (failuresById.get(id) ?? []).length ? "failed" : "passed", expected: spec.cutoffs, actual: actualById.get(id), failures: failuresById.get(id) ?? [] });
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  await requireDisposablePhase39();
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 39 compares exact centavos");
  assert.equal(Object.keys(catalog.employees).length, 8, "Phase 39 must contain exactly eight literal cases");
  assert.ok(catalog.limitations.length > 0, "Phase 39 must document what it does not certify");
  const results = await runEngine(catalog);
  const failures = results.flatMap((result) => result.failures);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    phase: "golden-payroll-phase39", catalogVersion: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length, results,
  }, null, 2));
  for (const result of results) console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
  if (failures.length) {
    for (const message of failures) console.error(`  ${message}`);
    throw new Error(`Golden payroll Phase 39 failed: ${failures.length} mismatch(es).`);
  }
  console.log(`Golden payroll Phase 39: ${results.length}/${results.length} cases passed.`);
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
