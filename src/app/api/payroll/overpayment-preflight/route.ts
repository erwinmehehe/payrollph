import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLoans,
  employeePayRetroAdjustments,
  employees,
  payrollEntries,
  payrollRuns,
  separationRecords,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  assessOverpaymentReview,
  parseLedgerPesoCents,
  parsePositivePesoCents,
  pesoCentsString,
  releasedPayrollEntryFingerprint,
  OVERPAYMENT_REVIEW_VERSION,
} from "@/lib/payroll-overpayment-investigation";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

async function requireInvestigator(organizationId: number) {
  const user = await getSessionUser();
  if (!user) return { denied: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return { denied: Response.json({ error: "Valid organizationId is required." }, { status: 400 }) };
  }
  const roleDenied = await assertOrganizationRole(
    user.id, organizationId, PAYROLL_VIEW_ROLES,
    "A payroll reviewer must review sensitive wage discrepancy evidence.",
  );
  if (roleDenied) return { denied: roleDenied };
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return { denied: Response.json({
      code: "OVERPAYMENT_REVIEW_COMPANY_SCOPE_REQUIRED",
      error: "Only company-wide payroll reviewers can investigate wage discrepancies.",
    }, { status: 403 }) };
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return { denied: mfaDenied };

  // This endpoint cannot move money. Even read-only payroll case previews
  // remain default OFF until customer/access staging has been witnessed.
  if (process.env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED !== "true") {
    return { denied: Response.json({
      code: "OVERPAYMENT_REVIEW_DISABLED",
      error: "The overpayment investigation workbench has not been activated for this environment.",
    }, { status: 404, headers: NO_STORE }) };
  }
  return { user };
}

/** Only company-wide authenticated payroll reviewers can list source choices. */
export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const gate = await requireInvestigator(organizationId);
  if (gate.denied) return gate.denied;

  const [workers, releasedRuns] = await Promise.all([
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId))
      .orderBy(employees.employeeNo).limit(1500),
    db.select({
      id: payrollRuns.id,
      periodLabel: payrollRuns.periodLabel,
      periodEnd: payrollRuns.periodEnd,
      status: payrollRuns.status,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
    )).orderBy(desc(payrollRuns.id)).limit(120),
  ]);
  return Response.json({
    employees: workers,
    releasedRuns,
    version: OVERPAYMENT_REVIEW_VERSION,
    readOnly: true,
    noAutomatedDeduction: true,
    message: "An investigation preview is not a claim, debt record, payment confirmation or authorization to withhold wages.",
  }, { headers: NO_STORE });
}

