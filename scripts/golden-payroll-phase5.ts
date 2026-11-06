/**
 * Golden payroll certification, Phase 5: attendance-driven pay the earlier phases do not exercise
 * (daily-rated basic from punches, monthly tardiness/undertime and the grace boundary).
 * Runs the real payroll engine against a disposable database and compares every value to immutable literals in
 * certification/golden-payroll-phase5.json. Expected values are never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollRuns, timePunches } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";

type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  cases: Record<string, { description: string; expected: Record<string, number>; knownFinding?: { summary: string; currentEngine: Record<string, number> } }>;
  limitations: string[];
};
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type Entry = typeof payrollEntries.$inferSelect;

const catalogPath = "certification/golden-payroll-phase5.json";
const artifactPath = "qa-artifacts/golden-payroll-phase5-reconciliation.json";
const SEPTEMBER = { periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15" };

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
  const value = typeof raw === "string" ? Number(raw.slice(key.length + 1)) : Number.NaN;
  return value;
}
/**
 * What the employee sees must add up to the stored centavos. Lines are bucketed by the shared payslip classifier
 * (economic bucket, not sign), so a year-end refund prints as a deduction credit and reconciles to stored deductions.
 */
function assertPayslipReconciles(entry: Entry, label: string) {
  const items = lines(entry);
  assert.ok(items.length > 0, `${label}: a calculated payslip must contain line items`);
  const totals = payslipSectionTotals(items);
  const gross = cents(Number(entry.grossPay), label), deductions = cents(Number(entry.deductions), label), net = cents(Number(entry.netPay), label);
  assert.equal(cents(totals.earnings, label), gross, `${label}: printed earnings differ from stored gross`);
  assert.equal(cents(totals.deductions, label), deductions, `${label}: printed deductions differ from stored deductions`);
  assert.equal(gross - deductions, net, `${label}: gross - deductions differs from stored net`);
}

