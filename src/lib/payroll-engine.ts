import { and, asc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  calamityAdvisories,
  deMinimisGrants,
  earnedWageRequests,
  employeeLoans,
  employeePayProfiles,
  employeePayRevisions,
  employeeRestDayRevisions,
  employeePayRetroAdjustments,
  employees,
  expenseClaims,
  leaveConversions,
  leavePolicies,
  leaveRequests,
  orgUnits,
  payrollEntries,
  payrollJobs,
  payrollRuns,
  payslips,
  timePunches,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import {
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
  deriveClockHours,
  holidayMultiplier,
  isRestDayOfWeek,
  restDayForDate,
  type EffectiveRestDayRevisionInput,
} from "@/lib/payroll-rules";
import { holidayPayContextOn, isBelowMinimum } from "@/lib/wage-orders";
import { deMinimisPerSemiMonthlyPeriod, deMinimisTreatment, type DeMinimisType } from "@/lib/ph-compliance";
import { calculateBenefits, type EnrollmentInput } from "@/lib/benefits";
import { benefitEnrollments, benefitPlans } from "@/db/schema";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import {
  leaveRangeContainsDate,
  resolveApprovedLeaveForPayroll,
  type ResolvedPayrollLeave,
} from "@/lib/leave-payroll";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import {
  attendanceDeductionsForCutoff,
  fixedMonthlyBasicForTimeline,
  leaveAdjustmentForCutoff,
  payTimelineTrace,
  profileForDate,
  resolvePayProfile,
  resolvePayTimeline,
  type EffectivePayRevisionInput,
  type EmployeePayProfileInput,
} from "@/lib/pay-basis";

const RULE_VERSION = "PH-2026.03";
const DEFAULT_CHUNK = 25;

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function roundToCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const PHILIPPINE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toLocalIso(date: Date) {
  const parts = new Map(
    PHILIPPINE_TIME.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
}

export async function enqueuePayrollRun(runId: number, chunkSize = DEFAULT_CHUNK) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");

  const employeeWhere = run.scopeOrgUnitId
    ? and(
        eq(employees.organizationId, run.organizationId),
        eq(employees.orgUnitId, run.scopeOrgUnitId),
        eq(employees.status, "Active"),
        lte(employees.startDate, run.periodEnd),
      )
    : and(
        eq(employees.organizationId, run.organizationId),
        eq(employees.status, "Active"),
        lte(employees.startDate, run.periodEnd),
      );
  const employeeRows = await db.select().from(employees).where(employeeWhere).orderBy(asc(employees.id));
  if (employeeRows.length === 0) {
    throw new Error("Payroll scope has no active employees. Add or reactivate an employee before calculating.");
  }
  const totalChunks = Math.max(1, Math.ceil(employeeRows.length / chunkSize));

  await db.delete(payrollJobs).where(eq(payrollJobs.payrollRunId, runId));
  await db.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));

  await db.update(payrollRuns).set({
    status: "Queued",
    employeeCount: employeeRows.length,
    grossPay: "0",
    netPay: "0",
    exceptions: 0,
    processedChunks: 0,
    totalChunks,
    ruleVersion: RULE_VERSION,
  }).where(eq(payrollRuns.id, runId));

  await db.insert(payrollJobs).values({
    payrollRunId: runId,
    organizationId: run.organizationId,
    status: "queued",
    chunkIndex: 0,
    chunkSize,
    attempts: 0,
  });

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: "System",
    action: "Payroll job queued",
    resource: run.periodLabel,
    metadata: {
      runId,
      totalChunks,
      chunkSize,
      ruleVersion: RULE_VERSION,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      scopeOrgUnitId: run.scopeOrgUnitId,
    },
  });

  return { runId, totalChunks, employeeCount: employeeRows.length };
}

export async function processNextPayrollJob(
  workerId = `worker-${process.pid}`,
  targetRunId?: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = targetRunId
      ? await client.query<{
          id: number;
          payroll_run_id: number;
          organization_id: number;
          chunk_index: number;
          chunk_size: number;
          attempts: number;
        }>(
          `SELECT id, payroll_run_id, organization_id, chunk_index, chunk_size, attempts
           FROM payroll_jobs
           WHERE status IN ('queued', 'failed')
             AND payroll_run_id = $1
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [targetRunId],
        )
      : await client.query<{
          id: number;
          payroll_run_id: number;
          organization_id: number;
          chunk_index: number;
          chunk_size: number;
          attempts: number;
        }>(
          `SELECT id, payroll_run_id, organization_id, chunk_index, chunk_size, attempts
           FROM payroll_jobs
           WHERE status IN ('queued', 'failed')
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
        );

    if (claim.rowCount === 0) {
      await client.query("COMMIT");
      return { processed: false as const };
    }

    const job = claim.rows[0];
    await client.query(
      `UPDATE payroll_jobs
       SET status = 'processing', locked_at = NOW(), locked_by = $2, attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1`,
      [job.id, workerId],
    );
    await client.query("COMMIT");

    try {
      const result = await processPayrollChunk({
        runId: job.payroll_run_id,
        organizationId: job.organization_id,
        chunkIndex: job.chunk_index,
        chunkSize: job.chunk_size,
      });

      if (result.done) {
        await db.update(payrollJobs).set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
        }).where(eq(payrollJobs.id, job.id));
      } else {
        await db.update(payrollJobs).set({
          status: "queued",
          chunkIndex: job.chunk_index + 1,
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
          lastError: null,
        }).where(eq(payrollJobs.id, job.id));
      }

      return { processed: true as const, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown payroll error";
      await db.update(payrollJobs).set({
        status: "failed",
        lastError: message,
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      }).where(eq(payrollJobs.id, job.id));
      await db.update(payrollRuns).set({ status: "Failed" }).where(eq(payrollRuns.id, job.payroll_run_id));
      throw error;
    }
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function drainPayrollQueue(maxJobs = 50, targetRunId?: number) {
  const results = [];
  for (let i = 0; i < maxJobs; i += 1) {
    const result = await processNextPayrollJob(undefined, targetRunId);
    if (!result.processed) break;
    results.push(result);

    // Synchronous API callers drain one requested run to completion. A global
    // background worker should keep moving through other queued runs instead
    // of stopping merely because one run finished.
    if (targetRunId && result.done) break;
  }
  return results;
}

