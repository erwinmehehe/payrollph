import { and, eq, inArray, isNull, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { ensureEmployeePayHistory } from "@/lib/pay-basis-schema";
import { buildPaySegments } from "@/lib/pay-history";
import {
  auditEvents,
  earnedWageRequests,
  employeeLoans,
  employeePayAdjustments,
  employeePayProfiles,
  employeePayRateChanges,
  employees,
  expenseClaims,
  leaveConversions,
  loanPayments,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function storedLines(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ code: string; amount: number }>;
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.code !== "string") return [];
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) return [];
    return [{ code: row.code, amount }];
  });
}

function numericId(code: string, prefix: string) {
  if (!code.startsWith(prefix)) return null;
  const id = Number(code.slice(prefix.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

type PaymentSnapshot = {
  employeeName: string;
  employeeNo: string;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
};

function readPaymentSnapshot(value: unknown): PaymentSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payment = (value as Record<string, unknown>).payment;
  if (!payment || typeof payment !== "object") return null;
  const row = payment as Record<string, unknown>;
  const employeeName = typeof row.employeeName === "string" ? row.employeeName.trim() : "";
  const employeeNo = typeof row.employeeNo === "string" ? row.employeeNo.trim() : "";
  if (!employeeName || !employeeNo) return null;
  const nullable = (field: unknown) => typeof field === "string" && field.trim() ? field.trim() : null;
  return {
    employeeName,
    employeeNo,
    bankAccount: nullable(row.bankAccount),
    bankCode: nullable(row.bankCode),
    mobile: nullable(row.mobile),
  };
}

function samePaymentValue(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").trim() === (right ?? "").trim();
}

type PayProfileSnapshot = {
  payBasis: string;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
  monthlyEquivalent: number;
};

function readPayProfileSnapshot(value: unknown): PayProfileSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payProfile = (value as Record<string, unknown>).payProfile;
  if (!payProfile || typeof payProfile !== "object") return null;
  const row = payProfile as Record<string, unknown>;
  const payBasis = typeof row.payBasis === "string" ? row.payBasis.trim() : "";
  const rateAmount = Number(row.rateAmount);
  const standardWorkDaysPerMonth = Number(row.standardWorkDaysPerMonth);
  const standardHoursPerDay = Number(row.standardHoursPerDay);
  const monthlyEquivalent = Number(row.monthlyEquivalent);
  if (
    !payBasis ||
    !Number.isFinite(rateAmount) ||
    !Number.isFinite(standardWorkDaysPerMonth) ||
    !Number.isFinite(standardHoursPerDay) ||
    !Number.isFinite(monthlyEquivalent)
  ) return null;
  return { payBasis, rateAmount, standardWorkDaysPerMonth, standardHoursPerDay, monthlyEquivalent };
}

function samePayrollNumber(left: string | number | null | undefined, right: string | number | null | undefined) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
}

type PaySegmentSnapshot = {
  start: string;
  end: string;
  payBasis: string;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
};

function readPaySegmentsSnapshot(value: unknown): PaySegmentSnapshot[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>).paySegments;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rows: PaySegmentSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const start = typeof row.start === "string" ? row.start : "";
    const end = typeof row.end === "string" ? row.end : "";
    const payBasis = typeof row.payBasis === "string" ? row.payBasis : "";
    const rateAmount = Number(row.rateAmount);
    const standardWorkDaysPerMonth = Number(row.standardWorkDaysPerMonth);
    const standardHoursPerDay = Number(row.standardHoursPerDay);
    if (!start || !end || !payBasis || !Number.isFinite(rateAmount) || !Number.isFinite(standardWorkDaysPerMonth) || !Number.isFinite(standardHoursPerDay)) {
      return null;
    }
    rows.push({ start, end, payBasis, rateAmount, standardWorkDaysPerMonth, standardHoursPerDay });
  }
  return rows;
}

