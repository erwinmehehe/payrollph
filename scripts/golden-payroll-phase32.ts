/**
 * Golden payroll certification, Phase 32: final pay honours every earning the cutoff exempted, not only a supplementary allowance.
 * Phase 25 and #2042 carried a released exempt ALLOWANCE (an EARN- line) into final pay's annualization. Year end also treats a
 * non-taxable company premium (PREM-, "Taxable: no") and an exempt leave conversion (LEAVE_CONV-, "Tax treatment: exempt") as exempt,
 * so a worker separated at year end must receive the same tax settlement final pay as year end gives. Three workers hired at the
 * switch on the same salary (a control, a non-taxable 25 an hour premium, an exempt 10,000 leave conversion) run through the real
 * engine for cutoffs 13-24, the real runYearEndAnnualization() and the real computeFinalPay() fed the year-to-date inputs exactly as
 * the Separation API derives them from the released rows. Every expected value is an immutable hand-derived literal in
 * certification/golden-payroll-phase32.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayProfiles, employees, leaveConversions, organizations, payPolicies, payPolicyRules, payrollEntries, payrollRuns, timePunches, yearEndAdjustments } from "../src/db/schema";
import { computeFinalPay, readBasicAndThirteenth, releasedExemptAllowanceYtd } from "../src/lib/final-pay";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { WORKED_TIME_PREMIUM_EVENT } from "../src/lib/pay-policy-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";

type Money = Record<string, number | string>;
type Spec = {
  description: string;
  premium: { taxable: boolean; amountPerHour: number } | null;
  conversion: { cutoff: number; leaveType: string; daysConverted: number; dailyRate: number; taxExempt: boolean } | null;
  premiumLines: number;
  conversionLines: number;
  yearEnd: Money;
  finalPayInputs: Money;
  finalPay: Money;
};
type Catalog = {
  version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[];
  employees: Record<string, Spec>; limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };

const catalogPath = "certification/golden-payroll-phase32.json";
const artifactPath = "qa-artifacts/golden-payroll-phase32-reconciliation.json";
const TAX_YEAR = 2026;
const MONTHLY_SALARY = 60000;
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Plain Mondays, one per cutoff 13-24 (no regular or special holiday on any of them).
const WORK_DATES = ["2026-07-06", "2026-07-20", "2026-08-10", "2026-08-17", "2026-09-07", "2026-09-21", "2026-10-05", "2026-10-19", "2026-11-09", "2026-11-16", "2026-12-07", "2026-12-21"];

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
    label: `Phase 32 cutoff ${cutoff}`,
  };
}

const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P32-${id.slice(-12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    // Hired at the provider switch: only the 12 engine cutoffs exist and there are no imported rows.
    basicRate: MONTHLY_SALARY.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-07-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: MONTHLY_SALARY.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

async function runCutoff(orgId: number, cutoff: number, specs: Array<[string, Spec]>, workers: Map<string, number>) {
  const period = cutoffPeriod(cutoff);
  const workDate = WORK_DATES[cutoff - 13];
  // Every worker has the same complete 09:00-18:00 shift (8 worked hours after the 1-hour break) on a plain Monday in the cutoff.
  for (const [id] of specs) {
    await db.insert(timePunches).values({
      organizationId: orgId, employeeId: workers.get(id)!, workDate,
      timeIn: new Date(`${workDate}T09:00:00+08:00`), timeOut: new Date(`${workDate}T18:00:00+08:00`),
      breakStart: new Date(`${workDate}T12:00:00+08:00`), breakEnd: new Date(`${workDate}T13:00:00+08:00`),
      shiftStart: "09:00", shiftEnd: "18:00", status: "Complete",
    });
  }
  // An approved leave conversion is paid by the cutoff it is open in; it is approved just before its own cutoff.
  for (const [id, spec] of specs) {
    if (spec.conversion?.cutoff !== cutoff) continue;
    await db.insert(leaveConversions).values({
      organizationId: orgId, employeeId: workers.get(id)!, leaveType: spec.conversion.leaveType, daysConverted: spec.conversion.daysConverted.toFixed(1),
      dailyRate: spec.conversion.dailyRate.toFixed(2), cashAmount: (spec.conversion.daysConverted * spec.conversion.dailyRate).toFixed(2),
      taxExempt: spec.conversion.taxExempt, status: "approved",
    });
  }
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, specs.length, `cutoff ${cutoff}: expected ${specs.length} payroll entries, got ${rows.length}`);
  for (const row of rows) assert.equal(row.status, "Ready", `cutoff ${cutoff}: payroll entry ${row.id} must calculate without exceptions`);
  // The year-end annualization and the final-pay derivation read Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
  // Release settlement (not part of this certification) marks the paid conversions so the next cutoff does not pay them again.
  await db.update(leaveConversions).set({ status: "paid", payrollRunId: run.id }).where(and(eq(leaveConversions.organizationId, orgId), eq(leaveConversions.status, "approved")));
}

async function requireDisposablePhase32() {
  // This harness creates synthetic payroll runs and marks them Released for
  // ANNUALIZATION ONLY. Never allow it to touch a developer/customer database.
  for (const [name, expected] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    GOLDEN_PHASE32_DISPOSABLE: "github-actions-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(process.env[name], expected, "PHASE32_REFUSED: unsafe " + name);
  }
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET",
  ]) {
    assert.ok(!process.env[name], "PHASE32_REFUSED: provider credential " + name);
  }
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "PHASE32_REFUSED: PG16 required");
  const { rows: [count] } = await pool.query("SELECT COUNT(*)::int AS n FROM organizations");
  assert.equal(count.n, 0, "PHASE32_REFUSED: database must contain no employers");
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P32 final pay exempt earnings", legalName: "Golden P32 final pay exempt earnings Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const hired = new Map<string, typeof employees.$inferSelect>();
    for (const [id] of specs) hired.set(id, await hire(org.id, id));
    const workers = new Map<string, number>([...hired].map(([id, employee]) => [id, employee.id]));
    // Each premium is an employee-scoped company policy with one worked-time rule, approved before the first cutoff.
    for (const [id, spec] of specs) {
      if (!spec.premium) continue;
      const [policy] = await db.insert(payPolicies).values({
        organizationId: org.id, code: `P32-${id.toUpperCase()}`.slice(0, 64), name: `Golden Phase 32 ${id}`, policyKind: "company", version: "P32-2026.11",
        scopeType: "employee", scopeEmployeeId: workers.get(id)!, priority: 500, effectiveFrom: `${TAX_YEAR}-01-01`, active: true,
        description: "Golden certification policy", createdBy: "Golden certification", approvedBy: "Golden certification", approvedAt: new Date("2026-01-01T00:00:00Z"),
      }).returning();
      await db.insert(payPolicyRules).values({
        policyId: policy.id, ruleKey: `P32-${id.toUpperCase()}`.slice(0, 80), eventType: WORKED_TIME_PREMIUM_EVENT, conditions: {},
        outcome: { label: "Golden worked-time top-up", premiumPercent: 0, premiumAmountPerHour: spec.premium.amountPerHour, taxable: spec.premium.taxable, includeInSssBase: true, includeInPagIbigBase: false },
        priority: 500, statutoryFloorProtected: true, enabled: true,
      });
    }
    for (let cutoff = 13; cutoff <= 24; cutoff++) await runCutoff(org.id, cutoff, specs, workers);

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase32");
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
      const rows = await db.select({ lineItems: payrollEntries.lineItems, grossPay: payrollEntries.grossPay }).from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(eq(payrollRuns.organizationId, org.id), eq(payrollEntries.employeeId, workers.get(id)!), eq(payrollRuns.status, "Released")));
      assert.equal(rows.length, 12, `${id}: expected 12 released rows for final pay`);
      // The earning must really be on the payslips; otherwise the case would pass vacuously.
      const lineCount = (prefix: string) => rows.reduce((sum, row) => sum + (row.lineItems as Array<{ code?: string }>).filter((line) => String(line.code).startsWith(prefix)).length, 0);
      if (lineCount("PREM-") !== spec.premiumLines) fail(id, `${id}: expected ${spec.premiumLines} PREM- lines, found ${lineCount("PREM-")}`);
      if (lineCount("LEAVE_CONV-") !== spec.conversionLines) fail(id, `${id}: expected ${spec.conversionLines} LEAVE_CONV- lines, found ${lineCount("LEAVE_CONV-")}`);
      let releasedBasicYtd = 0, thirteenthPaidYtd = 0, grossCompensationYtd = 0, statutoryContributionsYtd = 0, taxWithheldYtd = 0;
      for (const row of rows) {
        const parsed = readBasicAndThirteenth(row.lineItems, { taxYear: TAX_YEAR, sourceYearByAdjustmentId: new Map() });
        releasedBasicYtd += parsed.basic; thirteenthPaidYtd += parsed.thirteenthPaid;
        statutoryContributionsYtd += parsed.contributions; taxWithheldYtd += parsed.taxWithheld;
        // The Separation API's expression: ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid).
        grossCompensationYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid);
      }
      const routeInputs = { releasedBasicYtd, thirteenthPaidYtd, grossCompensationYtd, statutoryContributionsYtd, taxWithheldYtd, releasedExemptAllowanceYtd: releasedExemptAllowanceYtd(rows) };
      for (const message of compare(`${id} final-pay inputs`, spec.finalPayInputs, routeInputs)) fail(id, message);
      const result = computeFinalPay({
        releasedBasicYtd, historicalBasicYtd: 0, unpaidBasicSalary: 0, thirteenthPaidYtd, grossCompensationYtd,
        releasedExemptAllowanceYtd: routeInputs.releasedExemptAllowanceYtd,
        deMinimisYtd: 0, deMinimisExcessYtd: 0, statutoryContributionsYtd, taxWithheldYtd, mwe: false, mweTaxableSupplementaryCompensationYtd: 0,
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
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  return results;
}

async function main() {
  await requireDisposablePhase32();
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 32 compares exact centavos");
  assert.ok(catalog.limitations.length > 0, "Phase 32 must document what it does not certify");
  const results = await runEngine(catalog);
  const failures = results.flatMap((result) => result.failures);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    phase: "golden-payroll-phase32", catalogVersion: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failures.length ? "failed" : "passed", caseCount: results.length, results,
  }, null, 2));
  for (const result of results) console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
  if (failures.length) {
    for (const message of failures) console.error(`  ${message}`);
    throw new Error(`Golden payroll Phase 32 failed: ${failures.length} mismatch(es).`);
  }
  console.log(`Golden payroll Phase 32: ${results.length}/${results.length} cases passed.`);
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