async function processPayrollChunk(input: {
  runId: number;
  organizationId: number;
  chunkIndex: number;
  chunkSize: number;
}) {
  await ensureLeavePayrollSchema();
  await ensureEmployeePayProfiles(input.organizationId);
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
  if (!run) throw new Error("Payroll run missing");

  const employeeWhere = run.scopeOrgUnitId
    ? and(
        eq(employees.organizationId, input.organizationId),
        eq(employees.orgUnitId, run.scopeOrgUnitId),
        eq(employees.status, "Active"),
        lte(employees.startDate, run.periodEnd),
      )
    : and(
        eq(employees.organizationId, input.organizationId),
        eq(employees.status, "Active"),
        lte(employees.startDate, run.periodEnd),
      );
  const allEmployees = await db.select().from(employees)
    .where(employeeWhere)
    .orderBy(asc(employees.id));

  if (allEmployees.length !== run.employeeCount) {
    throw new Error(
      "Payroll employee scope changed after calculation was queued. Recalculate so the run uses one consistent active-employee cohort.",
    );
  }
  const chunk = allEmployees.slice(input.chunkIndex * input.chunkSize, (input.chunkIndex + 1) * input.chunkSize);
  const chunkIds = chunk.map((employee) => employee.id);
  const payProfileRows = chunkIds.length
    ? await db.select().from(employeePayProfiles).where(inArray(employeePayProfiles.employeeId, chunkIds))
    : [];
  const payRevisionRows = chunkIds.length
    ? await db.select().from(employeePayRevisions).where(and(
        eq(employeePayRevisions.organizationId, input.organizationId),
        inArray(employeePayRevisions.employeeId, chunkIds),
        lte(employeePayRevisions.effectiveDate, run.periodEnd),
      )).orderBy(asc(employeePayRevisions.effectiveDate), asc(employeePayRevisions.id))
    : [];
  const restDayRevisionRows = chunkIds.length
    ? await db.select().from(employeeRestDayRevisions).where(and(
        eq(employeeRestDayRevisions.organizationId, input.organizationId),
        inArray(employeeRestDayRevisions.employeeId, chunkIds),
      )).orderBy(asc(employeeRestDayRevisions.effectiveDate), asc(employeeRestDayRevisions.id))
    : [];
  const payProfileByEmployee = new Map(payProfileRows.map((profile) => [profile.employeeId, profile]));
  const payRevisionsByEmployee = new Map<number, typeof payRevisionRows>();
  for (const revision of payRevisionRows) {
    payRevisionsByEmployee.set(revision.employeeId, [...(payRevisionsByEmployee.get(revision.employeeId) ?? []), revision]);
  }
  const restDayRevisionsByEmployee = new Map<number, typeof restDayRevisionRows>();
  for (const revision of restDayRevisionRows) {
    restDayRevisionsByEmployee.set(revision.employeeId, [...(restDayRevisionsByEmployee.get(revision.employeeId) ?? []), revision]);
  }
  if (chunk.length === 0) {
    await finalizeRun(input.runId);
    return { done: true, chunkIndex: input.chunkIndex, processedEmployees: 0 };
  }

  const advisories = await db.select().from(calamityAdvisories).where(and(
    eq(calamityAdvisories.organizationId, input.organizationId),
    eq(calamityAdvisories.active, true),
    lte(calamityAdvisories.startDate, run.periodEnd),
    gte(calamityAdvisories.endDate, run.periodStart),
  ));
  const units = await db.select().from(orgUnits).where(eq(orgUnits.organizationId, input.organizationId));
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));

  // Load the benefit catalogue and this chunk's active enrolments. Without this
  // the calculation function accepts benefits but nothing ever supplies them,
  // which would make the deduction silently inert.
  const plans = await db.select().from(benefitPlans).where(eq(benefitPlans.active, true));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const enrolments = plans.length === 0
    ? []
    : await db.select().from(benefitEnrollments).where(and(
        eq(benefitEnrollments.organizationId, input.organizationId),
        eq(benefitEnrollments.status, "active"),
      ));
  const enrolmentsByEmployee = new Map<number, EnrollmentInput[]>();
  for (const enrolment of enrolments) {
    const plan = planById.get(enrolment.planId);
    if (!plan) continue;
    const list = enrolmentsByEmployee.get(enrolment.employeeId) ?? [];
    list.push({
      plan: {
        id: plan.id,
        name: plan.name,
        category: plan.category as "hmo" | "insurance" | "voluntary" | "allowance",
        employeeShare: Number(plan.employeeShare),
        employerShare: Number(plan.employerShare),
        cap: plan.cap == null ? null : Number(plan.cap),
      },
      monthlyContribution: Number(enrolment.monthlyContribution),
      active: true,
    });
    enrolmentsByEmployee.set(enrolment.employeeId, list);
  }

  // Approved-but-unpaid expense claims and approved-but-unrecovered advances
  // are pulled per chunk only, so a large run never loads the whole ledger.
  const [leavePolicyRows, approvedLeaveRows] = await Promise.all([
    db.select().from(leavePolicies).where(and(
      eq(leavePolicies.organizationId, input.organizationId),
      eq(leavePolicies.active, true),
    )),
    chunkIds.length
      ? db.select().from(leaveRequests).where(and(
          eq(leaveRequests.organizationId, input.organizationId),
          eq(leaveRequests.status, "Approved"),
          inArray(leaveRequests.employeeId, chunkIds),
          lte(leaveRequests.startDate, run.periodEnd),
          gte(leaveRequests.endDate, run.periodStart),
        ))
      : Promise.resolve([]),
  ]);
  const approvedLeaveByEmployee = new Map<number, ResolvedPayrollLeave[]>();
  for (const employeeId of chunkIds) {
    const requests = approvedLeaveRows
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({
        id: row.id,
        leaveType: row.leaveType,
        startDate: String(row.startDate),
        endDate: String(row.endDate),
        days: Number(row.days),
      }));
    if (requests.length === 0) continue;

    const resolved = resolveApprovedLeaveForPayroll({
      requests,
      policies: leavePolicyRows.map((policy) => ({
        leaveType: policy.leaveType,
        payTreatment: policy.payTreatment,
        paidPercentage: Number(policy.paidPercentage),
      })),
      periodStart: String(run.periodStart),
      periodEnd: String(run.periodEnd),
      priorStatutory: priorStatutoryByEmployee.get(employee.id),
      isFinalCutoffOfMonth,
    });
    approvedLeaveByEmployee.set(employeeId, resolved);
  }

  const openClaims = chunkIds.length
    ? await db.select().from(expenseClaims).where(and(
        eq(expenseClaims.organizationId, input.organizationId),
        eq(expenseClaims.status, "approved"),
        inArray(expenseClaims.employeeId, chunkIds),
      ))
    : [];
  const openAdvances = chunkIds.length
    ? await db.select().from(earnedWageRequests).where(and(
        eq(earnedWageRequests.organizationId, input.organizationId),
        eq(earnedWageRequests.status, "approved"),
        inArray(earnedWageRequests.employeeId, chunkIds),
      ))
    : [];
  const deMinimis = chunkIds.length
    ? await db.select().from(deMinimisGrants).where(and(
        eq(deMinimisGrants.organizationId, input.organizationId),
        eq(deMinimisGrants.active, true),
        inArray(deMinimisGrants.employeeId, chunkIds),
      ))
    : [];
  const claimsByEmployee = new Map<number, typeof openClaims>();
  for (const claim of openClaims) {
    if (claim.payrollRunId != null) continue;
    claimsByEmployee.set(claim.employeeId, [...(claimsByEmployee.get(claim.employeeId) ?? []), claim]);
  }
  const advancesByEmployee = new Map<number, typeof openAdvances>();
  for (const advance of openAdvances) {
    if (advance.payrollRunId != null) continue;
    advancesByEmployee.set(advance.employeeId, [...(advancesByEmployee.get(advance.employeeId) ?? []), advance]);
  }
  const deMinimisByEmployee = new Map<number, typeof deMinimis>();
  for (const grant of deMinimis) {
    deMinimisByEmployee.set(grant.employeeId, [...(deMinimisByEmployee.get(grant.employeeId) ?? []), grant]);
  }

  const activeLoans = chunkIds.length
    ? await db.select().from(employeeLoans).where(and(
        eq(employeeLoans.organizationId, input.organizationId),
        eq(employeeLoans.status, "active"),
        inArray(employeeLoans.employeeId, chunkIds),
      ))
    : [];
  const pendingRetroAdjustments = chunkIds.length
    ? await db.select().from(employeePayRetroAdjustments).where(and(
        eq(employeePayRetroAdjustments.organizationId, input.organizationId),
        eq(employeePayRetroAdjustments.status, "pending"),
        inArray(employeePayRetroAdjustments.employeeId, chunkIds),
      ))
    : [];
  const retroByEmployee = new Map<number, typeof pendingRetroAdjustments>();
  for (const retro of pendingRetroAdjustments) {
    retroByEmployee.set(retro.employeeId, [...(retroByEmployee.get(retro.employeeId) ?? []), retro]);
  }

    const loansByEmployee = new Map<number, typeof activeLoans>();
  for (const loan of activeLoans) {
    if (Number(loan.remainingBalance) <= 0) continue;
    loansByEmployee.set(loan.employeeId, [...(loansByEmployee.get(loan.employeeId) ?? []), loan]);
  }

  const openConversions = chunkIds.length
    ? await db.select().from(leaveConversions).where(and(
        eq(leaveConversions.organizationId, input.organizationId),
        eq(leaveConversions.status, "approved"),
        inArray(leaveConversions.employeeId, chunkIds),
      ))
    : [];
  const conversionsByEmployee = new Map<number, typeof openConversions>();
  for (const conv of openConversions) {
    if (conv.payrollRunId != null) continue;
    conversionsByEmployee.set(conv.employeeId, [...(conversionsByEmployee.get(conv.employeeId) ?? []), conv]);
  }

  // Monthly statutory contributions are ultimately reconciled against actual
  // remuneration. For the final cutoff of a month, use the released earlier
  // cutoff as the immutable ledger baseline instead of guessing current × 2.
  const periodEndText = String(run.periodEnd);
  const periodEndDate = new Date(`${periodEndText}T00:00:00Z`);
  const nextDay = new Date(periodEndDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const isFinalCutoffOfMonth = nextDay.getUTCMonth() !== periodEndDate.getUTCMonth();
  const monthStart = `${periodEndText.slice(0, 7)}-01`;

  const priorMonthEntries = chunkIds.length
    ? await db.select({
        employeeId: payrollEntries.employeeId,
        grossPay: payrollEntries.grossPay,
        lineItems: payrollEntries.lineItems,
      })
        .from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(
          eq(payrollRuns.organizationId, input.organizationId),
          eq(payrollRuns.status, "Released"),
          inArray(payrollEntries.employeeId, chunkIds),
          gte(payrollRuns.periodEnd, monthStart),
          lt(payrollRuns.periodEnd, run.periodStart),
        ))
    : [];

  const priorStatutoryByEmployee = new Map<number, {
    remuneration: number;
    sssEmployee: number;
    philHealthEmployee: number;
    pagIbigEmployee: number;
  }>();

  for (const prior of priorMonthEntries) {
    const lines = Array.isArray(prior.lineItems)
      ? prior.lineItems as Array<{ code?: string; amount?: string | number }>
      : [];
    const expenseReimbursements = lines
      .filter((line) => String(line.code ?? "").startsWith("EXP-"))
      .reduce((sum, line) => sum + Math.max(0, Number(line.amount ?? 0) || 0), 0);
    const deduction = (code: string) =>
      Math.abs(Number(lines.find((line) => String(line.code ?? "").toUpperCase() === code)?.amount ?? 0) || 0);
    const previous = priorStatutoryByEmployee.get(prior.employeeId) ?? {
      remuneration: 0,
      sssEmployee: 0,
      philHealthEmployee: 0,
      pagIbigEmployee: 0,
    };
    previous.remuneration = roundToCents(
      previous.remuneration + Math.max(0, Number(prior.grossPay) - expenseReimbursements),
    );
    previous.sssEmployee = roundToCents(previous.sssEmployee + deduction("SSS"));
    previous.philHealthEmployee = roundToCents(previous.philHealthEmployee + deduction("PHIC"));
    previous.pagIbigEmployee = roundToCents(previous.pagIbigEmployee + deduction("HDMF"));
    priorStatutoryByEmployee.set(prior.employeeId, previous);
  }

  let chunkGross = 0;
  let chunkNet = 0;
  let chunkExceptions = 0;

  for (const employee of chunk) {
    const punches = await db.select().from(timePunches).where(and(
      eq(timePunches.organizationId, input.organizationId),
      eq(timePunches.employeeId, employee.id),
      gte(timePunches.workDate, run.periodStart),
      lte(timePunches.workDate, run.periodEnd),
    ));
    const unit = employee.orgUnitId ? unitMap.get(employee.orgUnitId) : null;
    const calc = calculateEmployeePay({
      employee,
      punches,
      advisories,
      unitName: unit?.name ?? "Unassigned",
      periodLabel: run.periodLabel,
      benefits: enrolmentsByEmployee.get(employee.id) ?? [],
      expenses: (claimsByEmployee.get(employee.id) ?? []).map((c) => ({
        id: c.id,
        category: c.category,
        description: c.description,
        amount: Number(c.amount),
        incurredOn: String(c.incurredOn),
      })),
      advances: (advancesByEmployee.get(employee.id) ?? []).map((a) => ({
        id: a.id,
        requestedAmount: Number(a.requestedAmount),
        fee: Number(a.fee),
      })),
      deMinimis: (deMinimisByEmployee.get(employee.id) ?? [])
        .filter((g) => !g.endedOn || String(g.endedOn) >= String(run.payDate))
        .map((g) => ({
          id: g.id,
          benefitType: g.benefitType as DeMinimisType,
          amount: Number(g.amount),
          frequency: g.frequency as "month" | "semester" | "year",
        })),
      loans: (loansByEmployee.get(employee.id) ?? []).map((l) => ({
        id: l.id,
        loanType: l.loanType,
        referenceNo: l.referenceNo,
        cutoffDeduction: Number(l.cutoffDeduction),
        remainingBalance: Number(l.remainingBalance),
      })),
      leaveConversions: (conversionsByEmployee.get(employee.id) ?? []).map((c) => ({
        id: c.id,
        leaveType: c.leaveType,
        daysConverted: Number(c.daysConverted),
        dailyRate: Number(c.dailyRate),
        cashAmount: Number(c.cashAmount),
        taxExempt: c.taxExempt,
      })),
      approvedLeave: approvedLeaveByEmployee.get(employee.id) ?? [],
      retroAdjustments: (retroByEmployee.get(employee.id) ?? []).map((retro) => ({
        id: retro.id,
        amount: Number(retro.amount),
        sourcePeriodLabel: retro.sourcePeriodLabel,
      })),
      payProfile: (() => {
        const profile = payProfileByEmployee.get(employee.id);
        if (!profile) throw new Error(`Employee #${employee.id} has no pay profile.`);
        return {
          payBasis: profile.payBasis,
          rateAmount: profile.rateAmount,
          standardWorkDaysPerMonth: profile.standardWorkDaysPerMonth,
          standardHoursPerDay: profile.standardHoursPerDay,
        };
      })(),
      payRevisions: (payRevisionsByEmployee.get(employee.id) ?? []).map((revision) => ({
        effectiveDate: String(revision.effectiveDate),
        previousPayBasis: revision.previousPayBasis,
        previousRateAmount: revision.previousRateAmount,
        previousStandardWorkDaysPerMonth: revision.previousStandardWorkDaysPerMonth,
        previousStandardHoursPerDay: revision.previousStandardHoursPerDay,
        newPayBasis: revision.newPayBasis,
        newRateAmount: revision.newRateAmount,
        newStandardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
        newStandardHoursPerDay: revision.newStandardHoursPerDay,
        reason: revision.reason,
      })),
      restDayRevisions: (restDayRevisionsByEmployee.get(employee.id) ?? []).map((revision) => ({
        effectiveDate: String(revision.effectiveDate),
        previousRestDay: revision.previousRestDay,
        newRestDay: revision.newRestDay,
      })),
      periodStart: String(run.periodStart),
      periodEnd: String(run.periodEnd),
    });

    chunkGross += calc.gross;
    chunkNet += calc.net;
    if (calc.status === "Exception") chunkExceptions += 1;

    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: input.runId,
      employeeId: employee.id,
      grossPay: money(calc.gross),
      deductions: money(calc.deductions),
      netPay: money(calc.net),
      status: calc.status,
      lineItems: calc.lineItems,
      trace: {
        ...calc.trace,
        payment: {
          employeeName: `${employee.firstName} ${employee.lastName}`,
          employeeNo: employee.employeeNo,
          bankAccount: employee.bankAccount,
          bankCode: employee.bankCode,
          mobile: employee.mobile,
        },
        payProfile: {
          payBasis: payProfileByEmployee.get(employee.id)!.payBasis,
          rateAmount: Number(payProfileByEmployee.get(employee.id)!.rateAmount),
          standardWorkDaysPerMonth: Number(payProfileByEmployee.get(employee.id)!.standardWorkDaysPerMonth),
          standardHoursPerDay: Number(payProfileByEmployee.get(employee.id)!.standardHoursPerDay),
          monthlyEquivalent: Number(employee.basicRate),
        },
      },
    }).returning();

    await db.insert(payslips).values({
      payrollEntryId: entry.id,
      organizationId: input.organizationId,
      employeeId: employee.id,
      periodLabel: run.periodLabel,
      content: calc.payslipText,
      ruleVersion: RULE_VERSION,
    });

  }

  const processedChunks = input.chunkIndex + 1;
  const totalChunks = Math.max(1, Math.ceil(allEmployees.length / input.chunkSize));
  const done = processedChunks >= totalChunks;

  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
  await db.update(payrollRuns).set({
    status: done ? "Needs review" : "Processing",
    grossPay: money(Number(fresh?.grossPay ?? 0) + chunkGross),
    netPay: money(Number(fresh?.netPay ?? 0) + chunkNet),
    exceptions: Number(fresh?.exceptions ?? 0) + chunkExceptions,
    processedChunks,
    totalChunks,
    employeeCount: allEmployees.length,
  }).where(eq(payrollRuns.id, input.runId));

  if (done) {
    await finalizeRun(input.runId);
  }

  return {
    done,
    chunkIndex: input.chunkIndex,
    processedEmployees: chunk.length,
    processedChunks,
    totalChunks,
  };
}

