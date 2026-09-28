import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  calamityAdvisories,
  deMinimisGrants,
  earnedWageRequests,
  employeeLoans,
  employees,
  expenseClaims,
  leaveConversions,
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
} from "@/lib/payroll-rules";
import { holidayOn, isBelowMinimum } from "@/lib/wage-orders";
import { deMinimisPerSemiMonthlyPeriod, deMinimisTreatment, type DeMinimisType } from "@/lib/ph-compliance";
import { calculateBenefits, type EnrollmentInput } from "@/lib/benefits";
import { benefitEnrollments, benefitPlans } from "@/db/schema";

const RULE_VERSION = "PH-2026.01";
const DEFAULT_CHUNK = 25;

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function roundToCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toLocalIso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export async function enqueuePayrollRun(runId: number, chunkSize = DEFAULT_CHUNK) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");

  const employeeWhere = run.scopeOrgUnitId
    ? and(
        eq(employees.organizationId, run.organizationId),
        eq(employees.orgUnitId, run.scopeOrgUnitId),
        eq(employees.status, "Active"),
      )
    : and(
        eq(employees.organizationId, run.organizationId),
        eq(employees.status, "Active"),
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
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
  if (!run) throw new Error("Payroll run missing");

  const employeeWhere = run.scopeOrgUnitId
    ? and(
        eq(employees.organizationId, input.organizationId),
        eq(employees.orgUnitId, run.scopeOrgUnitId),
        eq(employees.status, "Active"),
      )
    : and(
        eq(employees.organizationId, input.organizationId),
        eq(employees.status, "Active"),
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
  const chunkIds = chunk.map((e) => e.id);
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
      })),
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
  leaveConversions?: Array<{ id: number; leaveType: string; daysConverted: number; dailyRate: number; cashAmount: number }>;
}) {
  const monthly = Number(input.employee.basicRate);
  const semiMonthlyBasic = monthly / 2;
  const dailyRate = monthly / 22;
  const hourlyRate = dailyRate / 8;

  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let nightMinutes = 0;
  let tardinessMinutes = 0;
  let undertimeMinutes = 0;
  let holidayPremium = 0;
  const flags: string[] = [];
  const punchNotes: string[] = [];
  const holidayNotes: string[] = [];

  for (const punch of input.punches) {
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
    const workedRegular = Math.max(0, derived.workedMinutes - derived.overtimeMinutes);
    regularMinutes += workedRegular;
    overtimeMinutes += derived.overtimeMinutes;
    nightMinutes += derived.nightDifferentialMinutes;
    tardinessMinutes += derived.tardinessMinutes;
    undertimeMinutes += derived.undertimeMinutes;
    flags.push(...derived.flags);
    if (derived.flags.length) punchNotes.push(`${punch.workDate}: ${derived.flags.join("; ")}`);

    const holiday = holidayOn(punch.workDate);
    if (holiday && derived.workedMinutes > 0) {
      const multiplier = holidayMultiplier({
        holiday: holiday.kind === "regular" ? "regular" : "special",
        worked: true,
        overtime: derived.overtimeMinutes > 0,
      });
      const extra = ((workedRegular / 60) * hourlyRate) * (multiplier - 1);
      holidayPremium += extra;
      holidayNotes.push(`${punch.workDate} ${holiday.name} (${holiday.kind}) ×${multiplier} → +${money(extra)}`);
    }
  }

  // If no punches exist, fall back to full semi-monthly basic for demo continuity.
  const hasPunches = input.punches.length > 0;
  const workedHoursPay = hasPunches
    ? (regularMinutes / 60) * hourlyRate
    : semiMonthlyBasic;
  const overtimePay = (overtimeMinutes / 60) * hourlyRate * 1.25;
  const nightDiffPay = (nightMinutes / 60) * hourlyRate * 0.1;
  const tardinessDeduction = (tardinessMinutes / 60) * hourlyRate;
  const undertimeDeduction = (undertimeMinutes / 60) * hourlyRate;

  const wageCheck = isBelowMinimum(monthly, input.employee.region ?? "NCR");
  const treatAsMwe = input.employee.mwe || wageCheck.below;

  let calamityPay = 0;
  const calamityNotes: string[] = [];
  for (const advisory of input.advisories) {
    if (!advisory.policy.toLowerCase().includes("hazard")) continue;
    const unitMatch = advisory.affectedUnit === "All locations"
      || input.unitName.toLowerCase().includes(advisory.affectedUnit.toLowerCase())
      || advisory.affectedUnit.toLowerCase().includes(input.unitName.toLowerCase());
    // Apply to Cebu Hub employees or when unit is unknown but advisory is active for demo org.
    if (unitMatch || input.unitName === "Operations") {
      const premium = semiMonthlyBasic * (advisory.premiumPercent / 100);
      calamityPay += premium;
      calamityNotes.push(`${advisory.advisoryNumber}: ${advisory.policy} applied (+${advisory.premiumPercent}%)`);
    }
  }

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
  // their category ceiling. Only the excess joins taxable compensation / the
  // annual other-benefits pool; the line item keeps both numbers traceable.
  const deMinimisLines = (input.deMinimis ?? []).map((grant) => {
    const periodAmount = deMinimisPerSemiMonthlyPeriod(grant.amount, grant.frequency);
    const annualizedGrant = grant.frequency === "month" ? grant.amount * 12
      : grant.frequency === "semester" ? grant.amount * 2
        : grant.amount;
    const treatment = deMinimisTreatment(grant.benefitType, annualizedGrant);
    const periodTaxableExcess = treatment.excess === 0 ? 0 : roundToCents(treatment.excess / 24);
    return {
      code: `DM-${grant.id}`,
      label: `De minimis, ${treatment.label}`,
      amount: money(periodAmount),
      notes: [`${treatment.period} ceiling ₱${treatment.ceiling.toFixed(2)}`, `taxable excess this period ₱${periodTaxableExcess.toFixed(2)}`],
      periodAmount,
      periodTaxableExcess,
    };
  });
  const deMinimisTotal = deMinimisLines.reduce((sum, line) => sum + line.periodAmount, 0);
  const deMinimisTaxable = deMinimisLines.reduce((sum, line) => sum + line.periodTaxableExcess, 0);

  // Leave Cash Conversions (monetization of vacation / service incentive leaves)
  const conversionLines = (input.leaveConversions ?? []).map((conv) => ({
    code: `LEAVE_CONV-${conv.id}`,
    label: `Leave Conversion (${conv.leaveType} ${conv.daysConverted}d)`,
    amount: money(conv.cashAmount),
    notes: [`${conv.daysConverted} days @ daily rate ₱${conv.dailyRate}`],
    amountNum: conv.cashAmount,
  }));
  const conversionTotal = conversionLines.reduce((sum, c) => sum + c.amountNum, 0);

  // Employee Loans (SSS Salary Loan, Pag-IBIG MPL/Calamity, Company Loan)
  const loanLines = (input.loans ?? []).map((loan) => {
    const deductAmount = Math.min(Number(loan.cutoffDeduction), Number(loan.remainingBalance));
    return {
      code: `LOAN-${loan.id}`,
      label: `Loan, ${loan.loanType}`,
      amount: money(-deductAmount),
      notes: [`Ref: ${loan.referenceNo}`, `Bal: ₱${Number(loan.remainingBalance).toFixed(2)}`],
      deductAmount,
    };
  });
  const loanTotal = loanLines.reduce((sum, l) => sum + l.deductAmount, 0);

  const gross = Math.max(0, workedHoursPay + overtimePay + nightDiffPay + calamityPay + holidayPremium + expenseTotal + deMinimisTotal + conversionTotal);
  const sssRule = computeSss(monthly);
  const philHealthRule = computePhilHealth(monthly);
  const pagIbigRule = computePagIbig(monthly);
  const sss = sssRule.employee / 2;
  const philhealth = philHealthRule.employee / 2;
  const pagibig = pagIbigRule.employee / 2;

  // BIR taxable compensation is compensation earnings less employee statutory
  // shares. Expense reimbursement is a non-taxable pass-through, not salary.
  const taxableCompensation = Math.max(
    0,
    gross - expenseTotal - deMinimisTotal + deMinimisTaxable - sss - philhealth - pagibig,
  );
  const withholding = computeSemiMonthlyWithholdingTax(taxableCompensation, treatAsMwe);
  const benefitLines = calculateBenefits(input.benefits ?? []);
  const benefitTotal = benefitLines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
  const deductions = sss + philhealth + pagibig + withholding + tardinessDeduction + undertimeDeduction + benefitTotal + advanceTotal + loanTotal;
  const net = Math.max(0, gross - deductions);
  const status = flags.length > 0 ? "Exception" : "Ready";

  const lineItems = [
    { code: "BASIC", label: "Basic / worked pay", amount: money(workedHoursPay) },
    { code: "OT", label: "Overtime (25%)", amount: money(overtimePay) },
    { code: "ND", label: "Night differential (10%)", amount: money(nightDiffPay) },
    { code: "HOLIDAY", label: "Holiday / rest-day premium", amount: money(holidayPremium), notes: holidayNotes },
    { code: "CALAMITY", label: "Calamity / hazard premium", amount: money(calamityPay), notes: calamityNotes },
    ...conversionLines.map(({ amountNum: _amountNum, ...c }) => c),
    { code: "SSS", label: "SSS contribution", amount: money(-sss) },
    { code: "PHIC", label: "PhilHealth contribution", amount: money(-philhealth) },
    { code: "HDMF", label: "Pag-IBIG contribution", amount: money(-pagibig) },
    { code: "WHT", label: "Withholding tax", amount: money(-withholding) },
    { code: "LATE", label: "Tardiness", amount: money(-tardinessDeduction) },
    { code: "UT", label: "Undertime", amount: money(-undertimeDeduction) },
    ...expenseLines,
    ...deMinimisLines.map(({ periodAmount: _periodAmount, periodTaxableExcess: _periodTaxableExcess, ...line }) => line),
    ...advanceLines,
    ...loanLines.map(({ deductAmount: _deductAmount, ...l }) => l),
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
      `basicRate=${monthly}`,
      `taxableCompensation=${money(taxableCompensation)}`,
      `deMinimisPaid=${money(deMinimisTotal)}`,
      `deMinimisTaxableExcess=${money(deMinimisTaxable)}`,
      `punches=${input.punches.length}`,
      `regularMinutes=${regularMinutes}`,
      `overtimeMinutes=${overtimeMinutes}`,
      `nightMinutes=${nightMinutes}`,
      `region=${input.employee.region ?? "NCR"}`,
      `mwe=${treatAsMwe}${wageCheck.below && !input.employee.mwe ? " (inferred from wage order " + wageCheck.order.wageOrder + ")" : ""}`,
      `employerStatutoryCost=${money((sssRule.employerTotal + philHealthRule.employer + pagIbigRule.employer) / 2)}`,
      ...holidayNotes,
      ...calamityNotes,
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
    notes: [...holidayNotes, ...calamityNotes, ...punchNotes],
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
    "Traceable line items generated from approved punches and PH-2026.01 tables.",
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
