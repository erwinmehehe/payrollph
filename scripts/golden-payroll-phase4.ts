/**
 * Golden payroll certification, Phase 4: tax-classification paths the earlier phases do not exercise
 * (de minimis ceilings and the shared PHP 90,000 pool, leave monetization, year-end settlement, MWE).
 * Runs the real payroll engine against a disposable database and compares every value to immutable literals in
 * certification/golden-payroll-phase4.json. Expected values are never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  deMinimisGrants,
  employeeMweClassifications,
  employeePayProfiles,
  employees,
  leaveConversions,
  organizations,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
  yearEndAdjustments,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { payslipSectionTotals } from "../src/lib/payslip-line-buckets";

type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  cases: Record<string, { description: string; expected: Record<string, number>}>;
  limitations: string[];
};
type PayrollLine = { code?: string; label?: string; amount?: string | number };
type Entry = typeof payrollEntries.$inferSelect;

const catalogPath = "certification/golden-payroll-phase4.json";
const artifactPath = "qa-artifacts/golden-payroll-phase4-reconciliation.json";
const SEPTEMBER = { periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15" };
const DECEMBER = { periodStart: "2026-12-01", periodEnd: "2026-12-15", payDate: "2026-12-15" };

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
function traceText(entry: Entry, key: string) {
  const inputs = (entry.trace as { inputs?: unknown } | null)?.inputs;
  const raw = Array.isArray(inputs) ? inputs.find((item) => typeof item === "string" && item.startsWith(`${key}=`)) : undefined;
  return typeof raw === "string" ? raw.slice(key.length + 1) : null;
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
    deMinimisExempt: traceNumber(entry, "deMinimisExempt"),
    deMinimisOtherBenefitsPool: traceNumber(entry, "deMinimisOtherBenefitsPool"),
    benefitPoolTaxableCurrent: traceNumber(entry, "benefitPoolTaxableCurrent"),
    leaveConversionTaxExempt: traceNumber(entry, "leaveConversionTaxExempt"),
    yearEndTaxAdjustment: traceNumber(entry, "yearEndTaxAdjustment"),
  };
}

async function withOrg<T>(name: string, body: (orgId: number) => Promise<T>) {
  const [org] = await db.insert(organizations).values({ name, legalName: `${name} Inc.`, plan: "Core", statutoryDeductionTiming: "split" }).returning();
  try {
    return await body(org.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function addEmployee(organizationId: number, employeeNo: string, salary: number, standardDays = 22) {
  const [employee] = await db.insert(employees).values({
    organizationId, employeeNo, firstName: "Golden", lastName: employeeNo, title: "Certification Employee", avatarInitials: "GP",
    basicRate: salary.toFixed(2), startDate: "2026-01-01", restDay: null, region: "NCR",
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId, payBasis: "monthly", rateAmount: salary.toFixed(2),
    standardWorkDaysPerMonth: standardDays.toFixed(2), standardHoursPerDay: "8.00",
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

async function riceSubsidy(organizationId: number, employeeId: number, monthly: number) {
  await db.insert(deMinimisGrants).values({
    organizationId, employeeId, benefitType: "riceSubsidy", amount: monthly.toFixed(2), frequency: "month", effectiveOn: "2026-09-01",
  });
}

/** A released June payroll whose one line consumed the full PHP 90,000 13th-month/other-benefits pool. */
async function exhaustBenefitPool(organizationId: number, employeeId: number) {
  const [prior] = await db.insert(payrollRuns).values({
    organizationId, periodLabel: "Prior benefit evidence", periodStart: "2026-06-01", periodEnd: "2026-06-15", scopeLabel: "All locations",
    status: "Released", payDate: "2026-06-15", employeeCount: 1, grossPay: "90000.00", netPay: "90000.00",
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: prior.id, employeeId, grossPay: "90000.00", deductions: "0.00", netPay: "90000.00", status: "Ready", trace: {},
    lineItems: [{ code: "BONUS-PRIOR", label: "Prior bonus", amount: "90000.00", notes: ["Type: bonus"], benefitPool90k: true, benefitPoolKind: "bonus" }],
  });
}

async function leaveConversion(organizationId: number, employeeId: number, taxExempt: boolean) {
  await db.insert(leaveConversions).values({
    organizationId, employeeId, leaveType: "vacation", daysConverted: "5.0", dailyRate: "1363.64", cashAmount: "6818.20", taxExempt, status: "approved",
  });
}

async function yearEnd(organizationId: number, employeeId: number, payrollRunId: number, adjustment: number) {
  await db.insert(yearEndAdjustments).values({
    organizationId, employeeId, taxYear: 2026, grossCompensation: "360000.00", adjustment: adjustment.toFixed(2),
    outcome: adjustment < 0 ? "refund" : "payable", status: "approved", payrollRunId, approvedAt: new Date("2026-12-01T00:00:00Z"), approvedBy: "Golden certification",
  });
}

