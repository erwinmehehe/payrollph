import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeePayProfiles, employeePayRevisions, payrollEntries, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  isSalaryCorrectionRequestObject, positiveSalaryRateCents, previewHistoricalSalaryRate,
  projectSalaryCorrectionEvidence, validSalaryCorrectionDate,
} from "@/lib/hcm-salary-correction-preview";

export const dynamic = "force-dynamic";
const HISTORY_LIMIT = 50;
const PAYROLL_PERIOD_LIMIT = 50;

/**
 * Assessment-only endpoint for #641. The POST carries a hypothetical pay rate
 * in the body (not URL), but does not persist a case or change any salary,
 * payroll, tax, loan, bank, approval, government return or payment.
 */
export async function POST(request: Request) {
  if (process.env.HCM_SALARY_CORRECTION_PREVIEW_ENABLED !== "true") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Salary correction impact preview");
  if (demoDenied) return demoDenied;

  const payload: unknown = await request.json().catch(() => null);
  if (!isSalaryCorrectionRequestObject(payload)) {
    return Response.json({ error: "A JSON object is required." }, { status: 400 });
  }
  const body = payload;
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const legalEntityId = Number(body.legalEntityId);
  const effectiveDate = body.effectiveDate;
  const proposedPayBasis = typeof body.proposedPayBasis === "string" ? body.proposedPayBasis.trim().toLowerCase() : "";
  if (![organizationId, employeeId, legalEntityId].every((n) => Number.isSafeInteger(n) && n > 0)
    || !validSalaryCorrectionDate(effectiveDate)
    || !["monthly", "daily", "hourly"].includes(proposedPayBasis)) {
    return Response.json({ error: "Valid employer, employee, legal entity, effective date and pay basis are required." }, { status: 400 });
  }

  let proposedRateAmount: string;
  try {
    // Parse exactly to cents. Do not silently round real wage corrections.
    proposedRateAmount = String(body.proposedRateAmount);
    positiveSalaryRateCents(proposedRateAmount);
  } catch {
    return Response.json({ error: "Proposed rate must be positive, at most 100000000.00, and have no more than two decimals." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide People administration is required to preview pay corrections.",
  );
  if (denied) return denied;
  const payDenied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_PAYROLL_ROLES,
    "The compensation preview requires explicit People payroll permission.",
  );
  if (payDenied) return payDenied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !["owner", "admin", "bookkeeper", "hr"].includes(access.role)) {
    return Response.json({ error: "Company-wide People and payroll access is required." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "hcm-salary-correction-preview", resourceId: employeeId,
    limit: 8, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const todayPh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  if (effectiveDate >= todayPh) {
    return Response.json({ error: "Backdated correction date must be earlier than today in the Philippines." }, { status: 400 });
  }
  const suppliedRevision = body.expectedLatestRevisionId;
  if (suppliedRevision !== undefined && suppliedRevision !== null
    && (!Number.isSafeInteger(Number(suppliedRevision)) || Number(suppliedRevision) < 0)) {
    return Response.json({ error: "Invalid expected revision ID." }, { status: 400 });
  }

  try {
    const [employee] = await db.select({
      id: employees.id,
      legalEntityId: employees.legalEntityId,
      startDate: employees.startDate,
      status: employees.status,
    }).from(employees).where(and(
      eq(employees.organizationId, organizationId),
      eq(employees.id, employeeId),
    )).limit(1);
    // Do not even reveal a cross-tenant or different legal employer worker.
    if (!employee || employee.legalEntityId !== legalEntityId) {
      return Response.json({ error: "Employee not found in the selected legal employer." }, { status: 404 });
    }
    if (effectiveDate < String(employee.startDate)) {
      return Response.json({ error: "Effective date cannot predate the recorded employment start." }, { status: 400 });
    }

    const [profile] = await db.select({
      payBasis: employeePayProfiles.payBasis,
      rateAmount: employeePayProfiles.rateAmount,
    }).from(employeePayProfiles).where(and(
      eq(employeePayProfiles.organizationId, organizationId),
      eq(employeePayProfiles.employeeId, employeeId),
    )).limit(1);
    if (!profile) {
      return Response.json({ error: "Historical pay profile evidence is missing." }, { status: 409 });
    }

    const [revisionRows, payrollRows] = await Promise.all([
      db.select({
        id: employeePayRevisions.id,
        effectiveDate: employeePayRevisions.effectiveDate,
        previousPayBasis: employeePayRevisions.previousPayBasis,
        previousRateAmount: employeePayRevisions.previousRateAmount,
        newPayBasis: employeePayRevisions.newPayBasis,
        newRateAmount: employeePayRevisions.newRateAmount,
      }).from(employeePayRevisions).where(and(
        eq(employeePayRevisions.organizationId, organizationId),
        eq(employeePayRevisions.employeeId, employeeId),
      )).orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
        .limit(HISTORY_LIMIT + 1),
      db.select({
        runId: payrollRuns.id,
        legalEntityId: payrollRuns.legalEntityId,
        periodStart: payrollRuns.periodStart,
        periodEnd: payrollRuns.periodEnd,
        status: payrollRuns.status,
        entryId: payrollEntries.id,
      }).from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(
          eq(payrollEntries.employeeId, employeeId),
          eq(payrollRuns.organizationId, organizationId),
          gte(payrollRuns.periodEnd, effectiveDate),
        ))
        .orderBy(payrollRuns.periodStart, payrollRuns.id)
        .limit(PAYROLL_PERIOD_LIMIT + 1),
    ]);
    const latestRevisionId = revisionRows[0]?.id ?? null;
    if (suppliedRevision !== undefined && suppliedRevision !== null
      && Number(suppliedRevision) !== (latestRevisionId ?? 0)) {
      return Response.json({
        error: "Pay revision changed after the operator opened this preview. Refresh the source evidence.",
        code: "HCM_SALARY_CORRECTION_STALE",
      }, { status: 409 });
    }

    const historyCapped = revisionRows.length > HISTORY_LIMIT;
    const periodsCapped = payrollRows.length > PAYROLL_PERIOD_LIMIT;
    const history = revisionRows.slice(0, HISTORY_LIMIT).map((r) => ({
      id: r.id,
      effectiveDate: String(r.effectiveDate),
      previousPayBasis: r.previousPayBasis,
      previousRateAmount: r.previousRateAmount,
      newPayBasis: r.newPayBasis,
      newRateAmount: r.newRateAmount,
    }));
    const assessment = previewHistoricalSalaryRate({
      effectiveDate, proposedPayBasis, proposedRateAmount,
      currentPayBasis: profile.payBasis,
      currentRateAmount: profile.rateAmount,
      revisions: history, historyCapped,
    });
    const publicEvidence = projectSalaryCorrectionEvidence(assessment, history);
    const affectedPayrollPeriods = payrollRows.slice(0, PAYROLL_PERIOD_LIMIT).map((row) => ({
      runId: row.runId,
      entryId: row.entryId,
      status: row.status,
      periodStart: String(row.periodStart),
      periodEnd: String(row.periodEnd),
      legalEmployerEvidenceMatchesCurrent: row.legalEntityId === legalEntityId,
      requiresIndependentReconciliation: true,
    }));

    return Response.json({
      status: "assessment_only",
      tenantId: organizationId,
      subjectEmployeeId: employeeId,
      legalEntityId,
      employeeStatus: employee.status,
      latestRevisionId,
      assessment: publicEvidence.assessment,
      recentRevisions: publicEvidence.recentRevisions,
      affectedPayrollPeriods,
      preview: {
        historyCapped, periodsCapped,
        incompleteEvidence: historyCapped || periodsCapped
          || assessment.evidence === "incomplete_history"
          || assessment.evidence === "current_profile_unverified"
          || affectedPayrollPeriods.some((row) => !row.legalEmployerEvidenceMatchesCurrent),
        mayBeAdditionalAffectedRuns: periodsCapped,
        completePayableAmountKnown: false,
      },
      notice: "Read-only evidence only. A rate difference is not retro wages, deductions or take-home pay. Recalculate taxable and statutory obligations, leave/OT/night/holiday premiums, government loans, final pay and GL using independently approved period evidence. Released payroll remains immutable.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({
      error: "Required payroll or pay-history evidence is unavailable. No financial amount was computed or changed.",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
