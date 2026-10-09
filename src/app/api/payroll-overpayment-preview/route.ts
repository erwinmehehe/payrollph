import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { loadReleasedOverpaymentEvidence } from "@/lib/payroll-overpayment-preview-server";
import {
  assertOrganizationRole, getAccess, PAYROLL_TAX_APPROVER_ROLES,
} from "@/lib/access";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  compareReleasedPayrollWithVerifiedAmounts,
  fingerprintReleasedPayrollEntry,
} from "@/lib/payroll-overpayment-preview";

export const dynamic = "force-dynamic";

// Deliberately default-off. No payout/deduction method is exposed in this API.
function previewEnabled() {
  return process.env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "true";
}

async function authorize(organizationId: number, userId: number) {
  const denied = await assertOrganizationRole(
    userId, organizationId, PAYROLL_TAX_APPROVER_ROLES,
    "Only an authorized company-wide payroll checker may inspect overpayment evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      code: "OVERPAYMENT_COMPANY_SCOPE_REQUIRED",
      error: "A company-wide payroll checker is required for source payroll reconciliation.",
    }, { status: 403 });
  }
  return null;
}

function isId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export async function GET(request: Request) {
  if (!previewEnabled()) return Response.json({ error: "Not found." }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!isId(organizationId)) return Response.json({ error: "Valid organizationId is required." }, { status: 400 });
  const denied = await authorize(organizationId, user.id);
  if (denied) return denied;

  // Limit employee fields to a selection label. Never expose bank, tax,
  // government IDs, birthdays, private HR notes, or original line item traces.
  const [runs, staff] = await Promise.all([
    db.select({
      id: payrollRuns.id, periodLabel: payrollRuns.periodLabel,
      periodEnd: payrollRuns.periodEnd, status: payrollRuns.status,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
    )).orderBy(desc(payrollRuns.id)).limit(100),
    db.select({
      id: employees.id, employeeNo: employees.employeeNo,
      firstName: employees.firstName, lastName: employees.lastName,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId))
      .orderBy(employees.employeeNo).limit(1000),
  ]);
  return Response.json({
    releasedRuns: runs,
    employees: staff,
    scope: "Read-only financial discrepancy preview; no overpayment recovery, offset, withholding, loan or final-pay deduction is authorized.",
  });
}

export async function POST(request: Request) {
  if (!previewEnabled()) return Response.json({ error: "Not found." }, { status: 404 });
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const parsedBody: unknown = await request.json().catch(() => null);
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
    ? parsedBody as Record<string, unknown> : {};
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const payrollRunId = Number(body.payrollRunId);
  const verifiedGrossPay = body.verifiedGrossPay;
  const verifiedNetPay = body.verifiedNetPay;
  const evidenceReference = typeof body.evidenceReference === "string" ? body.evidenceReference.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!isId(organizationId) || !isId(employeeId) || !isId(payrollRunId)
    || reason.length < 20 || reason.length > 500
    || evidenceReference.length < 8 || evidenceReference.length > 200
    || typeof verifiedGrossPay !== "string" || typeof verifiedNetPay !== "string") {
    return Response.json({
      code: "OVERPAYMENT_PREVIEW_INVALID_REQUEST",
      error: "Choose an employee and Released payroll, enter independently verified gross and net pay, a 20-500 character reconciliation reason, and an 8-200 character evidence reference.",
    }, { status: 400 });
  }
  const denied = await authorize(organizationId, user.id);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "hcm-overpayment-read-only-preview",
    resourceId: payrollRunId, limit: 8, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const sourceEvidence = await loadReleasedOverpaymentEvidence(
    organizationId, employeeId, payrollRunId,
  );
  if (!sourceEvidence.ok) {
    return sourceEvidence.reason === "SOURCE_NOT_FOUND"
      ? Response.json({
        code: "OVERPAYMENT_SOURCE_NOT_FOUND",
        error: "No eligible Released payroll evidence exists for this employee in this company.",
      }, { status: 404 })
      : Response.json({
        code: "OVERPAYMENT_SOURCE_ENTRY_COUNT",
        error: "The Released run must contain exactly one payroll entry for the selected employee. Reconcile missing or duplicate records before previewing any variance.",
      }, { status: 409 });
  }
  const { run, worker, entry } = sourceEvidence;
  const arithmetic = compareReleasedPayrollWithVerifiedAmounts({
    grossPay: entry.grossPay,
    deductions: entry.deductions,
    netPay: entry.netPay,
  }, { grossPay: verifiedGrossPay, netPay: verifiedNetPay });
  if (!arithmetic.ok) {
    return Response.json({ code: arithmetic.code, error: arithmetic.error }, { status: 422 });
  }

  const fingerprint = fingerprintReleasedPayrollEntry({
    entryId: entry.id, runId: entry.payrollRunId,
    employeeId: entry.employeeId, grossPay: entry.grossPay,
    deductions: entry.deductions, netPay: entry.netPay,
    status: entry.status, lineItems: entry.lineItems, trace: entry.trace,
  });
  const legalEntityMismatch = run.legalEntityId != null && worker.legalEntityId != null
    && run.legalEntityId !== worker.legalEntityId;
  return Response.json({
    reviewOnly: true,
    saved: false,
    employee: {
      id: worker.id,
      employeeNo: worker.employeeNo,
      displayName: worker.firstName + " " + worker.lastName,
    },
    source: {
      runId: run.id,
      periodLabel: run.periodLabel,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      originalEntryId: entry.id,
      sourceFingerprint: fingerprint,
      legalEntityChangedSinceSource: legalEntityMismatch,
    },
    variance: arithmetic.variance,
    evidenceReference,
    reason,
    requiredReviews: [
      "Independently verify actual bank-paid amount and original register against employer documents.",
      "Reconcile wage basis, withholding tax, SSS, PhilHealth and Pag-IBIG with a qualified payroll reviewer.",
      "Review Philippine employment-law requirements, written authorization and any dispute before considering a repayment or deduction.",
      "If worker is separated, reconcile final pay separately; this preview does not change separation, loan or final-pay state.",
    ],
    warning: "Differences are NOT established debt or recoverable wages. Nothing was stored, deducted, transferred, submitted, or posted to payroll.",
  });
}
