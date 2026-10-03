import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  dataRequests,
  employeeLoans,
  employees,
  historicalPayrollEntries,
  payrollEntries,
  retentionRules,
  separationRecords,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { encryptBankAccount } from "@/lib/bank-account-crypto";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { missingRetentionClasses } from "@/lib/retention-schedule";

export const dynamic = "force-dynamic";

const PRIVACY_ROLES = ["owner", "admin", "hr"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function employeeForRequest(
  organizationId: number,
  subjectEmail: string,
  requestedEmployeeId: unknown,
) {
  const employeeId = Number(requestedEmployeeId);
  if (Number.isInteger(employeeId) && employeeId > 0) {
    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    return employee ?? null;
  }
  const rows = await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.email, subjectEmail),
  ));
  return rows.length === 1 ? rows[0] : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const requestId = Number((await params).id);
  if (!Number.isInteger(requestId)) {
    return Response.json({ error: "Invalid data-subject request id." }, { status: 400 });
  }

  const [privacyRequest] = await db.select().from(dataRequests)
    .where(eq(dataRequests.id, requestId))
    .limit(1);
  if (!privacyRequest || !privacyRequest.organizationId) {
    return Response.json({ error: "Data-subject request not found." }, { status: 404 });
  }
  if (privacyRequest.status === "completed") {
    return Response.json({ error: "This data-subject request is already completed." }, { status: 409 });
  }

  const organizationId = privacyRequest.organizationId;
  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PRIVACY_ROLES,
    "Only privacy administrators can fulfill data-subject requests.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Data-subject request fulfillment requires company-wide access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;

  const body = await request.json().catch(() => ({}));
  const employee = await employeeForRequest(
    organizationId,
    privacyRequest.subjectEmail,
    body.employeeId,
  );
  if (!employee) {
    return Response.json({
      error: "The request subject could not be matched to exactly one employee. Supply the employeeId after identity verification.",
    }, { status: 409 });
  }

  const action = String(body.action ?? "").trim();
  let evidence: Record<string, unknown>;
  let legalRetentionApplied = false;

  if (privacyRequest.requestType === "correction" && action === "apply_correction") {
    const corrections =
      body.corrections && typeof body.corrections === "object" && !Array.isArray(body.corrections)
        ? body.corrections as Record<string, unknown>
        : {};

    const patch: Record<string, string | null> = {};
    const nullableText = [
      "middleName",
      "mobile",
      "emergencyContact",
      "emergencyPhone",
      "education",
    ] as const;
    for (const field of nullableText) {
      if (corrections[field] === undefined) continue;
      const value = String(corrections[field] ?? "").trim();
      patch[field] = value || null;
    }
    for (const field of ["firstName", "lastName", "email", "nationality"] as const) {
      if (corrections[field] === undefined) continue;
      const value = String(corrections[field] ?? "").trim();
      if (!value) {
        return Response.json({ error: `${field} cannot be blank when corrected.` }, { status: 422 });
      }
      patch[field] = field === "email" ? value.toLowerCase() : value;
    }
    if (corrections.birthDate !== undefined) {
      const value = String(corrections.birthDate ?? "").trim();
      if (value && !ISO_DATE.test(value)) {
        return Response.json({ error: "birthDate must use YYYY-MM-DD." }, { status: 422 });
      }
      patch.birthDate = value || null;
    }

    const fields = Object.keys(patch);
    if (fields.length === 0) {
      return Response.json({
        error: "Provide at least one supported correction: name, email, mobile, birth date, nationality, emergency contact, or education.",
      }, { status: 422 });
    }

    await db.update(employees).set(patch).where(and(
      eq(employees.id, employee.id),
      eq(employees.organizationId, organizationId),
    ));

    evidence = {
      employeeId: employee.id,
      fieldsCorrected: fields,
      payoutFieldsChanged: false,
      governmentIdentifiersChanged: false,
    };
  } else if (privacyRequest.requestType === "objection" && action === "restrict_processing") {
    await db.update(employees).set({ privacyRestricted: true }).where(and(
      eq(employees.id, employee.id),
      eq(employees.organizationId, organizationId),
    ));
    evidence = {
      employeeId: employee.id,
      processingRestricted: true,
      effect: "Excluded from future payroll cohorts; historical records preserved.",
    };
  } else if (privacyRequest.requestType === "deletion" && action === "redact_non_retained_profile") {
    const retentionRows = await db.select().from(retentionRules)
      .where(eq(retentionRules.organizationId, organizationId));
    const missing = missingRetentionClasses(retentionRows);
    if (missing.length > 0) {
      return Response.json({
        error: "Configure and approve the complete organization retention schedule before executing deletion/minimization.",
        missingRetentionClasses: missing,
      }, { status: 409 });
    }

    const [
      [{ value: payrollCount }],
      [{ value: historicalCount }],
      [{ value: loanCount }],
      [{ value: separationCount }],
    ] = await Promise.all([
      db.select({ value: count() }).from(payrollEntries).where(eq(payrollEntries.employeeId, employee.id)),
      db.select({ value: count() }).from(historicalPayrollEntries).where(eq(historicalPayrollEntries.employeeId, employee.id)),
      db.select({ value: count() }).from(employeeLoans).where(eq(employeeLoans.employeeId, employee.id)),
      db.select({ value: count() }).from(separationRecords).where(eq(separationRecords.employeeId, employee.id)),
    ]);

    const retainedRecordCounts = {
      payrollEntries: Number(payrollCount),
      historicalPayrollEntries: Number(historicalCount),
      loanRecords: Number(loanCount),
      separationRecords: Number(separationCount),
    };
    const hasLegallyRetainedHistory = Object.values(retainedRecordCounts).some((value) => value > 0);
    legalRetentionApplied = hasLegallyRetainedHistory;
    if (hasLegallyRetainedHistory && body.legalRetentionApplied !== true) {
      return Response.json({
        error: "This employee has payroll/employment records covered by the approved retention schedule. Confirm legalRetentionApplied=true to redact non-retained profile data while preserving required evidence.",
        retainedRecordCounts,
      }, { status: 409 });
    }

    const hasLegalHold = retentionRows.some((rule) => rule.legalHold);
    await db.update(employees).set({
      privacyRestricted: true,
      bankAccount: encryptBankAccount(null),
      bankCode: null,
      mobile: null,
      emergencyContact: null,
      emergencyPhone: null,
      education: null,
      birthDate: null,
      email: `redacted+${employee.id}@privacy.invalid`,
      ...(hasLegallyRetainedHistory
        ? {}
        : {
            firstName: "Redacted",
            middleName: null,
            lastName: `Employee ${employee.id}`,
            avatarInitials: "RX",
            tin: null,
            tinBranchCode: null,
            sssNo: null,
            philHealthNo: null,
            pagIbigNo: null,
          }),
    }).where(and(
      eq(employees.id, employee.id),
      eq(employees.organizationId, organizationId),
    ));

    evidence = {
      employeeId: employee.id,
      action: "profile_minimization",
      retainedRecordCounts,
      legalHoldPresent: hasLegalHold,
      preservedHistoricIdentity: hasLegallyRetainedHistory,
      redactedFields: hasLegallyRetainedHistory
        ? ["bankAccount", "bankCode", "mobile", "email", "birthDate", "emergencyContact", "emergencyPhone", "education"]
        : ["name", "bankAccount", "bankCode", "mobile", "email", "birthDate", "emergencyContact", "emergencyPhone", "education", "governmentIdentifiers"],
    };
  } else {
    return Response.json({
      error: "The requested fulfillment action does not match this data-subject request type.",
      supported: {
        correction: "apply_correction",
        objection: "restrict_processing",
        deletion: "redact_non_retained_profile",
      },
    }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Data request fulfillment executed",
    resource: `${privacyRequest.requestType} · ${privacyRequest.subjectEmail}`,
    metadata: {
      requestId,
      requestType: privacyRequest.requestType,
      action,
      ...evidence,
      legalRetentionApplied,
    },
  });

  const [completed] = await db.update(dataRequests).set({
    status: "completed",
    completedAt: new Date(),
    handledBy: session.name,
    fulfillmentAction: action,
    fulfillmentEvidence: evidence,
    legalRetentionApplied,
    notes: String(body.notes ?? "").trim().slice(0, 400) || undefined,
  }).where(and(
    eq(dataRequests.id, requestId),
    eq(dataRequests.organizationId, organizationId),
  )).returning();

  return Response.json(completed);
}
