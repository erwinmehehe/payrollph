import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeeLoans, employees, loanPayments } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import {
  nextLoanState, phpCents, pesoString,
  validManualRepayment, validateLoanRegistration,
} from "@/lib/loan-ledger-guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage employee loans.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const filter = employeeId > 0
    ? and(eq(employeeLoans.organizationId, organizationId), eq(employeeLoans.employeeId, employeeId))
    : eq(employeeLoans.organizationId, organizationId);

  const loans = await db.select({
    loan: employeeLoans,
    employee: employees,
  })
    .from(employeeLoans)
    .innerJoin(employees, eq(employeeLoans.employeeId, employees.id))
    .where(access.companyWide ? filter : and(filter, eq(employees.orgUnitId, access.orgUnitId!)))
    .orderBy(desc(employeeLoans.id));

  const loanIds = loans.map(({ loan }) => loan.id);
  const payments = loanIds.length > 0
    ? await db.select().from(loanPayments).where(inArray(loanPayments.loanId, loanIds)).orderBy(desc(loanPayments.paymentDate))
    : [];

  const paymentsByLoan = new Map<number, typeof payments>();
  for (const p of payments) {
    paymentsByLoan.set(p.loanId, [...(paymentsByLoan.get(p.loanId) ?? []), p]);
  }

  const totalOutstanding = loans
    .filter(({ loan }) => loan.status === "active")
    .reduce((sum, { loan }) => sum + Number(loan.remainingBalance), 0);

  return Response.json({
    loans: loans.map(({ loan, employee }) => ({
      ...loan,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      payments: paymentsByLoan.get(loan.id) ?? [],
    })),
    summary: {
      totalActiveLoans: loans.filter(({ loan }) => loan.status === "active").length,
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      totalPaidOff: loans.filter(({ loan }) => loan.status === "paid_off").length,
    },
  });
}

class LoanLedgerConflict extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

function manilaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const incoming: unknown = await request.json().catch(() => null);
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return Response.json({ error: "Expected a valid employee-loan JSON object." }, { status: 400 });
  }
  const body = incoming as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(employeeId) || employeeId <= 0) {
    return Response.json({ error: "Valid organization and employee are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll/finance operators may register loans that can deduct from wages.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      code: "LOAN_FINANCE_COMPANY_SCOPE_REQUIRED",
      error: "Registering a payroll-deducted loan requires company-wide finance/payroll authority.",
    }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "loan-deduction-registration",
    resourceId: employeeId, limit: 5, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const parsed = validateLoanRegistration(body);
  if (!parsed.ok) return Response.json({ code: parsed.code, error: parsed.error }, { status: 400 });
  const reg = parsed.value;

  try {
    const loan = await db.transaction(async tx => {
      // Serialize registrations by employer to prevent two simultaneous
      // requests from creating the same payroll-deducted loan reference.
      await tx.execute(sql`select pg_advisory_xact_lock(4532, ${organizationId})`);
      // Lock the worker before checking lifecycle state. A concurrent
      // separation cannot make an inactive worker eligible for a new loan.
      await tx.execute(sql`
        select id from employees
         where id = ${employeeId} and organization_id = ${organizationId}
         for update
      `);
      const [worker] = await tx.select().from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
      if (!worker) throw new LoanLedgerConflict("LOAN_WORKER_NOT_FOUND", "Worker does not belong to this employer.", 404);
      if (!["Active", "On leave"].includes(worker.status)) {
        throw new LoanLedgerConflict("LOAN_WORKER_NOT_ELIGIBLE",
          "A separating or separated worker cannot be enrolled in a new automatic payroll deduction. Review final-pay and existing debt separately.");
      }

      const [sameReference] = await tx.select({ id: employeeLoans.id }).from(employeeLoans)
        .where(and(
          eq(employeeLoans.organizationId, organizationId),
          eq(employeeLoans.employeeId, employeeId),
          eq(employeeLoans.loanType, reg.loanType),
          sql`lower(${employeeLoans.referenceNo}) = lower(${reg.referenceNo})`,
        )).limit(1);
      if (sameReference) {
        throw new LoanLedgerConflict("LOAN_REFERENCE_ALREADY_REGISTERED",
          "This employee already has a loan of this type with that reference. Reconcile it rather than activating duplicate payroll deductions.");
      }

      const [created] = await tx.insert(employeeLoans).values({
        organizationId,
        employeeId,
        loanType: reg.loanType,
        referenceNo: reg.referenceNo,
        principal: pesoString(reg.principalCents),
        monthlyAmortization: pesoString(reg.monthlyCents),
        cutoffDeduction: pesoString(reg.cutoffCents),
        remainingBalance: pesoString(reg.principalCents),
        totalPaid: "0.00",
        status: "active",
        startDate: reg.startDate,
        endDate: reg.endDate,
        notes: reg.notes || null,
      }).returning();

      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: "Employee loan registered with payroll deduction authority",
        resource: `Loan #${created.id} / ${worker.employeeNo}`.slice(0, 160),
        metadata: {
          loanId: created.id, employeeId, actorUserId: user.id,
          loanType: reg.loanType, referenceNo: reg.referenceNo,
          authorizationEvidenceReference: reg.authorizationEvidenceReference,
          principal: created.principal,
          monthlyAmortization: created.monthlyAmortization,
          cutoffDeduction: created.cutoffDeduction,
          startDate: reg.startDate, endDate: reg.endDate,
          requiresIndependentEvidenceVerification: true,
        },
      });
      return created;
    });
    return Response.json(loan, { status: 201 });
  } catch (error) {
    if (error instanceof LoanLedgerConflict) {
      return Response.json({ code: error.code, error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const incoming: unknown = await request.json().catch(() => null);
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return Response.json({ error: "Expected a valid loan action JSON object." }, { status: 400 });
  }
  const body = incoming as Record<string, unknown>;
  const id = Number(body.id);
  const action = body.action;
  if (!Number.isSafeInteger(id) || id <= 0
    || !["record_payment", "pause", "resume", "close"].includes(String(action))) {
    return Response.json({ error: "Valid loan id and record_payment, pause, resume or close action are required." }, { status: 400 });
  }

  const [loan] = await db.select().from(employeeLoans).where(eq(employeeLoans.id, id)).limit(1);
  if (!loan) return Response.json({ error: "Loan not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id, loan.organizationId, PAYROLL_OPERATOR_ROLES,
    "Only authorized finance/payroll staff can change loan payment or deduction state.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, loan.organizationId);
  if (!access?.companyWide) {
    return Response.json({
      code: "LOAN_FINANCE_COMPANY_SCOPE_REQUIRED",
      error: "Changing a wage deduction or recording repayments requires company-wide payroll/finance authority.",
    }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: `loan-finance-${String(action)}`,
    resourceId: id, limit: 8, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  // The reference is an independently issued receipt or bank transaction ID.
  // We never silently invent "Manual Payment" evidence for a financial write.
  const payment = action === "record_payment"
    ? validManualRepayment(body.amount, body.reference)
    : null;
  if (payment && !payment.ok) {
    return Response.json({
      code: "LOAN_MANUAL_REPAYMENT_INVALID",
      error: payment.error,
    }, { status: 400 });
  }

  try {
    const updated = await db.transaction(async tx => {
      await tx.execute(sql`
        select id from employee_loans
         where id = ${id} and organization_id = ${loan.organizationId}
         for update
      `);
      const [fresh] = await tx.select().from(employeeLoans)
        .where(and(eq(employeeLoans.id, id), eq(employeeLoans.organizationId, loan.organizationId))).limit(1);
      if (!fresh) throw new LoanLedgerConflict("LOAN_NO_LONGER_EXISTS", "The loan was removed while being reviewed.", 404);
      const remainingCents = phpCents(fresh.remainingBalance);
      const paidCents = phpCents(fresh.totalPaid);
      if (remainingCents == null || paidCents == null) {
        throw new LoanLedgerConflict("LOAN_LEDGER_INVALID",
          "Loan amount precision is invalid. Stop any deductions and reconcile the ledger before proceeding.");
      }

      if (action === "record_payment" && payment?.ok) {
        if (remainingCents === 0 || fresh.status === "paid_off") {
          throw new LoanLedgerConflict("LOAN_ALREADY_PAID",
            "The loan has no outstanding balance. A second repayment cannot be posted.");
        }
        if (payment.amountCents > remainingCents) {
          throw new LoanLedgerConflict("LOAN_PAYMENT_EXCEEDS_BALANCE",
            "The repayment exceeds the remaining loan balance. Verify the payment or use a separate refund/reconciliation case.", 422);
        }

        const [priorReference] = await tx.select({ id: loanPayments.id }).from(loanPayments)
          .where(and(eq(loanPayments.loanId, id),
            sql`lower(${loanPayments.reference}) = lower(${payment.reference})`)).limit(1);
        if (priorReference) {
          throw new LoanLedgerConflict("LOAN_REPAYMENT_REFERENCE_DUPLICATE",
            "This receipt/bank reference has already been recorded for this loan. Do not double-credit the same payment.");
        }

        const newBalance = remainingCents - payment.amountCents;
        const newPaid = paidCents + payment.amountCents;
        const [receipt] = await tx.insert(loanPayments).values({
          loanId: id,
          amount: pesoString(payment.amountCents),
          paymentDate: manilaDate(),
          reference: payment.reference,
        }).returning({ id: loanPayments.id });
        const [changed] = await tx.update(employeeLoans).set({
          remainingBalance: pesoString(newBalance),
          totalPaid: pesoString(newPaid),
          status: newBalance === 0 ? "paid_off" : fresh.status,
        }).where(and(
          eq(employeeLoans.id, id),
          eq(employeeLoans.organizationId, loan.organizationId),
          eq(employeeLoans.remainingBalance, fresh.remainingBalance),
          eq(employeeLoans.status, fresh.status),
        )).returning();
        if (!changed) {
          throw new LoanLedgerConflict("LOAN_REPAYMENT_STALE",
            "The loan balance changed before this payment could be recorded. Refresh and reconcile.");
        }
        await tx.insert(auditEvents).values({
          organizationId: loan.organizationId, actor: user.name,
          action: "External employee loan repayment verified and recorded",
          resource: `Loan #${id}`,
          metadata: {
            actorUserId: user.id, loanId: id, employeeId: fresh.employeeId,
            paymentId: receipt.id, amount: pesoString(payment.amountCents),
            oldBalance: fresh.remainingBalance, newBalance: changed.remainingBalance,
            paymentReference: payment.reference,
            evidenceIsOperatorAttestedNotBankVerified: true,
          },
        });
        return changed;
      }

      if (!["pause", "resume", "close"].includes(String(action))) {
        throw new LoanLedgerConflict("LOAN_ACTION_INVALID", "Unsupported loan action.", 400);
      }
      const [worker] = await tx.select({ status: employees.status }).from(employees)
        .where(and(eq(employees.id, fresh.employeeId), eq(employees.organizationId, loan.organizationId))).limit(1);
      if (!worker) throw new LoanLedgerConflict("LOAN_WORKER_NOT_FOUND", "Worker no longer belongs to this employer.", 404);
      const next = nextLoanState(
        action as "pause" | "resume" | "close",
        fresh.status, remainingCents, worker.status,
      );
      if (!next.ok) throw new LoanLedgerConflict(next.code, next.error);

      const [changed] = await tx.update(employeeLoans).set({ status: next.next })
        .where(and(
          eq(employeeLoans.id, id),
          eq(employeeLoans.organizationId, loan.organizationId),
          eq(employeeLoans.status, fresh.status),
          eq(employeeLoans.remainingBalance, fresh.remainingBalance),
        )).returning();
      if (!changed) throw new LoanLedgerConflict("LOAN_STATE_STALE", "Loan status changed. Refresh and try again.");
      await tx.insert(auditEvents).values({
        organizationId: loan.organizationId, actor: user.name,
        action: "Loan payroll-deduction state changed",
        resource: `Loan #${id}`,
        metadata: {
          actorUserId: user.id, loanId: id,
          employeeId: fresh.employeeId,
          action, previousStatus: fresh.status,
          nextStatus: changed.status,
          remainingBalance: fresh.remainingBalance,
        },
      });
      return changed;
    });
    return Response.json(updated);
  } catch (error) {
    if (error instanceof LoanLedgerConflict) {
      return Response.json({ code: error.code, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