function samePaySegments(left: PaySegmentSnapshot[], right: PaySegmentSnapshot[]) {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const other = right[index];
    return segment.start === other.start &&
      segment.end === other.end &&
      segment.payBasis === other.payBasis &&
      samePayrollNumber(segment.rateAmount, other.rateAmount) &&
      samePayrollNumber(segment.standardWorkDaysPerMonth, other.standardWorkDaysPerMonth) &&
      samePayrollNumber(segment.standardHoursPerDay, other.standardHoursPerDay);
  });
}

/**
 * Settles every payroll-linked sub-ledger and flips the run to Released in one
 * database transaction. Any stale expense, advance, leave conversion, or loan
 * aborts the whole transaction so a run can never be half-settled.
 *
 * The release route claims Ready for release -> Releasing before calling this
 * function. That outer claim prevents concurrent release requests; this
 * transaction makes the financial mutations and final state atomic.
 */
export async function settlePayrollRun(
  runId: number,
  releaseAudit?: {
    actor: string;
    resource: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [preflightRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!preflightRun) throw new Error("Payroll run not found.");
  await ensureEmployeePayHistory(preflightRun.organizationId);

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
    if (!run) throw new Error("Payroll run not found.");
    if (run.status !== "Releasing") {
      throw new Error("Payroll run is no longer in the releasing state.");
    }

    const entries = await tx
      .select()
      .from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id));

    if (entries.length !== run.employeeCount) {
      throw new Error("Payroll register no longer matches the calculated employee count; recalculate before release.");
    }

    const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
    const currentEmployees = employeeIds.length
      ? await tx.select().from(employees).where(and(
          eq(employees.organizationId, run.organizationId),
          inArray(employees.id, employeeIds),
        ))
      : [];
    const employeeById = new Map(currentEmployees.map((employee) => [employee.id, employee]));
    const [currentPayProfiles, payHistoryRows, pendingPayAdjustments] = employeeIds.length
      ? await Promise.all([
          tx.select().from(employeePayProfiles).where(and(
            eq(employeePayProfiles.organizationId, run.organizationId),
            inArray(employeePayProfiles.employeeId, employeeIds),
          )),
          tx.select().from(employeePayRateChanges).where(and(
            eq(employeePayRateChanges.organizationId, run.organizationId),
            inArray(employeePayRateChanges.employeeId, employeeIds),
            lte(employeePayRateChanges.effectiveFrom, run.periodEnd),
          )),
          tx.select().from(employeePayAdjustments).where(and(
            eq(employeePayAdjustments.organizationId, run.organizationId),
            inArray(employeePayAdjustments.employeeId, employeeIds),
            eq(employeePayAdjustments.status, "pending"),
            lt(employeePayAdjustments.serviceThrough, run.periodStart),
          )),
        ])
      : [[], [], []] as const;
    const payProfileByEmployee = new Map(currentPayProfiles.map((profile) => [profile.employeeId, profile]));
    const payHistoryByEmployee = new Map<number, typeof payHistoryRows>();
    for (const change of payHistoryRows) {
      payHistoryByEmployee.set(change.employeeId, [...(payHistoryByEmployee.get(change.employeeId) ?? []), change]);
    }

    const retroIdsInRegister = new Set<number>();
    for (const entry of entries) {
      for (const line of storedLines(entry.lineItems)) {
        const retroId = numericId(line.code, "RETRO_BASIC-");
        if (retroId) retroIdsInRegister.add(retroId);
      }
    }
    const unrepresentedPendingRetro = pendingPayAdjustments.filter((adjustment) => !retroIdsInRegister.has(adjustment.id));
    if (unrepresentedPendingRetro.length > 0) {
      throw new Error("A new retroactive pay adjustment was created after calculation; recalculate before release.");
    }

    for (const entry of entries) {
      const employee = employeeById.get(entry.employeeId);
      if (!employee) {
        throw new Error(`Employee #${entry.employeeId} no longer belongs to this payroll workspace; recalculate before release.`);
      }
      if (employee.status !== "Active") {
        throw new Error(
          `${employee.firstName} ${employee.lastName} is now ${employee.status}; recalculate before release so non-active employees are excluded.`,
        );
      }

      const snapshot = readPaymentSnapshot(entry.trace);
      if (!snapshot) {
        throw new Error(
          `Payroll entry for ${employee.firstName} ${employee.lastName} lacks an immutable payment snapshot; recalculate before release.`,
        );
      }

      if (!snapshot.bankAccount && !snapshot.mobile) {
        throw new Error(
          `${snapshot.employeeName} has no captured bank account or mobile payout destination; add one and recalculate before release.`,
        );
      }

      const currentName = `${employee.firstName} ${employee.lastName}`.trim();
      const paymentChanged =
        !samePaymentValue(snapshot.employeeName, currentName) ||
        !samePaymentValue(snapshot.employeeNo, employee.employeeNo) ||
        !samePaymentValue(snapshot.bankAccount, employee.bankAccount) ||
        !samePaymentValue(snapshot.bankCode, employee.bankCode) ||
        !samePaymentValue(snapshot.mobile, employee.mobile);

      if (paymentChanged) {
        throw new Error(
          `Payment instructions for ${currentName} changed after calculation; recalculate before release so the approved register and payout file stay aligned.`,
        );
      }

      const paySnapshot = readPayProfileSnapshot(entry.trace);
      const paySegmentsSnapshot = readPaySegmentsSnapshot(entry.trace);
      if (!paySnapshot || !paySegmentsSnapshot) {
        throw new Error(
          `Payroll entry for ${currentName} lacks an immutable effective-pay snapshot; recalculate before release.`,
        );
      }
      const currentPayProfile = payProfileByEmployee.get(entry.employeeId);
      if (!currentPayProfile) {
        throw new Error(
          `Pay profile for ${currentName} is missing; configure it and recalculate before release.`,
        );
      }
      const expectedSegments = buildPaySegments({
        fallback: {
          payBasis: currentPayProfile.payBasis,
          rateAmount: currentPayProfile.rateAmount,
          standardWorkDaysPerMonth: currentPayProfile.standardWorkDaysPerMonth,
          standardHoursPerDay: currentPayProfile.standardHoursPerDay,
        },
        changes: (payHistoryByEmployee.get(entry.employeeId) ?? []).map((change) => ({
          id: change.id,
          effectiveFrom: String(change.effectiveFrom),
          payBasis: change.payBasis,
          rateAmount: change.rateAmount,
          standardWorkDaysPerMonth: change.standardWorkDaysPerMonth,
          standardHoursPerDay: change.standardHoursPerDay,
        })),
        periodStart: String(run.periodStart),
        periodEnd: String(run.periodEnd),
      }).map((segment) => ({
        start: segment.start,
        end: segment.end,
        payBasis: segment.profile.payBasis,
        rateAmount: segment.profile.rateAmount,
        standardWorkDaysPerMonth: segment.profile.standardWorkDaysPerMonth,
        standardHoursPerDay: segment.profile.standardHoursPerDay,
      }));

      if (!samePaySegments(paySegmentsSnapshot, expectedSegments)) {
        throw new Error(
          `Pay history for ${currentName} changed after calculation; recalculate before release so the approved register uses the effective rates for this cutoff.`,
        );
      }
    }

    let expensesSettled = 0;
    let advancesSettled = 0;
    let loanPaymentsSettled = 0;
    let leaveConversionsSettled = 0;
    let retroAdjustmentsSettled = 0;

    for (const entry of entries) {
      for (const line of storedLines(entry.lineItems)) {
        const retroAdjustmentId = numericId(line.code, "RETRO_BASIC-");
        if (retroAdjustmentId) {
          const [adjustment] = await tx.select().from(employeePayAdjustments).where(and(
            eq(employeePayAdjustments.id, retroAdjustmentId),
            eq(employeePayAdjustments.organizationId, run.organizationId),
          )).limit(1);
          if (!adjustment || adjustment.employeeId !== entry.employeeId) {
            throw new Error(`Retro pay adjustment ${retroAdjustmentId} no longer matches this payroll entry.`);
          }
          if (adjustment.status !== "pending" || adjustment.payrollRunId != null) {
            throw new Error(`Retro pay adjustment ${retroAdjustmentId} is no longer pending; recalculate before release.`);
          }
          if (!samePayrollNumber(adjustment.amount, line.amount)) {
            throw new Error(`Retro pay adjustment ${retroAdjustmentId} amount changed after calculation; recalculate before release.`);
          }
          const [settledAdjustment] = await tx.update(employeePayAdjustments)
            .set({ status: "paid", payrollRunId: run.id, paidAt: new Date() })
            .where(and(
              eq(employeePayAdjustments.id, retroAdjustmentId),
              eq(employeePayAdjustments.status, "pending"),
              isNull(employeePayAdjustments.payrollRunId),
            ))
            .returning({ id: employeePayAdjustments.id });
          if (!settledAdjustment) {
            throw new Error(`Retro pay adjustment ${retroAdjustmentId} changed while payroll was being released; recalculate before release.`);
          }
          retroAdjustmentsSettled += 1;
          continue;
        }

        const expenseId = numericId(line.code, "EXP-");
        if (expenseId) {
          const [claim] = await tx
            .select()
            .from(expenseClaims)
            .where(and(
              eq(expenseClaims.id, expenseId),
              eq(expenseClaims.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!claim || claim.employeeId !== entry.employeeId) {
            throw new Error(`Expense claim ${expenseId} no longer matches this payroll entry.`);
          }
          if (claim.payrollRunId != null && claim.payrollRunId !== run.id) {
            throw new Error(`Expense claim ${expenseId} was already settled by another payroll run.`);
          }
          if (claim.payrollRunId === run.id && claim.status === "paid") continue;
          if (claim.status !== "approved") {
            throw new Error(`Expense claim ${expenseId} is no longer approved for payment.`);
          }
          const [settledClaim] = await tx.update(expenseClaims)
            .set({ status: "paid", payrollRunId: run.id })
            .where(and(
              eq(expenseClaims.id, expenseId),
              eq(expenseClaims.organizationId, run.organizationId),
              eq(expenseClaims.status, "approved"),
              isNull(expenseClaims.payrollRunId),
            ))
            .returning({ id: expenseClaims.id });
          if (!settledClaim) {
            throw new Error(`Expense claim ${expenseId} changed while payroll was being released; recalculate before release.`);
          }
          expensesSettled += 1;
          continue;
        }

        const advanceId = numericId(line.code, "EWA-");
        if (advanceId) {
          const [advance] = await tx
            .select()
            .from(earnedWageRequests)
            .where(and(
              eq(earnedWageRequests.id, advanceId),
              eq(earnedWageRequests.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!advance || advance.employeeId !== entry.employeeId) {
            throw new Error(`Earned-wage advance ${advanceId} no longer matches this payroll entry.`);
          }
          if (advance.payrollRunId != null && advance.payrollRunId !== run.id) {
            throw new Error(`Earned-wage advance ${advanceId} was already recovered by another payroll run.`);
          }
          if (advance.payrollRunId === run.id && advance.status === "repaid") continue;
          if (advance.status !== "approved") {
            throw new Error(`Earned-wage advance ${advanceId} is no longer approved for recovery.`);
          }
          const [settledAdvance] = await tx.update(earnedWageRequests)
            .set({ status: "repaid", payrollRunId: run.id })
            .where(and(
              eq(earnedWageRequests.id, advanceId),
              eq(earnedWageRequests.organizationId, run.organizationId),
              eq(earnedWageRequests.status, "approved"),
              isNull(earnedWageRequests.payrollRunId),
            ))
            .returning({ id: earnedWageRequests.id });
          if (!settledAdvance) {
            throw new Error(`Earned-wage advance ${advanceId} changed while payroll was being released; recalculate before release.`);
          }
          advancesSettled += 1;
          continue;
        }

        const conversionId = numericId(line.code, "LEAVE_CONV-");
        if (conversionId) {
          const [conversion] = await tx
            .select()
            .from(leaveConversions)
            .where(and(
              eq(leaveConversions.id, conversionId),
              eq(leaveConversions.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!conversion || conversion.employeeId !== entry.employeeId) {
            throw new Error(`Leave conversion ${conversionId} no longer matches this payroll entry.`);
          }
          if (conversion.payrollRunId != null && conversion.payrollRunId !== run.id) {
            throw new Error(`Leave conversion ${conversionId} was already settled by another payroll run.`);
          }
          if (conversion.payrollRunId === run.id && conversion.status === "paid") continue;
          if (conversion.status !== "approved") {
            throw new Error(`Leave conversion ${conversionId} is no longer approved for payment.`);
          }
          const [settledConversion] = await tx.update(leaveConversions)
            .set({ status: "paid", payrollRunId: run.id })
            .where(and(
              eq(leaveConversions.id, conversionId),
              eq(leaveConversions.organizationId, run.organizationId),
              eq(leaveConversions.status, "approved"),
              isNull(leaveConversions.payrollRunId),
            ))
            .returning({ id: leaveConversions.id });
          if (!settledConversion) {
            throw new Error(`Leave conversion ${conversionId} changed while payroll was being released; recalculate before release.`);
          }
          leaveConversionsSettled += 1;
          continue;
        }

        const loanId = numericId(line.code, "LOAN-");
        if (loanId) {
          const plannedDeduction = Math.abs(line.amount);
          if (plannedDeduction <= 0) continue;

          const [existingPayment] = await tx
            .select()
            .from(loanPayments)
            .where(and(
              eq(loanPayments.loanId, loanId),
              eq(loanPayments.payrollRunId, run.id),
            ))
            .limit(1);
          if (existingPayment) continue;

          const [loan] = await tx
            .select()
            .from(employeeLoans)
            .where(and(
              eq(employeeLoans.id, loanId),
              eq(employeeLoans.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!loan || loan.employeeId !== entry.employeeId) {
            throw new Error(`Loan ${loanId} no longer matches this payroll entry.`);
          }
          if (loan.status !== "active") {
            throw new Error(`Loan ${loanId} is no longer active; recalculate payroll before release.`);
          }

          const remaining = Number(loan.remainingBalance);
          if (plannedDeduction > remaining + 0.01) {
            throw new Error(`Loan ${loanId} balance changed after calculation; recalculate payroll before release.`);
          }

          await tx.insert(loanPayments).values({
            loanId,
            payrollRunId: run.id,
            amount: money(plannedDeduction),
            paymentDate: run.payDate,
            reference: `Auto-deduct ${run.periodLabel}`,
          });

          const newBalance = Math.max(0, remaining - plannedDeduction);
          const newPaid = Number(loan.totalPaid) + plannedDeduction;
          const [updatedLoan] = await tx.update(employeeLoans)
            .set({
              remainingBalance: money(newBalance),
              totalPaid: money(newPaid),
              status: newBalance <= 0 ? "paid_off" : "active",
            })
            .where(and(
              eq(employeeLoans.id, loanId),
              eq(employeeLoans.organizationId, run.organizationId),
              eq(employeeLoans.status, "active"),
              eq(employeeLoans.remainingBalance, loan.remainingBalance),
            ))
            .returning({ id: employeeLoans.id });
          if (!updatedLoan) {
            throw new Error(`Loan ${loanId} balance changed while payroll was being released; recalculate before release.`);
          }
          loanPaymentsSettled += 1;
        }
      }
    }

    const [released] = await tx.update(payrollRuns)
      .set({ status: "Released" })
      .where(and(
        eq(payrollRuns.id, runId),
        eq(payrollRuns.status, "Releasing"),
      ))
      .returning();

    if (!released) {
      throw new Error("Payroll release state changed during settlement.");
    }

    const settlement = {
      expensesSettled,
      advancesSettled,
      loanPaymentsSettled,
      leaveConversionsSettled,
    };

    // The release audit is part of the same transaction as the ledger changes.
    // A release is not considered committed if its audit record cannot be written.
    if (releaseAudit) {
      await tx.insert(auditEvents).values({
        organizationId: run.organizationId,
        actor: releaseAudit.actor,
        action: "Payroll released",
        resource: releaseAudit.resource,
        metadata: {
          ...(releaseAudit.metadata ?? {}),
          settlement,
        },
      });
    }

    return {
      run: released,
      settlement,
    };
  });
}