/**
 * Read-only POST keeps wage and employee details out of URL/query-string logs.
 * No code path inserts, updates, voids, settles, calculates or releases wages.
 */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const sourcePayrollRunId = Number(body.sourcePayrollRunId);
  const claimCents = parsePositivePesoCents(body.claimedAmount);
  const evidenceReference = typeof body.evidenceReference === "string"
    ? body.evidenceReference.trim() : "";
  const explanation = typeof body.explanation === "string"
    ? body.explanation.trim() : "";
  const gate = await requireInvestigator(organizationId);
  if (gate.denied) return gate.denied;

  if (
    !Number.isSafeInteger(employeeId) || employeeId <= 0
    || !Number.isSafeInteger(sourcePayrollRunId) || sourcePayrollRunId <= 0
    || claimCents == null
    || evidenceReference.length < 8 || evidenceReference.length > 160
    || explanation.length < 20 || explanation.length > 500
  ) {
    return Response.json({
      code: "OVERPAYMENT_REVIEW_INPUT_INVALID",
      error: "Select a worker, Released payroll run, exact positive peso amount, an 8-160 character evidence reference and a 20-500 character explanation.",
    }, { status: 400, headers: NO_STORE });
  }

  const limit = await enforceSensitiveActionRateLimit(request, {
    userId: gate.user!.id,
    action: "payroll-overpayment-readonly-investigation",
    resourceId: employeeId,
    limit: 8,
    windowMs: 15 * 60_000,
  });
  if (limit) return limit;

  const [[worker], [run]] = await Promise.all([
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
      orgUnitId: employees.orgUnitId,
    }).from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1),
    db.select({
      id: payrollRuns.id,
      organizationId: payrollRuns.organizationId,
      periodLabel: payrollRuns.periodLabel,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
      payDate: payrollRuns.payDate,
      status: payrollRuns.status,
      scopeOrgUnitId: payrollRuns.scopeOrgUnitId,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.id, sourcePayrollRunId),
      eq(payrollRuns.organizationId, organizationId),
    )).limit(1),
  ]);
  if (!worker || !run) {
    return Response.json({
      code: "OVERPAYMENT_SOURCE_NOT_FOUND",
      error: "Worker and Released source payroll must belong to the same authorized employer.",
    }, { status: 404, headers: NO_STORE });
  }
  if (run.scopeOrgUnitId != null && run.scopeOrgUnitId !== worker.orgUnitId) {
    return Response.json({
      code: "OVERPAYMENT_PAYROLL_SCOPE_MISMATCH",
      error: "The source payroll cutoff was scoped to another organizational unit.",
    }, { status: 409, headers: NO_STORE });
  }

  const [entries, openLoans, separations, retroRows] = await Promise.all([
    db.select().from(payrollEntries).where(and(
      eq(payrollEntries.payrollRunId, sourcePayrollRunId),
      eq(payrollEntries.employeeId, employeeId),
    )).limit(2),
    db.select({
      id: employeeLoans.id,
      remainingBalance: employeeLoans.remainingBalance,
      status: employeeLoans.status,
    }).from(employeeLoans).where(and(
      eq(employeeLoans.organizationId, organizationId),
      eq(employeeLoans.employeeId, employeeId),
    )).limit(100),
    db.select({ status: separationRecords.status }).from(separationRecords).where(and(
      eq(separationRecords.organizationId, organizationId),
      eq(separationRecords.employeeId, employeeId),
    )).orderBy(desc(separationRecords.id)).limit(30),
    db.select({ id: employeePayRetroAdjustments.id }).from(employeePayRetroAdjustments).where(and(
      eq(employeePayRetroAdjustments.organizationId, organizationId),
      eq(employeePayRetroAdjustments.employeeId, employeeId),
      eq(employeePayRetroAdjustments.sourcePayrollRunId, sourcePayrollRunId),
    )).limit(100),
  ]);
  const onlyEntry = entries.length === 1 ? entries[0] : null;
  const netPayCents = onlyEntry ? parseLedgerPesoCents(onlyEntry.netPay) : null;
  const assessment = assessOverpaymentReview({
    claimCents,
    netPayCents,
    sourceReleased: run.status === "Released",
    sourceEntryCount: entries.length,
    workerStatus: worker.status,
    openLoanCount: openLoans.filter(loan =>
      ["active", "paused"].includes(loan.status)
      && Number(loan.remainingBalance) > 0
    ).length,
    separationStatuses: separations.map(row => row.status),
    existingRetroCount: retroRows.length,
  });

  return Response.json({
    version: OVERPAYMENT_REVIEW_VERSION,
    generatedAt: new Date().toISOString(),
    previewOnly: true,
    persisted: false,
    employee: {
      id: worker.id,
      employeeNo: worker.employeeNo,
      displayName: `${worker.firstName} ${worker.lastName}`,
      status: worker.status,
    },
    source: {
      payrollRunId: run.id,
      periodLabel: run.periodLabel,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      payrollStatus: run.status,
      payrollEntryId: onlyEntry?.id ?? null,
      entryHashSha256: onlyEntry ? releasedPayrollEntryFingerprint(onlyEntry) : null,
      grossPay: onlyEntry?.grossPay ?? null,
      deductions: onlyEntry?.deductions ?? null,
      netPay: onlyEntry?.netPay ?? null,
      bankCreditVerified: false,
    },
    allegation: {
      claimedAmount: pesoCentsString(claimCents),
      evidenceReference,
      explanation,
      verified: false,
    },
    assessment,
    immutableWarning: "No deductions, salary changes, final-pay offsets, settlements, bank transfers or government amendments were performed. This preview is not a verified claim or a legal determination.",
  }, { headers: NO_STORE });
}