async function withOrg<T>(name: string, body: (orgId: number) => Promise<T>) {
  const [org] = await db.insert(organizations).values({ name, legalName: `${name} Inc.`, plan: "Core", statutoryDeductionTiming: "split" }).returning();
  try {
    return await body(org.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function addEmployee(organizationId: number, employeeNo: string, payBasis: "monthly" | "daily", rate: number) {
  const [employee] = await db.insert(employees).values({
    organizationId, employeeNo, firstName: "Golden", lastName: employeeNo, title: "Certification Employee", avatarInitials: "GP",
    basicRate: (payBasis === "daily" ? rate * 22 : rate).toFixed(2), startDate: "2026-01-01", restDay: null, region: "NCR",
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId, payBasis, rateAmount: rate.toFixed(2), standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

const WORK_DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"];
const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
type Day = { in?: string; out?: string; noBreak?: boolean };
/** One punch per work date, 09:00-18:00 with a punched 12:00-13:00 break unless overridden. */
async function punches(organizationId: number, employeeId: number, overrides: Record<string, Day> = {}) {
  await db.insert(timePunches).values(WORK_DATES.map((workDate) => {
    const day = overrides[workDate] ?? {};
    return {
      organizationId, employeeId, workDate, shiftStart: "09:00", shiftEnd: "18:00", status: "Complete",
      timeIn: at(workDate, day.in ?? "09:00"), timeOut: at(workDate, day.out ?? "18:00"),
      breakStart: day.noBreak ? null : at(workDate, "12:00"), breakEnd: day.noBreak ? null : at(workDate, "13:00"),
    };
  }));
}

async function createRun(organizationId: number, label: string, period: typeof SEPTEMBER) {
  const [run] = await db.insert(payrollRuns).values({ organizationId, periodLabel: label, scopeLabel: "All locations", status: "Draft", ...period }).returning();
  return run;
}

async function calculate(runId: number) {
  await enqueuePayrollRun(runId, 25);
  await drainPayrollQueue(10, runId);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));
  assert.equal(rows.length, 1, `Expected one payroll entry for run #${runId}`);
  return rows[0];
}

function actualOf(entry: Entry) {
  return {
    basicPay: lineAmount(entry, "BASIC"),
    tardinessDeduction: Math.abs(lineAmount(entry, "LATE")),
    undertimeDeduction: Math.abs(lineAmount(entry, "UT")),
    grossPay: Number(entry.grossPay),
    regularMinutes: traceNumber(entry, "regularMinutes"),
    tardinessMinutes: traceNumber(entry, "tardinessMinutes"),
    undertimeMinutes: traceNumber(entry, "undertimeMinutes"),
  };
}

const runners: Record<string, () => Promise<{ entry: Entry; checks?: (entry: Entry) => void }>> = {
  dailyFullAttendance: () => withOrg("Golden P5 Daily Full", async (org) => {
    const e = await addEmployee(org, "P5-D1", "daily", 800);
    await punches(org, e.id);
    return { entry: await calculate((await createRun(org, "Daily full attendance", SEPTEMBER)).id) };
  }),
  dailyLateArrivalNoDock: () => withOrg("Golden P5 Daily Late", async (org) => {
    const e = await addEmployee(org, "P5-D2", "daily", 800);
    await punches(org, e.id, { "2026-09-14": { in: "09:45" } });
    return { entry: await calculate((await createRun(org, "Daily late arrival", SEPTEMBER)).id) };
  }),
  dailyHalfDayNoBreak: () => withOrg("Golden P5 Daily Half", async (org) => {
    const e = await addEmployee(org, "P5-D3", "daily", 800);
    await punches(org, e.id, { "2026-09-14": { out: "13:00", noBreak: true } });
    return { entry: await calculate((await createRun(org, "Daily half day", SEPTEMBER)).id) };
  }),
  monthlyTardinessUndertime: () => withOrg("Golden P5 Monthly Late", async (org) => {
    const e = await addEmployee(org, "P5-M1", "monthly", 30000);
    await punches(org, e.id, { "2026-09-09": { in: "09:45" }, "2026-09-10": { out: "17:30" } });
    return { entry: await calculate((await createRun(org, "Monthly tardiness and undertime", SEPTEMBER)).id) };
  }),
  monthlyGraceBoundary: () => withOrg("Golden P5 Monthly Grace", async (org) => {
    const e = await addEmployee(org, "P5-M2", "monthly", 30000);
    await punches(org, e.id, { "2026-09-09": { in: "09:05" }, "2026-09-10": { in: "09:06" } });
    return { entry: await calculate((await createRun(org, "Monthly grace boundary", SEPTEMBER)).id) };
  }),
};

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 5 compares exact centavos");
  assert.deepEqual(Object.keys(catalog.cases).sort(), Object.keys(runners).sort(), "every catalog case has a runner and every runner a catalog case");
  const results: Array<{ id: string; status: "passed" | "failed"; expected: Record<string, number>; actual?: Record<string, number>; failures: string[] }> = [];
  for (const [id, { expected, knownFinding }] of Object.entries(catalog.cases)) {
    const failures: string[] = [];
    let actual: Record<string, number> | undefined;
    try {
      const { entry, checks } = await runners[id]();
      actual = actualOf(entry);
      assertPayslipReconciles(entry, id);
      checks?.(entry);
      if (knownFinding) {
        // A documented finding: pin the current engine values exactly, and fail loudly once they reach the lawful
        // expectation so the catalog is updated together with the fix.
        const engine = actual;
        for (const [key, value] of Object.entries(knownFinding.currentEngine)) {
          if (cents(engine[key as keyof typeof engine], id) !== cents(value, id)) failures.push(`${key}: known-finding value ₱${value.toFixed(2)} changed to ₱${Number(engine[key as keyof typeof engine]).toFixed(2)}`);
        }
        const fixed = Object.keys(knownFinding.currentEngine).every((key) => cents(engine[key as keyof typeof engine], id) === cents(expected[key], id));
        if (fixed) failures.push("known finding now matches the lawful expectation: remove knownFinding and assert the expected values");
      }
      for (const [key, value] of Object.entries(expected)) {
        if (knownFinding && key in knownFinding.currentEngine) continue;
        assert.ok(key in actual, `${id}: unknown expected key ${key}`);
        const got = actual[key as keyof typeof actual];
        if (!Number.isFinite(got) || cents(got, id) !== cents(value, id)) failures.push(`${key}: expected ₱${value.toFixed(2)}, got ₱${Number(got).toFixed(2)}`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    results.push({ id, status: failures.length ? "failed" : "passed", expected, actual, failures });
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
