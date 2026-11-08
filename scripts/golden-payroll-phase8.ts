/**
 * Golden payroll certification, Phase 8: statutory contributions for daily-paid and hourly-paid workers.
 * Phases 1-6 certify contributions only for monthly-salaried employees. Runs the real payroll engine against a
 * disposable database and compares every value to immutable literals in certification/golden-payroll-phase8.json.
 * Expected values are never computed with PayrollPH functions.
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
  cases: Record<string, { description: string; payBasis: "daily" | "hourly"; rate: number; workedDays: number; expected: Record<string, number> }>;
  limitations: string[];
};
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type Entry = typeof payrollEntries.$inferSelect;

const catalogPath = "certification/golden-payroll-phase8.json";
const artifactPath = "qa-artifacts/golden-payroll-phase8-reconciliation.json";
const SEPTEMBER = { periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15" };
// Sep 1-4, 7-11 and 14, as in Phase 5; a case with fewer worked days uses the first N of these.
const WORK_DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"];

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
  return typeof raw === "string" ? Number(raw.slice(key.length + 1)) : Number.NaN;
}
/** What the employee sees must add up to the stored centavos. */
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

async function addEmployee(organizationId: number, employeeNo: string, payBasis: "daily" | "hourly", rate: number) {
  const monthlyEquivalent = payBasis === "daily" ? rate * 22 : rate * 8 * 22;
  const [employee] = await db.insert(employees).values({
    organizationId, employeeNo, firstName: "Golden", lastName: employeeNo, title: "Certification Employee", avatarInitials: "GP",
    basicRate: monthlyEquivalent.toFixed(2), startDate: "2026-01-01", restDay: null, region: "NCR",
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId, payBasis, rateAmount: rate.toFixed(2), standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
/** One complete 09:00-18:00 punch with a punched 12:00-13:00 break per worked date. */
async function punches(organizationId: number, employeeId: number, days: number) {
  assert.ok(days >= 1 && days <= WORK_DATES.length, "workedDays must be 1-10");
  await db.insert(timePunches).values(WORK_DATES.slice(0, days).map((workDate) => ({
    organizationId, employeeId, workDate, shiftStart: "09:00", shiftEnd: "18:00", status: "Complete",
    timeIn: at(workDate, "09:00"), timeOut: at(workDate, "18:00"), breakStart: at(workDate, "12:00"), breakEnd: at(workDate, "13:00"),
  })));
}

async function calculate(organizationId: number, label: string) {
  const [run] = await db.insert(payrollRuns).values({ organizationId, periodLabel: label, scopeLabel: "All locations", status: "Draft", ...SEPTEMBER }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, 1, `Expected one payroll entry for run #${run.id}`);
  return rows[0];
}

function actualOf(entry: Entry) {
  return {
    grossPay: Number(entry.grossPay),
    sss: Math.abs(lineAmount(entry, "SSS")),
    philHealth: Math.abs(lineAmount(entry, "PHIC")),
    pagIbig: Math.abs(lineAmount(entry, "HDMF")),
    taxableCompensation: traceNumber(entry, "taxableCompensation"),
    withholdingTax: Math.abs(lineAmount(entry, "WHT")),
    deductions: Number(entry.deductions),
    netPay: Number(entry.netPay),
    sssEmployer: traceNumber(entry, "sssEmployerCutoff"),
    ecEmployer: traceNumber(entry, "sssEmployerEcCutoff"),
    philHealthEmployer: traceNumber(entry, "philHealthEmployerCutoff"),
    pagIbigEmployer: traceNumber(entry, "pagIbigEmployerCutoff"),
  };
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 8 compares exact centavos");
  const results: Array<{ id: string; status: "passed" | "failed"; expected: Record<string, number>; actual?: Record<string, number>; failures: string[] }> = [];
  for (const [id, { expected, payBasis, rate, workedDays }] of Object.entries(catalog.cases)) {
    const failures: string[] = [];
    let actual: Record<string, number> | undefined;
    try {
      const entry = await withOrg(`Golden P8 ${id}`, async (org) => {
        const worker = await addEmployee(org, `P8-${id.slice(0, 12)}`, payBasis, rate);
        await punches(org, worker.id, workedDays);
        return calculate(org, `Phase 8 ${id}`);
      });
      actual = actualOf(entry);
      assertPayslipReconciles(entry, id);
      for (const [key, value] of Object.entries(expected)) {
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
