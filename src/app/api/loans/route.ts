import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeeLoans, employees, loanPayments, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole, getAccess,
  PAYROLL_OPERATOR_ROLES, PAYROLL_TAX_APPROVER_ROLES,
  PAYROLL_VIEW_ROLES, PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  activeLoanPayrollConflict, approvedPayrollLoanType, externalLoanPaymentReference,
  independentLoanReviewer, loanApprovalReference, moneyFromCents, parseLoanCents, validLoanDate,
} from "@/lib/payroll-loan-approval";

export const dynamic = "force-dynamic";

const DECISION_ACTIONS = new Set(["approve", "reject", "resume"]);
const ACTIONS = new Set(["approve", "reject", "record_payment", "pause", "resume", "close"]);
const MAX_AMORTIZATION_CENTS = 9_999_999_999;
const todayPh = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

function isPositiveId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function reviewReason(value: unknown, minimum = 20): string | null {
  const reason = typeof value === "string" ? value.trim() : "";
  return reason.length >= minimum && reason.length <= 500 ? reason : null;
}

function deniedBusinessAction(message: string, code: string, status = 409) {
  return Response.json({ code, error: message }, { status });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);
  if (!isPositiveId(organizationId) || (employeeId !== 0 && !isPositiveId(employeeId))) {
    return Response.json({ error: "A valid organizationId and optional employeeId are required." }, { status: 400 });
  }
  // Preserve custom permission-set checks: payroll viewers and HR People
  // administrators use their existing mapped RBAC gates, not an unrecognized
  // merged role list that would silently skip roleGateAllowed.
  const viewer = await getAccess(user.id, organizationId);
  if (!viewer) return Response.json({ error: "No workspace membership." }, { status: 403 });
  const denied = await assertOrganizationRole(
    user.id, organizationId, viewer.role === "hr" ? PEOPLE_ADMIN_ROLES : PAYROLL_VIEW_ROLES,
    "Payroll, People administrators and independent loan checkers only.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "No workspace membership." }, { status: 403 });

  const filter = employeeId
    ? and(eq(employeeLoans.organizationId, organizationId), eq(employeeLoans.employeeId, employeeId))
    : eq(employeeLoans.organizationId, organizationId);
  const rows = await db.select({ loan: employeeLoans, employee: employees })
    .from(employeeLoans)
    .innerJoin(employees, and(
      eq(employeeLoans.employeeId, employees.id),
      eq(employeeLoans.organizationId, employees.organizationId),
    ))
    .where(access.companyWide ? filter : and(filter, eq(employees.orgUnitId, access.orgUnitId!)))
    .orderBy(desc(employeeLoans.id));
  const loanIds = rows.map(row => row.loan.id);
  const payments = loanIds.length
    ? await db.select().from(loanPayments)
      .where(inArray(loanPayments.loanId, loanIds))
      .orderBy(desc(loanPayments.paymentDate))
    : [];
  const paymentsByLoan = new Map<number, typeof payments>();
  for (const payment of payments) {
    paymentsByLoan.set(payment.loanId, [...(paymentsByLoan.get(payment.loanId) ?? []), payment]);
  }
  return Response.json({
    currentUserId: user.id,
    loanActivationEnabled: process.env.PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED === "true",
    reviewerEligible: access.companyWide && PAYROLL_TAX_APPROVER_ROLES.includes(access.role as "owner" | "admin" | "checker"),
    operatorEligible: access.companyWide && PAYROLL_OPERATOR_ROLES.includes(access.role as "owner" | "admin" | "bookkeeper" | "payroll"),
    companyWide: access.companyWide,
    loans: rows.map(({ loan, employee }) => ({
      ...loan,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      payments: paymentsByLoan.get(loan.id) ?? [],
    })),
    summary: {
      totalActiveLoans: rows.filter(row => row.loan.status === "active").length,
      totalPendingApproval: rows.filter(row => row.loan.status === "pending_approval").length,
      totalOutstanding: rows
        .filter(row => row.loan.status === "active")
        .reduce((sum, row) => sum + Number(row.loan.remainingBalance), 0),
      totalPaidOff: rows.filter(row => row.loan.status === "paid_off").length,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  if (!isPositiveId(organizationId) || !isPositiveId(employeeId)) {
    return Response.json({ error: "A valid company and employee are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll operators may request an employee deduction schedule.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return deniedBusinessAction("Only a company-wide payroll operator can submit a new deduction schedule.", "LOAN_COMPANY_SCOPE_REQUIRED", 403);
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "loan-deduction-request",
    resourceId: employeeId, limit: 5, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const loanType = String(body.loanType ?? "").trim();
  const referenceNo = String(body.referenceNo ?? "").trim();
  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const authorization = loanApprovalReference(body.deductionAuthorizationReference);
  const principalCents = parseLoanCents(body.principal);
  const monthlyCents = parseLoanCents(body.monthlyAmortization, MAX_AMORTIZATION_CENTS);
  const cutoffCents = body.cutoffDeduction == null || body.cutoffDeduction === ""
    ? (monthlyCents == null ? null : Math.round(monthlyCents / 2))
    : parseLoanCents(body.cutoffDeduction, MAX_AMORTIZATION_CENTS);
  if (
    !loanType || !approvedPayrollLoanType(loanType) || loanType.length > 64
    || referenceNo.length < 4 || referenceNo.length > 64
    || !validLoanDate(startDate) || (endDate && (!validLoanDate(endDate) || endDate < startDate))
    || !authorization || notes.length > 2000
    || principalCents == null || monthlyCents == null || cutoffCents == null
    || cutoffCents < 1 || cutoffCents > principalCents
  ) {
    return Response.json({
      error: "Provide the source loan/agency reference, documented deduction authority, valid term dates, and positive centavo-exact principal and amortizations. Monthly and cutoff amounts must fit the loan balance.",
    }, { status: 400 });
  }

  try {
    const created = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(4304, ${employeeId})`);
      const [worker] = await tx.select().from(employees).where(and(
        eq(employees.organizationId, organizationId), eq(employees.id, employeeId),
      )).limit(1);
      if (!worker || !["Active", "On leave"].includes(worker.status)) {
        throw new Error("LOAN_EMPLOYEE_UNAVAILABLE");
      }
      const existing = await tx.select({
        id: employeeLoans.id, referenceNo: employeeLoans.referenceNo,
      }).from(employeeLoans).where(and(
        eq(employeeLoans.organizationId, organizationId),
        eq(employeeLoans.employeeId, employeeId),
      ));
      if (existing.some(row => row.referenceNo.toLowerCase() === referenceNo.toLowerCase())) {
        throw new Error("LOAN_DUPLICATE_REFERENCE");
      }
      // The payroll engine selects ONLY status='active'. Creating the
      // request never starts a payroll deduction, even with a past date.
      const [loan] = await tx.insert(employeeLoans).values({
        organizationId, employeeId, loanType, referenceNo,
        principal: moneyFromCents(principalCents),
        monthlyAmortization: moneyFromCents(monthlyCents),
        cutoffDeduction: moneyFromCents(cutoffCents),
        remainingBalance: moneyFromCents(principalCents),
        totalPaid: "0.00",
        status: "pending_approval",
        requestedByUserId: user.id,
        deductionAuthorizationReference: authorization,
        startDate, endDate: endDate || null, notes,
      }).returning();
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: "Employee loan deduction submitted for independent review",
        resource: `${loan.loanType} #${loan.id}`.slice(0, 160),
        metadata: {
          loanId: loan.id, employeeId, makerUserId: user.id,
          externalReference: referenceNo, sourceAuthorizationReference: authorization,
          principal: loan.principal, monthlyAmortization: loan.monthlyAmortization,
          cutoffDeduction: loan.cutoffDeduction, startDate, endDate: endDate || null,
          activated: false,
        },
      });
      return loan;
    });
    return Response.json({
      ...created,
      nextAction: "Independent payroll checker must verify the source authorization and legal basis before activating a deduction.",
    }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "LOAN_EMPLOYEE_UNAVAILABLE") {
      return deniedBusinessAction("Worker is not eligible for a new loan schedule. Use the relevant separation or migration process.", code);
    }
    if (code === "LOAN_DUPLICATE_REFERENCE") {
      return deniedBusinessAction("This worker already has a pending/active loan with the same source reference.", code);
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "");
  if (!isPositiveId(id) || !ACTIONS.has(action)) {
    return Response.json({ error: "A valid loan and explicit supported action are required." }, { status: 400 });
  }
  const [loan] = await db.select().from(employeeLoans).where(eq(employeeLoans.id, id)).limit(1);
  if (!loan) return Response.json({ error: "Loan not found." }, { status: 404 });

  const approverAction = DECISION_ACTIONS.has(action);
  const denied = await assertOrganizationRole(
    user.id, loan.organizationId,
    approverAction ? PAYROLL_TAX_APPROVER_ROLES : PAYROLL_OPERATOR_ROLES,
    approverAction
      ? "An independent payroll/tax reviewer must approve, reject or resume payroll deductions."
      : "A company-wide payroll operator is required to maintain loan evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, loan.organizationId);
  if (!access?.companyWide) {
    return deniedBusinessAction("Employee money-bearing loan changes require company-wide finance permission.", "LOAN_COMPANY_SCOPE_REQUIRED", 403);
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: `employee-loan-${action}`,
    resourceId: id, limit: 8, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  // These decisions can withhold earned wages. Deployment alone must not
  // make a new automatic-deduction path money-bearing. Pending requests,
  // audit, rejection, emergency pause and external repayment remain usable.
  if (["approve", "resume"].includes(action)
    && process.env.PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED !== "true") {
    return deniedBusinessAction(
      "Loan deduction activation is locked until the independent payroll, legal, security and controlled-pilot release gates have approved it.",
      "LOAN_DEDUCTION_ACTIVATION_NOT_CERTIFIED",
    );
  }

  const reviewerRef = approverAction && action !== "reject"
    ? loanApprovalReference(body.reviewEvidenceReference) : null;
  const reason = reviewReason(body.reviewReason, ["approve", "reject", "resume"].includes(action) ? 20 : 8);
  const paymentRef = externalLoanPaymentReference(body.reference) ?? "";
  const paymentCents = action === "record_payment"
    ? parseLoanCents(body.amount, MAX_AMORTIZATION_CENTS) : null;
  if (
    (approverAction && !reason)
    || ((action === "approve" || action === "resume") && !reviewerRef)
    || (["pause", "close"].includes(action) && !reason)
    || (action === "record_payment" && (
      paymentCents == null || paymentRef.length < 8 || paymentRef.length > 120
    ))
  ) {
    return Response.json({
      error: "Record a source/independent review reason, and for approval a reviewer reference; external payments require an 8-120 character verified payment record. Exact positive centavos only.",
    }, { status: 400 });
  }

  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM employee_loans
        WHERE id = ${id} AND organization_id = ${loan.organizationId} FOR UPDATE`);
      const [fresh] = await tx.select().from(employeeLoans).where(and(
        eq(employeeLoans.id, id), eq(employeeLoans.organizationId, loan.organizationId),
      )).limit(1);
      if (!fresh) throw new Error("LOAN_NOT_FOUND");
      const [worker] = await tx.select({
        id: employees.id, orgUnitId: employees.orgUnitId, status: employees.status,
      }).from(employees).where(and(
        eq(employees.id, fresh.employeeId), eq(employees.organizationId, fresh.organizationId),
      )).limit(1);
      if (!worker) throw new Error("LOAN_EMPLOYEE_UNAVAILABLE");

      let nextStatus = fresh.status;
      let paymentAmount: string | null = null;
      const metadata: Record<string, unknown> = {
        loanId: id, employeeId: fresh.employeeId,
        previousStatus: fresh.status, actorUserId: user.id,
        makerUserId: fresh.requestedByUserId,
        originalAuthorizationReference: fresh.deductionAuthorizationReference,
      };

      if (action === "approve" || action === "resume") {
        if (fresh.status !== (action === "approve" ? "pending_approval" : "paused")) {
          throw new Error("LOAN_REVIEW_STATE_CHANGED");
        }
        const separated = independentLoanReviewer(fresh.requestedByUserId, user.id);
        if (separated) throw new Error(separated);
        if (!fresh.deductionAuthorizationReference || fresh.deductionAuthorizationReference.length < 8) {
          throw new Error("LOAN_AUTHORIZATION_MISSING");
        }
        if (!["Active", "On leave"].includes(worker.status)) {
          throw new Error("LOAN_EMPLOYEE_UNAVAILABLE");
        }
        const fromDate = fresh.startDate ? String(fresh.startDate) : todayPh();
        // Hold the currently applicable payroll rows before activating a
        // deduction; never alter an already processed or approving register.
        await tx.execute(sql`SELECT id FROM payroll_runs
          WHERE organization_id = ${fresh.organizationId} AND period_end >= ${fromDate}
          ORDER BY id FOR UPDATE`);
        const cutoffRows = await tx.select({
          periodEnd: payrollRuns.periodEnd,
          status: payrollRuns.status,
          employeeCount: payrollRuns.employeeCount,
          processedChunks: payrollRuns.processedChunks,
          scopeOrgUnitId: payrollRuns.scopeOrgUnitId,
        }).from(payrollRuns).where(and(
          eq(payrollRuns.organizationId, fresh.organizationId),
          gte(payrollRuns.periodEnd, fromDate),
        ));
        const conflict = activeLoanPayrollConflict(cutoffRows, fromDate, worker.orgUnitId);
        if (conflict) throw new Error("LOAN_PAYROLL_ALREADY_STARTED");
        nextStatus = "active";
        const [updated] = await tx.update(employeeLoans).set({
          status: "active",
          reviewedByUserId: user.id,
          reviewedAt: new Date(),
          reviewEvidenceReference: reviewerRef,
          reviewReason: reason,
        }).where(and(eq(employeeLoans.id, id), eq(employeeLoans.status, fresh.status))).returning();
        if (!updated) throw new Error("LOAN_REVIEW_STATE_CHANGED");
        metadata.reviewEvidenceReference = reviewerRef;
        metadata.reviewReason = reason;
        metadata.reviewerUserId = user.id;
      } else if (action === "reject") {
        if (fresh.status !== "pending_approval") throw new Error("LOAN_REVIEW_STATE_CHANGED");
        const separated = independentLoanReviewer(fresh.requestedByUserId, user.id);
        if (separated) throw new Error(separated);
        const [updated] = await tx.update(employeeLoans).set({
          status: "rejected", reviewedByUserId: user.id,
          reviewedAt: new Date(), reviewReason: reason,
        }).where(and(eq(employeeLoans.id, id), eq(employeeLoans.status, "pending_approval"))).returning();
        if (!updated) throw new Error("LOAN_REVIEW_STATE_CHANGED");
        nextStatus = updated.status;
        metadata.reviewReason = reason;
        metadata.reviewerUserId = user.id;
      } else if (action === "record_payment") {
        if (!["active", "paused"].includes(fresh.status)) throw new Error("LOAN_PAYMENT_STATUS_INVALID");
        const remaining = parseLoanCents(fresh.remainingBalance);
        if (!remaining || !paymentCents || paymentCents > remaining) throw new Error("LOAN_PAYMENT_EXCEEDS_BALANCE");
        const oldPaid = Number(fresh.totalPaid) === 0 ? 0 : parseLoanCents(fresh.totalPaid);
        if (oldPaid == null) throw new Error("LOAN_CORRUPT_LEDGER_BALANCE");
        const nextPaid = oldPaid + paymentCents;
        if (!Number.isSafeInteger(nextPaid) || nextPaid > 999_999_999_999) {
          throw new Error("LOAN_CORRUPT_LEDGER_BALANCE");
        }
        // Serialize duplicate receipt checks under the locked loan row.
        // Manual attestation is not independent bank settlement proof.
        const [duplicateReceipt] = await tx.select({ id: loanPayments.id })
          .from(loanPayments).where(and(
            eq(loanPayments.loanId, id),
            sql`lower(${loanPayments.reference}) = lower(${paymentRef})`,
          )).limit(1);
        if (duplicateReceipt) throw new Error("LOAN_PAYMENT_REFERENCE_ALREADY_RECORDED");
        const nextRemaining = remaining - paymentCents;
        nextStatus = nextRemaining === 0 ? "paid_off" : fresh.status;
        await tx.insert(loanPayments).values({
          loanId: id, amount: moneyFromCents(paymentCents),
          paymentDate: todayPh(), reference: paymentRef,
        });
        const [updated] = await tx.update(employeeLoans).set({
          remainingBalance: moneyFromCents(nextRemaining),
          totalPaid: moneyFromCents(nextPaid), status: nextStatus,
        }).where(and(eq(employeeLoans.id, id), eq(employeeLoans.status, fresh.status))).returning();
        if (!updated) throw new Error("LOAN_REVIEW_STATE_CHANGED");
        paymentAmount = moneyFromCents(paymentCents);
        metadata.paymentAmount = paymentAmount;
        metadata.remainingBalance = updated.remainingBalance;
        metadata.externalPaymentReference = paymentRef;
        metadata.externalEvidenceOperatorAttestedNotBankVerified = true;
      } else if (action === "pause") {
        if (fresh.status !== "active") throw new Error("LOAN_REVIEW_STATE_CHANGED");
        const [updated] = await tx.update(employeeLoans).set({ status: "paused" })
          .where(and(eq(employeeLoans.id, id), eq(employeeLoans.status, "active"))).returning();
        if (!updated) throw new Error("LOAN_REVIEW_STATE_CHANGED");
        nextStatus = updated.status;
        metadata.pauseReason = reason;
      } else if (action === "close") {
        if (!["active", "paused"].includes(fresh.status)
          || Math.round(Number(fresh.remainingBalance) * 100) !== 0) {
          throw new Error("LOAN_CLOSE_REQUIRES_ZERO_BALANCE");
        }
        const [updated] = await tx.update(employeeLoans).set({ status: "paid_off" })
          .where(and(eq(employeeLoans.id, id), eq(employeeLoans.status, fresh.status))).returning();
        if (!updated) throw new Error("LOAN_REVIEW_STATE_CHANGED");
        nextStatus = updated.status;
        metadata.closeReason = reason;
      }

      metadata.nextStatus = nextStatus;
      await tx.insert(auditEvents).values({
        organizationId: fresh.organizationId, actor: user.name,
        action: `Employee loan: ${action}`.slice(0, 160),
        resource: `${fresh.loanType} #${fresh.id}`.slice(0, 160),
        metadata,
      });
      return {
        id, action, status: nextStatus,
        paymentAmount,
        message: action === "record_payment"
          ? "External payment attestation recorded against the balance. Reconcile with the bank/agency evidence; no payroll was run."
          : action === "approve" || action === "resume"
            ? "Independent checker recorded approval. Scheduled payroll will only consider this loan in an eligible cutoff."
            : `Loan ${action} decision recorded with audit evidence.`,
      };
    });
    return Response.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      LOAN_NOT_FOUND: "This loan is no longer available.",
      LOAN_EMPLOYEE_UNAVAILABLE: "Worker cannot begin or resume deductions; check employment status.",
      LOAN_REQUESTER_UNKNOWN: "This legacy loan has no accountable preparer. Reconcile its original authorization in a separately approved migration before reactivating deductions.",
      LOAN_SELF_APPROVAL: "Maker-checker: the original loan registrant cannot approve or resume their own deduction.",
      LOAN_AUTHORIZATION_MISSING: "No reviewed deduction authority is recorded. Do not activate this deduction.",
      LOAN_REVIEW_STATE_CHANGED: "Loan status changed during review. Refresh before taking further action.",
      LOAN_PAYROLL_ALREADY_STARTED: "An affected payroll period has already begun calculation or approval. Do not activate a new deduction until the register is reconciled.",
      LOAN_PAYMENT_STATUS_INVALID: "Only active or paused loans can receive verified external payments.",
      LOAN_PAYMENT_EXCEEDS_BALANCE: "The verified payment must be positive and no greater than the remaining balance.",
      LOAN_PAYMENT_REFERENCE_ALREADY_RECORDED: "This receipt or bank reference is already recorded for the loan. Do not credit the same payment twice.",
      LOAN_CORRUPT_LEDGER_BALANCE: "Loan balance cannot be reconciled. Correct source accounting before changes.",
      LOAN_CLOSE_REQUIRES_ZERO_BALANCE: "A nonzero loan may not be marked paid-off without a separately reviewed write-off process.",
    };
    if (known[code]) return deniedBusinessAction(known[code], code, code === "LOAN_NOT_FOUND" ? 404 : 409);
    throw error;
  }
}
