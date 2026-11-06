/**
 * Golden payroll certification, Phase 6: statutory edges the earlier phases step over
 * (SSS EC threshold and MSC cap, PhilHealth floor, withholding-table bracket edges).
 * Runs the real payroll engine against a disposable database and compares every value to immutable literals in
 * certification/golden-payroll-phase6.json. Expected values are never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";

type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  cases: Record<string, { description: string; salary: number; expected: Record<string, number> }>;
  limitations: string[];
};
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type Entry = typeof payrollEntries.$inferSelect;

const catalogPath = "certification/golden-payroll-phase6.json";
const artifactPath = "qa-artifacts/golden-payroll-phase6-reconciliation.json";
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

async function addEmployee(organizationId: number, employeeNo: string, salary: number) {
  const [employee] = await db.insert(employees).values({
    organizationId, employeeNo, firstName: "Golden", lastName: employeeNo, title: "Certification Employee", avatarInitials: "GP",
    basicRate: salary.toFixed(2), startDate: "2026-01-01", restDay: null, region: "NCR",
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId, payBasis: "monthly", rateAmount: salary.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
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

/** One fresh disposable employer per case, one monthly-salaried employee, one first-cutoff run. */
async function runCase(id: string, salary: number): Promise<{ entry: Entry; checks?: (entry: Entry) => void }> {
  return withOrg(`Golden P6 ${id}`, async (org) => {
    await addEmployee(org, `P6-${id.slice(0, 12)}`, salary);
    return { entry: await calculate((await createRun(org, `Phase 6 ${id}`, SEPTEMBER)).id) };
  });
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 6 compares exact centavos");
  const results: Array<{ id: string; status: "passed" | "failed"; expected: Record<string, number>; actual?: Record<string, number>; failures: string[] }> = [];
  for (const [id, { expected, salary }] of Object.entries(catalog.cases)) {
    const failures: string[] = [];
    let actual: Record<string, number> | undefined;
    try {
      const { entry, checks } = await runCase(id, salary);
      actual = actualOf(entry);
      assertPayslipReconciles(entry, id);
      checks?.(entry);
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
