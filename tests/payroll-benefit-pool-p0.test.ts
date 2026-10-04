import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  deMinimisGrants,
  employeePayProfiles,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";
import { generateGovernmentDraft } from "../src/lib/exporters";
import { computeSemiMonthlyWithholdingTax } from "../src/lib/payroll-rules";

function traceValue(trace: unknown, key: string) {
  const inputs = trace && typeof trace === "object"
    ? (trace as { inputs?: unknown }).inputs
    : null;
  if (!Array.isArray(inputs)) return null;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(`${key}=`));
  if (typeof raw !== "string") return null;
  const value = Number(raw.slice(key.length + 1));
  return Number.isFinite(value) ? value : null;
}

function withholding(entry: typeof payrollEntries.$inferSelect) {
  const lines = Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number }>
    : [];
  return Math.abs(Number(lines.find((line) => line.code === "WHT")?.amount ?? 0) || 0);
}

async function calculateRun(input: {
  organizationId: number;
  label: string;
  start: string;
  end: string;
  payDate: string;
}) {
  const [run] = await db.insert(payrollRuns).values({
    organizationId: input.organizationId,
    periodLabel: input.label,
    periodStart: input.start,
    periodEnd: input.end,
    scopeLabel: "All locations",
    status: "Draft",
    payDate: input.payDate,
  }).returning();

  await enqueuePayrollRun(run.id);
  await drainPayrollQueue(20, run.id);
  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  assert.equal(fresh.status, "Needs review");
  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.ok(entry);
  return { run: fresh, entry };
}

async function releaseRun(runId: number) {
  await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, runId));
  return settlePayrollRun(runId, { actor: "P0 QA", resource: `Run #${runId}` });
}

test("August payroll taxes only shared-benefit excess above the remaining PHP 90,000 pool and 1601-C includes it", async () => {
  const [org] = await db.insert(organizations).values({
    name: "P0 Shared Benefit Pool QA",
    legalName: "P0 Shared Benefit Pool QA Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "POOL-90K-001",
      firstName: "Benefit",
      lastName: "Pool",
      title: "Associate",
      avatarInitials: "BP",
      basicRate: "30000.00",
      startDate: "2025-01-01",
      mobile: "09171234567",
    }).returning();

    await db.insert(employeePayProfiles).values({
      organizationId: org.id,
      employeeId: employee.id,
      payBasis: "monthly",
      rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    });

    // Released YTD payroll has already consumed PHP 85,000 of the ONE annual
    // 13th-month / other-benefits exemption pool.
    const [priorRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Prior YTD benefit pool",
      periodStart: "2026-07-16",
      periodEnd: "2026-07-31",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-07-31",
      employeeCount: 1,
      grossPay: "93000.00",
      netPay: "93000.00",
      ruleVersion: "PH-2026.05",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: priorRun.id,
      employeeId: employee.id,
      grossPay: "93000.00",
      deductions: "0.00",
      netPay: "93000.00",
      status: "Ready",
      lineItems: [
        {
          code: "EARN-YTD-13TH",
          label: "Advance 13th month pay",
          amount: "60000.00",
          notes: ["Type: thirteenth_month"],
          benefitPool90k: true,
          benefitPoolKind: "thirteenth_month",
        },
        {
          code: "EARN-YTD-BONUS",
          label: "Performance bonus",
          amount: "25000.00",
          notes: ["Type: performance_bonus"],
          benefitPool90k: true,
          benefitPoolKind: "performance_bonus",
        },
        {
          code: "DM-uniformClothing",
          label: "De minimis, Uniform and clothing allowance",
          amount: "8000.00",
          periodOtherBenefitsPool: 0,
          notes: ["exempt this cutoff ₱8000.00", "other-benefits pool excess this period ₱0.00"],
        },
      ],
      trace: { inputs: [] },
    });

    // Annual category ceiling is already consumed by the prior PHP 8,000.
    // PHP 48,000/year pays PHP 2,000 per semi-monthly cutoff, so each August
    // cutoff contributes PHP 2,000 of de minimis excess to the shared pool.
    await db.insert(deMinimisGrants).values({
      organizationId: org.id,
      employeeId: employee.id,
      benefitType: "uniformClothing",
      amount: "48000.00",
      frequency: "year",
      active: true,
      effectiveOn: "2026-01-01",
    });

    // August 1-15 adds another PHP 5,000 bonus. Current pool = 5,000 bonus
    // + 2,000 de minimis excess = 7,000. Only 5,000 of the 90k exemption
    // remains, therefore PHP 2,000 must become taxable in this cutoff.
    await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "bonus",
      label: "August performance bonus",
      amount: "5000.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
      effectiveDate: "2026-08-10",
      status: "approved",
      createdBy: "P0 QA",
    });

    const first = await calculateRun({
      organizationId: org.id,
      label: "Aug 1-15 shared-pool crossing",
      start: "2026-08-01",
      end: "2026-08-15",
      payDate: "2026-08-15",
    });

    assert.equal(traceValue(first.entry.trace, "priorBenefitPool90k"), 85_000);
    assert.equal(traceValue(first.entry.trace, "supplementaryBenefitPool90k"), 5_000);
    assert.equal(traceValue(first.entry.trace, "deMinimisOtherBenefitsPool"), 2_000);
    assert.equal(traceValue(first.entry.trace, "currentBenefitPool90k"), 7_000);
    assert.equal(traceValue(first.entry.trace, "benefitPoolRemainingBeforeCutoff"), 5_000);
    assert.equal(traceValue(first.entry.trace, "benefitPoolExemptCurrent"), 5_000);
    assert.equal(traceValue(first.entry.trace, "benefitPoolTaxableCurrent"), 2_000);

    const firstTaxable = traceValue(first.entry.trace, "taxableCompensation");
    assert.ok(firstTaxable != null);
    assert.equal(
      withholding(first.entry),
      computeSemiMonthlyWithholdingTax(firstTaxable!),
      "August first-cutoff WHT must include only the taxable shared-pool excess",
    );

    await releaseRun(first.run.id);

    const second = await calculateRun({
      organizationId: org.id,
      label: "Aug 16-31 shared-pool continuation",
      start: "2026-08-16",
      end: "2026-08-31",
      payDate: "2026-08-31",
    });

    assert.equal(traceValue(second.entry.trace, "priorBenefitPool90k"), 92_000);
    assert.equal(traceValue(second.entry.trace, "currentBenefitPool90k"), 2_000);
    assert.equal(traceValue(second.entry.trace, "benefitPoolRemainingBeforeCutoff"), 0);
    assert.equal(traceValue(second.entry.trace, "benefitPoolExemptCurrent"), 0);
    assert.equal(traceValue(second.entry.trace, "benefitPoolTaxableCurrent"), 2_000);

    const augustWht = Number((withholding(first.entry) + withholding(second.entry)).toFixed(2));
    const draft1601c = await generateGovernmentDraft(second.run.id, "bir-1601c");
    assert.match(draft1601c.body, /"1601-C","2026-08"/);
    assert.ok(
      draft1601c.body.includes(augustWht.toFixed(2)),
      `August 1601-C should include both cutoff WHT totals: ${augustWht.toFixed(2)}`,
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