async function finalizeRun(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return;
  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: "System",
    action: "Payroll calculation completed",
    resource: run.periodLabel,
    metadata: {
      runId,
      employeeCount: run.employeeCount,
      exceptions: run.exceptions,
      ruleVersion: RULE_VERSION,
    },
  });
}

function calculateEmployeePay(input: {
  employee: typeof employees.$inferSelect;
  punches: Array<typeof timePunches.$inferSelect>;
  advisories: Array<typeof calamityAdvisories.$inferSelect>;
  unitName: string;
  periodLabel: string;
  benefits?: EnrollmentInput[];
  expenses?: Array<{ id: number; category: string; description: string; amount: number; incurredOn: string }>;
  advances?: Array<{ id: number; requestedAmount: number; fee: number }>;
  deMinimis?: Array<{ id: number; benefitType: DeMinimisType; amount: number; frequency: "month" | "semester" | "year" }>;
  loans?: Array<{ id: number; loanType: string; referenceNo: string; cutoffDeduction: number; remainingBalance: number }>;
  leaveConversions?: Array<{ id: number; leaveType: string; daysConverted: number; dailyRate: number; cashAmount: number; taxExempt: boolean }>;
  approvedLeave?: ResolvedPayrollLeave[];
  retroAdjustments?: Array<{ id: number; amount: number; sourcePeriodLabel: string }>;
  payProfile: EmployeePayProfileInput;
  payRevisions?: EffectivePayRevisionInput[];
  restDayRevisions?: EffectiveRestDayRevisionInput[];
  periodStart: string;
  periodEnd: string;
  priorStatutory?: {
    remuneration: number;
    sssEmployee: number;
    philHealthEmployee: number;
    pagIbigEmployee: number;
  };
  isFinalCutoffOfMonth?: boolean;
}) {
  const employeeStartDate = String(input.employee.startDate);
  const employmentStart = employeeStartDate > input.periodStart ? employeeStartDate : input.periodStart;
  if (employmentStart > input.periodEnd) {
    throw new Error(`Employee #${input.employee.id} starts after this payroll cutoff and must not be included.`);
  }

  const timeline = resolvePayTimeline({
    currentProfile: input.payProfile,
    revisions: input.payRevisions ?? [],
    periodStart: employmentStart,
    periodEnd: input.periodEnd,
  });
  const payProfile = profileForDate(timeline, input.periodEnd);
  const monthly = payProfile.monthlyEquivalent;
  // The denominator remains the full cutoff while timeline coverage begins on
  // the actual employment start date, so a mid-cutoff hire receives only the
  // earned fraction of the semi-monthly salary.
  const semiMonthlyBasic = fixedMonthlyBasicForTimeline(timeline, input.periodStart, input.periodEnd);
  const dailyRate = payProfile.dailyRate;
  const hourlyRate = payProfile.hourlyRate;

  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let nightMinutes = 0;
  let tardinessMinutes = 0;
  let undertimeMinutes = 0;
  let workedBasicPay = 0;
  let overtimePay = 0;
  let nightDiffPay = 0;
  let tardinessDeduction = 0;
  let undertimeDeduction = 0;
  let holidayPremium = 0;
  const flags: string[] = [];
  const punchNotes: string[] = [];
  const holidayNotes: string[] = [];

  const eligiblePunches = input.punches.filter((punch) => String(punch.workDate) >= employmentStart);
  for (const punch of eligiblePunches) {
    const derived = deriveClockHours(
      {
        timeIn: punch.timeIn ? toLocalIso(new Date(punch.timeIn)) : null,
        timeOut: punch.timeOut ? toLocalIso(new Date(punch.timeOut)) : null,
      },
      {
        start: punch.shiftStart,
        end: punch.shiftEnd,
        breakMinutes: 60,
        graceMinutes: 5,
      },
    );
    const punchProfile = profileForDate(timeline, String(punch.workDate));
    const workedRegular = Math.max(0, derived.workedMinutes - derived.overtimeMinutes);
    regularMinutes += workedRegular;
    overtimeMinutes += derived.overtimeMinutes;
    nightMinutes += derived.nightDifferentialMinutes;
    tardinessMinutes += derived.tardinessMinutes;
    undertimeMinutes += derived.undertimeMinutes;
    if (punchProfile.payBasis !== "monthly") {
      workedBasicPay += (workedRegular / 60) * punchProfile.hourlyRate;
    }
    const holidayContext = holidayPayContextOn(punch.workDate);
    const restDay = restDayForDate(input.employee.restDay, input.restDayRevisions ?? [], String(punch.workDate));
    const isRestDay = isRestDayOfWeek(String(punch.workDate), restDay);
    const otMultiplier = holidayMultiplier({ holiday: holidayContext.holiday, worked: true, overtime: true, restDay: isRestDay });
    const regularMultiplier = holidayMultiplier({ holiday: holidayContext.holiday, worked: true, overtime: false, restDay: isRestDay });
    overtimePay += (derived.overtimeMinutes / 60) * punchProfile.hourlyRate * otMultiplier;
    nightDiffPay +=
      (derived.nightRegularMinutes / 60) * punchProfile.hourlyRate * regularMultiplier * 0.1
      + (derived.nightOvertimeMinutes / 60) * punchProfile.hourlyRate * otMultiplier * 0.1;
    const attendanceDeduction = attendanceDeductionsForCutoff(
      punchProfile,
      derived.tardinessMinutes,
      derived.undertimeMinutes,
    );
    tardinessDeduction += attendanceDeduction.tardinessDeduction;
    undertimeDeduction += attendanceDeduction.undertimeDeduction;
    flags.push(...derived.flags);
    if (derived.flags.length) punchNotes.push(`${punch.workDate}: ${derived.flags.join("; ")}`);

    if ((holidayContext.holidays.length > 0 || isRestDay) && derived.workedMinutes > 0) {
      const extra = ((workedRegular / 60) * punchProfile.hourlyRate) * (regularMultiplier - 1);
      holidayPremium += extra;
      const otNote = derived.overtimeMinutes > 0 ? ` (overtime that day priced separately at ×${otMultiplier})` : "";
      const dayLabel = holidayContext.label
        ? `${holidayContext.label}${isRestDay ? ", rest day" : ""}`
        : "rest day";
      holidayNotes.push(`${punch.workDate} ${dayLabel} ×${regularMultiplier} → +${money(extra)}${otNote}`);
    }
  }

  // Monthly portions are prorated across effective-dated rate segments by
  // calendar days inside the cutoff. Daily/hourly portions come from the
  // punch date's effective rate, so a mid-cutoff change never rewrites earlier
  // worked time.
  const baseBasicPay = semiMonthlyBasic + workedBasicPay;

  const approvedLeave = input.approvedLeave ?? [];
  const invalidPreEmploymentLeave = approvedLeave.find((leave) => leave.startDate < employeeStartDate);
  if (invalidPreEmploymentLeave) {
    throw new Error(
      `Approved ${invalidPreEmploymentLeave.leaveType} leave #${invalidPreEmploymentLeave.id} begins before employee #${input.employee.id}'s employment start date. Correct the leave record before calculating payroll.`,
    );
  }
  if (timeline.length > 1 && approvedLeave.length > 0) {
    for (const leave of approvedLeave) {
      const touchedSegments = timeline.filter((segment) =>
        leave.startDate <= segment.endDate && leave.endDate >= segment.startDate
      );
      if (touchedSegments.length > 1) {
        throw new Error(
          `Approved ${leave.leaveType} leave #${leave.id} crosses an effective-dated pay change. Split the leave request at the pay-change date before calculating payroll so leave pay is not guessed.`,
        );
      }
    }
  }
  const leaveNotes: string[] = [];
  for (const leave of approvedLeave) {
    leaveNotes.push(
      `Leave #${leave.id} ${leave.leaveType}: ${leave.overlapDays}d in cutoff · ${leave.paidPercentage}% paid`,
    );
    const overlappingPunches = eligiblePunches.filter((punch) =>
      leaveRangeContainsDate(leave, String(punch.workDate)),
    );
    if (overlappingPunches.length > 0) {
      flags.push(
        `Attendance overlaps approved ${leave.leaveType} leave #${leave.id} on ${overlappingPunches.map((punch) => punch.workDate).join(", ")}`,
      );
    }
  }

  const desiredLeaveAmounts = approvedLeave.map((leave) => ({
    leave,
    desiredAmount: leaveAdjustmentForCutoff({
      profile: profileForDate(
        timeline,
        leave.startDate < employmentStart ? employmentStart : leave.startDate,
      ),
      paidDays: leave.paidDays,
      unpaidDays: leave.unpaidDays,
    }),
  }));
  const desiredLeaveAdjustment = desiredLeaveAmounts.reduce((sum, item) => sum + item.desiredAmount, 0);
  const cappedLeaveAdjustment =
    payProfile.payBasis === "monthly"
      ? Math.max(-semiMonthlyBasic, Math.min(0, desiredLeaveAdjustment))
      : Math.max(0, desiredLeaveAdjustment);
  const leaveScale =
    Math.abs(desiredLeaveAdjustment) > 0.000001
      ? cappedLeaveAdjustment / desiredLeaveAdjustment
      : 1;

  if (Math.abs(cappedLeaveAdjustment - desiredLeaveAdjustment) > 0.01) {
    flags.push("Leave pay adjustment was capped to the configured cutoff pay boundary.");
  }

  const leaveLines = desiredLeaveAmounts.map(({ leave, desiredAmount }) => ({
    code: `LEAVE-${leave.id}`,
    label:
      leave.payTreatment === "paid"
        ? `Paid leave, ${leave.leaveType}`
        : leave.payTreatment === "unpaid"
          ? `Unpaid leave, ${leave.leaveType}`
          : `Partially paid leave, ${leave.leaveType}`,
    amount: money(desiredAmount * leaveScale),
    notes: [
      `${leave.overlapDays} day(s) in this cutoff`,
      `${leave.paidPercentage}% paid · ${leave.paidDays} paid day(s) · ${leave.unpaidDays} unpaid day(s)`,
    ],
  }));
  const leaveAdjustmentTotal = leaveLines.reduce((sum, line) => sum + Number(line.amount), 0);

  const wageCheck = isBelowMinimum(monthly, input.employee.region ?? "NCR", payProfile.standardWorkDaysPerMonth);
  const treatAsMwe = input.employee.mwe;
  if (wageCheck.below) {
    flags.push(
      `Configured pay implies ₱${wageCheck.impliedDaily.toFixed(2)}/day versus the reference wage figure of ₱${wageCheck.order.dailyRate.toFixed(2)} for ${wageCheck.order.region}. Verify the applicable wage tier; payroll did not infer MWE tax status automatically.`,
    );
  }

  let calamityPay = 0;
  const calamityNotes: string[] = [];
  for (const advisory of input.advisories) {
    if (!advisory.policy.toLowerCase().includes("hazard")) continue;
    const unitMatch = advisory.affectedUnit === "All locations"
      || input.unitName.toLowerCase().includes(advisory.affectedUnit.toLowerCase())
      || advisory.affectedUnit.toLowerCase().includes(input.unitName.toLowerCase());
    // Apply to Cebu Hub employees or when unit is unknown but advisory is active for demo org.
    if (unitMatch || input.unitName === "Operations") {
      const premium = baseBasicPay * (advisory.premiumPercent / 100);
      calamityPay += premium;
      calamityNotes.push(`${advisory.advisoryNumber}: ${advisory.policy} applied (+${advisory.premiumPercent}%)`);
    }
  }

  const retroLines = (input.retroAdjustments ?? []).map((retro) => ({
    code: `RETRO-${retro.id}`,
    label: `Retro pay, ${retro.sourcePeriodLabel}`,
    amount: money(retro.amount),
    notes: ["Effective-dated monthly pay correction from a previously released cutoff"],
    amountNum: retro.amount,
  }));
  const retroTotal = retroLines.reduce((sum, line) => sum + line.amountNum, 0);

  // Approved expense reimbursements are a non-taxable addition to pay, and
  // approved earned-wage advances are recovered here so they cannot be
  // double-drawn. Both are excluded when not supplied, keeping the engine
  // usable for runs that predate these features.
  const expenseLines = (input.expenses ?? []).map((claim) => ({
    code: `EXP-${claim.id}`,
    label: `Expense, ${claim.category}`,
    amount: money(claim.amount),
    notes: [claim.description, `incurred ${claim.incurredOn}`],
  }));
  const expenseTotal = (input.expenses ?? []).reduce((sum, claim) => sum + Number(claim.amount), 0);

  const advanceLines = (input.advances ?? []).map((advance) => ({
    code: `EWA-${advance.id}`,
    label: "Earned wage advance recovery",
    amount: money(-(Number(advance.requestedAmount) + Number(advance.fee))),
    notes: [`advance ${advance.requestedAmount} + fee ${advance.fee}`],
  }));
  const advanceTotal = (input.advances ?? []).reduce((sum, a) => sum + Number(a.requestedAmount) + Number(a.fee), 0);

  // RR 29-2025 benefits are cash earnings on the payslip but tax-exempt up to
  // their category ceiling. Excess is tracked into the annual 13th-month /
  // other-benefits PHP 90k pool instead of being taxed immediately per cutoff.
  const deMinimisLines = (input.deMinimis ?? []).map((grant) => {
    const periodAmount = deMinimisPerSemiMonthlyPeriod(grant.amount, grant.frequency);
    const annualizedGrant = grant.frequency === "month" ? grant.amount * 12
      : grant.frequency === "semester" ? grant.amount * 2
        : grant.amount;
    const treatment = deMinimisTreatment(grant.benefitType, annualizedGrant);
    const periodOtherBenefitsExcess = treatment.excess === 0 ? 0 : roundToCents(treatment.excess / 24);
    return {
      code: `DM-${grant.id}`,
      label: `De minimis, ${treatment.label}`,
      amount: money(periodAmount),
      notes: [`${treatment.period} ceiling ₱${treatment.ceiling.toFixed(2)}`, `other-benefits pool excess this period ₱${periodOtherBenefitsExcess.toFixed(2)}`],
      periodAmount,
      periodOtherBenefitsExcess,
    };
  });
  const deMinimisTotal = deMinimisLines.reduce((sum, line) => sum + line.periodAmount, 0);
  const deMinimisOtherBenefitsPool = deMinimisLines.reduce((sum, line) => sum + line.periodOtherBenefitsExcess, 0);

  // Leave Cash Conversions (monetization of vacation / service incentive leaves)
  const conversionLines = (input.leaveConversions ?? []).map((conv) => ({
    code: `LEAVE_CONV-${conv.id}`,
    label: `Leave Conversion (${conv.leaveType} ${conv.daysConverted}d)`,
    amount: money(conv.cashAmount),
    notes: [
      `${conv.daysConverted} days @ daily rate ₱${conv.dailyRate}`,
      conv.taxExempt ? "Tax treatment: exempt" : "Tax treatment: taxable",
    ],
    amountNum: conv.cashAmount,
    taxExempt: conv.taxExempt,
  }));
  const conversionTotal = conversionLines.reduce((sum, c) => sum + c.amountNum, 0);
  const conversionTaxExemptTotal = conversionLines.reduce(
    (sum, c) => sum + (c.taxExempt ? c.amountNum : 0),
    0,
  );

  // Employee loans are lower-priority than statutory/tax deductions. Government
  // loan amortizations are attempted before company/other loans; anything that
  // cannot fit in available net pay is carried forward instead of disappearing
  // behind a max(0, net) clamp.
  const requestedLoanLines = (input.loans ?? [])
    .map((loan) => ({
      ...loan,
      requestedDeduction: Math.min(Number(loan.cutoffDeduction), Number(loan.remainingBalance)),
      governmentPriority: /sss|pag-?ibig|hdmf|calamity/i.test(loan.loanType) ? 0 : 1,
    }))
    .sort((a, b) => a.governmentPriority - b.governmentPriority || a.id - b.id);

  const gross = Math.max(0, baseBasicPay + leaveAdjustmentTotal + overtimePay + nightDiffPay + calamityPay + holidayPremium + retroTotal + expenseTotal + deMinimisTotal + conversionTotal);

  // SSS uses total actual remuneration; Pag-IBIG monthly compensation includes
  // basic salary and allowances. First cutoffs retain the product's 50/50
  // estimate. On a month-final cutoff, a released earlier cutoff becomes the
  // ledger baseline and the current deduction is a true-up to the actual
  // month-to-date obligation. A new hire who begins in the final cutoff has no
  // earlier obligation, so the current earned remuneration is used directly.
  const remunerativeCutoffCompensation = Math.max(0, gross - expenseTotal);
  const priorStatutory = input.priorStatutory ?? {
    remuneration: 0,
    sssEmployee: 0,
    philHealthEmployee: 0,
    pagIbigEmployee: 0,
  };
  const newHireInCurrentCutoff = employeeStartDate >= input.periodStart;
  const canTrueUpActualMonth =
    Boolean(input.isFinalCutoffOfMonth)
    && (priorStatutory.remuneration > 0 || newHireInCurrentCutoff);

  const statutoryMonthlyCompensation = roundToCents(
    canTrueUpActualMonth
      ? priorStatutory.remuneration + remunerativeCutoffCompensation
      : remunerativeCutoffCompensation * 2,
  );
  const sssRule = computeSss(statutoryMonthlyCompensation);
  const philHealthRule = computePhilHealth(monthly);
  const pagIbigRule = computePagIbig(statutoryMonthlyCompensation);

  const sss = roundToCents(
    canTrueUpActualMonth
      ? sssRule.employee - priorStatutory.sssEmployee
      : sssRule.employee / 2,
  );
  const philhealth = roundToCents(
    canTrueUpActualMonth
      ? philHealthRule.employee - priorStatutory.philHealthEmployee
      : philHealthRule.employee / 2,
  );
  const pagibig = roundToCents(
    canTrueUpActualMonth
      ? pagIbigRule.employee - priorStatutory.pagIbigEmployee
      : pagIbigRule.employee / 2,
  );
  const statutoryReconciliationMode = canTrueUpActualMonth
    ? (priorStatutory.remuneration > 0 ? "month-final-ledger-true-up" : "new-hire-final-cutoff-actual")
    : "50-50-estimate";

  // BIR: MWE status exempts statutory minimum wage plus enumerated holiday,
  // overtime, night-differential and hazard pay, but NOT unrelated taxable
  // supplementary compensation. This engine currently has one such explicit
  // bucket: taxable leave conversion. De-minimis excess is deferred into the
  // annual 90k other-benefits pool rather than taxed immediately.
  const mweTaxableSupplementaryCompensation = Math.max(0, conversionTotal - conversionTaxExemptTotal);
  const taxableCompensation = treatAsMwe
    ? Math.max(0, mweTaxableSupplementaryCompensation - sss - philhealth - pagibig)
    : Math.max(
        0,
        gross - expenseTotal - deMinimisTotal - conversionTaxExemptTotal - sss - philhealth - pagibig,
      );
  const withholding = computeSemiMonthlyWithholdingTax(taxableCompensation, false);
  const benefitLines = calculateBenefits(input.benefits ?? []);
  const benefitTotal = benefitLines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
  const nonLoanDeductions =
    sss + philhealth + pagibig + withholding + tardinessDeduction + undertimeDeduction + benefitTotal + advanceTotal;

  let availableForLoans = Math.max(0, gross - nonLoanDeductions);
  const loanLines = requestedLoanLines.map((loan) => {
    const deductAmount = Math.min(loan.requestedDeduction, availableForLoans);
    availableForLoans = roundToCents(Math.max(0, availableForLoans - deductAmount));
    if (deductAmount + 0.005 < loan.requestedDeduction) {
      flags.push(
        `${loan.loanType} deduction was limited to ₱${deductAmount.toFixed(2)} because available net pay was insufficient; ₱${(loan.requestedDeduction - deductAmount).toFixed(2)} remains for a later cutoff.`,
      );
    }
    return {
      code: `LOAN-${loan.id}`,
      label: `Loan, ${loan.loanType}`,
      amount: money(-deductAmount),
      notes: [
        `Ref: ${loan.referenceNo}`,
        `Bal: ₱${Number(loan.remainingBalance).toFixed(2)}`,
        `Requested this cutoff: ₱${loan.requestedDeduction.toFixed(2)}`,
      ],
      deductAmount,
      requestedDeduction: loan.requestedDeduction,
    };
  });
  const loanTotal = loanLines.reduce((sum, line) => sum + line.deductAmount, 0);
  const loanRequestedTotal = requestedLoanLines.reduce((sum, line) => sum + line.requestedDeduction, 0);
  const deductions = nonLoanDeductions + loanTotal;
  const net = roundToCents(Math.max(0, gross - deductions));
  const status = flags.length > 0 ? "Exception" : "Ready";

  const lineItems = [
    { code: "BASIC", label: "Basic / worked pay", amount: money(baseBasicPay) },
    ...leaveLines,
    { code: "OT", label: "Overtime", amount: money(overtimePay) },
    { code: "ND", label: "Night differential (10%)", amount: money(nightDiffPay) },
    { code: "HOLIDAY", label: "Holiday / rest-day premium", amount: money(holidayPremium), notes: holidayNotes },
    { code: "CALAMITY", label: "Calamity / hazard premium", amount: money(calamityPay), notes: calamityNotes },
    ...retroLines.map(({ amountNum: _amountNum, ...line }) => line),
    ...conversionLines.map(({ amountNum: _amountNum, taxExempt: _taxExempt, ...c }) => c),
    { code: "SSS", label: "SSS contribution", amount: money(-sss) },
    { code: "PHIC", label: "PhilHealth contribution", amount: money(-philhealth) },
    { code: "HDMF", label: "Pag-IBIG contribution", amount: money(-pagibig) },
    { code: "WHT", label: "Withholding tax", amount: money(-withholding) },
    { code: "LATE", label: "Tardiness", amount: money(-tardinessDeduction) },
    { code: "UT", label: "Undertime", amount: money(-undertimeDeduction) },
    ...expenseLines,
    ...deMinimisLines.map(({ periodAmount: _periodAmount, periodOtherBenefitsExcess: _periodOtherBenefitsExcess, ...line }) => line),
    ...advanceLines,
    ...loanLines.map(({ deductAmount: _deductAmount, requestedDeduction: _requestedDeduction, ...l }) => l),
    ...benefitLines.map((line) => ({
      code: line.code,
      label: `Benefit, ${line.label}`,
      amount: money(line.amount),
      notes: [line.basis],
    })),
  ].filter((item) => Number(item.amount) !== 0);

  const trace = {
    ruleVersion: RULE_VERSION,
    inputs: [
      `payTimeline=${payTimelineTrace(timeline).join("|")}`,
      `effectivePayChanges=${Math.max(0, timeline.length - 1)}`,
      `payBasis=${payProfile.payBasis}`,
      `rateAmount=${money(payProfile.rateAmount)}`,
      `standardWorkDaysPerMonth=${payProfile.standardWorkDaysPerMonth}`,
      `standardHoursPerDay=${payProfile.standardHoursPerDay}`,
      `monthlyEquivalent=${money(monthly)}`,
      `basicRate=${monthly}`,
      `dailyRate=${money(dailyRate)}`,
      `hourlyRate=${money(hourlyRate)}`,
      `taxableCompensation=${money(taxableCompensation)}`,
      `deMinimisPaid=${money(deMinimisTotal)}`,
      `deMinimisOtherBenefitsPool=${money(deMinimisOtherBenefitsPool)}`,
      `mweTaxableSupplementaryCompensation=${money(mweTaxableSupplementaryCompensation)}`,
      `statutoryMonthlyCompensation=${money(statutoryMonthlyCompensation)}`,
      `statutoryReconciliation=${statutoryReconciliationMode}`,
      `priorMonthRemuneration=${money(priorStatutory.remuneration)}`,
      `priorSssEmployee=${money(priorStatutory.sssEmployee)}`,
      `priorPhilHealthEmployee=${money(priorStatutory.philHealthEmployee)}`,
      `priorPagIbigEmployee=${money(priorStatutory.pagIbigEmployee)}`,
      `loanRequested=${money(loanRequestedTotal)}`,
      `loanDeducted=${money(loanTotal)}`,
      `leaveConversionTaxExempt=${money(conversionTaxExemptTotal)}`,
      `approvedLeaveDays=${money(approvedLeave.reduce((sum, leave) => sum + leave.overlapDays, 0))}`,
      `paidLeaveDays=${money(approvedLeave.reduce((sum, leave) => sum + leave.paidDays, 0))}`,
      `unpaidLeaveDays=${money(approvedLeave.reduce((sum, leave) => sum + leave.unpaidDays, 0))}`,
      `leavePayAdjustment=${money(leaveAdjustmentTotal)}`,
      `retroPay=${money(retroTotal)}`,
      `retroAdjustments=${retroLines.length}`,
      `punches=${eligiblePunches.length}`,
      `employmentStart=${employmentStart}`,
      `regularMinutes=${regularMinutes}`,
      `overtimeMinutes=${overtimeMinutes}`,
      `nightMinutes=${nightMinutes}`,
      `tardinessMinutes=${tardinessMinutes}`,
      `undertimeMinutes=${undertimeMinutes}`,
      `sssMonthlySalaryCredit=${money(sssRule.monthlySalaryCredit)}`,
      `philHealthContributionBase=${money(philHealthRule.base)}`,
      `pagIbigFundSalary=${money(pagIbigRule.fundSalary)}`,
      `pagIbigEmployeeRate=${pagIbigRule.employeeRate}`,
      `withholdingTable=RR11-2018-revised-2023+`,
      `region=${input.employee.region ?? "NCR"}`,
      `mwe=${treatAsMwe} (explicit employee tax classification)`,
      `employerStatutoryCost=${money((sssRule.employerTotal + philHealthRule.employer + pagIbigRule.employer) / 2)}`,
      ...holidayNotes,
      ...calamityNotes,
      ...leaveNotes,
      ...punchNotes,
    ],
    flags,
  };

  const payslipText = buildPayslipText({
    employeeName: `${input.employee.firstName} ${input.employee.lastName}`,
    employeeNo: input.employee.employeeNo,
    periodLabel: input.periodLabel,
    unitName: input.unitName,
    gross,
    deductions,
    net,
    lineItems,
    ruleVersion: RULE_VERSION,
    notes: [...holidayNotes, ...calamityNotes, ...leaveNotes, ...punchNotes],
  });

  return { gross, deductions, net, status, lineItems, trace, payslipText };
}