async function taxableAllowance(organizationId: number, employeeId: number) {
  await db.insert(supplementaryEarnings).values({
    organizationId, employeeId, earningType: "allowance", label: "Fictional taxable allowance", amount: "12000.00", taxable: true,
    includeInSssBase: false, includeInPagIbigBase: false, effectiveDate: "2026-09-10", status: "approved", createdBy: "Golden certification",
  });
}

const runners: Record<string, () => Promise<{ entry: Entry; checks?: (entry: Entry) => void }>> = {
  deMinimisWithinCeiling: () => withOrg("Golden P4 De Minimis Within", async (org) => {
    const e = await addEmployee(org, "P4-DM1", 30000);
    await riceSubsidy(org, e.id, 2000);
    return { entry: await calculate((await createRun(org, "De minimis within ceiling", SEPTEMBER)).id) };
  }),
  deMinimisExcessIntoPool: () => withOrg("Golden P4 De Minimis Pool", async (org) => {
    const e = await addEmployee(org, "P4-DM2", 30000);
    await riceSubsidy(org, e.id, 6000);
    return { entry: await calculate((await createRun(org, "De minimis excess into pool", SEPTEMBER)).id) };
  }),
  deMinimisExcessAfterExhaustedPool: () => withOrg("Golden P4 De Minimis Taxed", async (org) => {
    const e = await addEmployee(org, "P4-DM3", 30000);
    await exhaustBenefitPool(org, e.id);
    await riceSubsidy(org, e.id, 6000);
    return { entry: await calculate((await createRun(org, "De minimis excess after pool", SEPTEMBER)).id) };
  }),
  leaveConversionExempt: () => withOrg("Golden P4 Leave Exempt", async (org) => {
    const e = await addEmployee(org, "P4-LC1", 30000);
    await leaveConversion(org, e.id, true);
    return { entry: await calculate((await createRun(org, "Leave conversion exempt", SEPTEMBER)).id) };
  }),
  leaveConversionTaxable: () => withOrg("Golden P4 Leave Taxable", async (org) => {
    const e = await addEmployee(org, "P4-LC2", 30000);
    await leaveConversion(org, e.id, false);
    return { entry: await calculate((await createRun(org, "Leave conversion taxable", SEPTEMBER)).id) };
  }),
  yearEndRefund: () => withOrg("Golden P4 Year-end Refund", async (org) => {
    const e = await addEmployee(org, "P4-YE1", 30000);
    const run = await createRun(org, "Year-end refund", DECEMBER);
    await yearEnd(org, e.id, run.id, -1200);
    return { entry: await calculate(run.id) };
  }),
  yearEndCollection: () => withOrg("Golden P4 Year-end Collection", async (org) => {
    const e = await addEmployee(org, "P4-YE2", 30000);
    const run = await createRun(org, "Year-end collection", DECEMBER);
    await yearEnd(org, e.id, run.id, 800);
    return { entry: await calculate(run.id) };
  }),
  mweTaxableAllowance: () => withOrg("Golden P4 MWE", async (org) => {
    const e = await addEmployee(org, "P4-MWE", 16680, 24);
    await db.insert(employeeMweClassifications).values({
      organizationId: org, employeeId: e.id, isMwe: true, region: "NCR", employeeDailyWage: "695.00", statutoryMinimumWage: "695.00",
      wageOrderReference: "NCR-26 (fictional golden reference)", evidenceReference: "Fictional golden certification evidence",
      effectiveFrom: "2026-01-01", status: "approved", requestedByName: "Golden certification", decidedByName: "Golden checker",
    });
    await taxableAllowance(org, e.id);
    return {
      entry: await calculate((await createRun(org, "MWE taxable allowance", SEPTEMBER)).id),
      checks: (entry) => {
        assert.equal(traceText(entry, "mwe"), "true", "MWE: the approved classification must apply");
        assert.equal(traceText(entry, "mweClassificationSource"), "approved", "MWE: governed classification, not the legacy flag");
      },
    };
  }),
  nonMweTaxableAllowance: () => withOrg("Golden P4 Non-MWE", async (org) => {
    const e = await addEmployee(org, "P4-NMW", 16680, 24);
    await taxableAllowance(org, e.id);
    return {
      entry: await calculate((await createRun(org, "Non-MWE taxable allowance", SEPTEMBER)).id),
      checks: (entry) => assert.equal(traceText(entry, "mwe"), "false", "non-MWE: no classification may apply"),
    };
  }),
};

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 4 compares exact centavos");
  assert.deepEqual(Object.keys(catalog.cases).sort(), Object.keys(runners).sort(), "every catalog case has a runner and every runner a catalog case");
  const results: Array<{ id: string; status: "passed" | "failed"; expected: Record<string, number>; actual?: Record<string, number>; failures: string[] }> = [];
  for (const [id, { expected }] of Object.entries(catalog.cases)) {
    const failures: string[] = [];
    let actual: Record<string, number> | undefined;
    try {
      const { entry, checks } = await runners[id]();
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
