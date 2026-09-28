import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  earnedWageRequests,
  employeeLoans,
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

export async function settlePayrollRun(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw new Error("Payroll run not found.");

  const entries = await db
    .select()
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, run.id));

  let expensesSettled = 0;
  let advancesSettled = 0;
  let loanPaymentsSettled = 0;
  let leaveConversionsSettled = 0;

  for (const entry of entries) {
    for (const line of storedLines(entry.lineItems)) {
      const expenseId = numericId(line.code, "EXP-");
      if (expenseId) {
        const [claim] = await db
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
        await db.update(expenseClaims)
          .set({ status: "paid", payrollRunId: run.id })
          .where(eq(expenseClaims.id, expenseId));
        expensesSettled += 1;
        continue;
      }

      const advanceId = numericId(line.code, "EWA-");
      if (advanceId) {
        const [advance] = await db
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
        await db.update(earnedWageRequests)
          .set({ status: "repaid", payrollRunId: run.id })
          .where(eq(earnedWageRequests.id, advanceId));
        advancesSettled += 1;
        continue;
      }

      const conversionId = numericId(line.code, "LEAVE_CONV-");
      if (conversionId) {
        const [conversion] = await db
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
        await db.update(leaveConversions)
          .set({ status: "paid", payrollRunId: run.id })
          .where(eq(leaveConversions.id, conversionId));
        leaveConversionsSettled += 1;
        continue;
      }

      const loanId = numericId(line.code, "LOAN-");
      if (loanId) {
        const plannedDeduction = Math.abs(line.amount);
        if (plannedDeduction <= 0) continue;

        const [existingPayment] = await db
          .select()
          .from(loanPayments)
          .where(and(
            eq(loanPayments.loanId, loanId),
            eq(loanPayments.payrollRunId, run.id),
          ))
          .limit(1);
        if (existingPayment) continue;

        const [loan] = await db
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

        await db.insert(loanPayments).values({
          loanId,
          payrollRunId: run.id,
          amount: money(plannedDeduction),
          paymentDate: run.payDate,
          reference: `Auto-deduct ${run.periodLabel}`,
        });

        const newBalance = Math.max(0, remaining - plannedDeduction);
        const newPaid = Number(loan.totalPaid) + plannedDeduction;
        await db.update(employeeLoans)
          .set({
            remainingBalance: money(newBalance),
            totalPaid: money(newPaid),
            status: newBalance <= 0 ? "paid_off" : "active",
          })
          .where(eq(employeeLoans.id, loanId));
        loanPaymentsSettled += 1;
      }
    }
  }

  return {
    expensesSettled,
    advancesSettled,
    loanPaymentsSettled,
    leaveConversionsSettled,
  };
}