function buildPayslipText(input: {
  employeeName: string;
  employeeNo: string;
  periodLabel: string;
  unitName: string;
  gross: number;
  deductions: number;
  net: number;
  lineItems: Array<{ code: string; label: string; amount: string; notes?: string[] }>;
  ruleVersion: string;
  notes: string[];
}) {
  const lines = [
    "%PDF-1.4",
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
  ];

  const contentLines = [
    "Linaw Payslip",
    `Employee: ${input.employeeName} (${input.employeeNo})`,
    `Period: ${input.periodLabel}`,
    `Unit: ${input.unitName}`,
    `Rule version: ${input.ruleVersion}`,
    "",
    ...input.lineItems.map((item) => `${item.label}: PHP ${item.amount}`),
    "",
    `Gross: PHP ${money(input.gross)}`,
    `Deductions: PHP ${money(input.deductions)}`,
    `Net pay: PHP ${money(input.net)}`,
    "",
    ...(input.notes.length ? ["Notes:", ...input.notes] : ["Notes: none"]),
    "",
    "Traceable line items generated from approved punches and PH-2026.03 rules.",
  ];

  // Build a simple text-based PDF content stream.
  let y = 760;
  const streamParts = ["BT /F1 11 Tf 40 760 Td"];
  for (const line of contentLines) {
    const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    streamParts.push(`(${safe}) Tj`);
    y -= 14;
    streamParts.push("0 -14 Td");
  }
  streamParts.push("ET");
  const stream = streamParts.join("\n");
  lines.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj`);
  lines.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");
  lines.push("xref");
  lines.push("0 6");
  lines.push("0000000000 65535 f ");
  lines.push("trailer<< /Size 6 /Root 1 0 R >>");
  lines.push("startxref");
  lines.push("0");
  lines.push("%%EOF");
  // Also include a plain-text fallback body after EOF marker for non-PDF readers in tests/exports.
  return `${lines.join("\n")}\n\n---PLAINTEXT---\n${contentLines.join("\n")}\n`;
}

export async function getPayrollJobStatus(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  const [job] = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, runId)).orderBy(asc(payrollJobs.id));
  return { run, job };
}
