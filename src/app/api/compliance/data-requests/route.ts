import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  dataRequests,
  employeeLoans,
  employees,
  payrollEntries,
  payrollRuns,
  separationRecords,
} from "@/db/schema";
import { decryptBankAccount } from "@/lib/bank-account-crypto";
import { decryptGovernmentId, encryptGovernmentId } from "@/lib/government-id-crypto";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { RECORD_RETENTION_SCHEDULE } from "@/lib/data-retention";

export const dynamic = "force-dynamic";

/**
 * Data Privacy Act data-subject request register.
 *
 * The 30-day value below is Linaw's internal service-level target. It is not
 * presented as a universal statutory NPC deadline because the DPA/IRR applies
 * different duties to different rights and requires appropriate handling
 * rather than one blanket response period for every request type.
 */
const INTERNAL_RESPONSE_TARGET_DAYS = 30;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedList = await assertOrganizationRole(
    session.id,
    organizationId,
    ["owner", "admin", "hr"],
    "Only privacy administrators can view data-subject requests.",
  );
  if (deniedList) return deniedList;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Data-subject requests require company-wide privacy administrator access." }, { status: 403 });
  }

  const requestId = Number(searchParams.get("requestId") ?? "0");
  const format = searchParams.get("format");
  if (Number.isInteger(requestId) && requestId > 0 && format === "export") {
    const mfaDenied = requireSensitiveActionMfa(session);
    if (mfaDenied) return mfaDenied;

    const [privacyRequest] = await db.select().from(dataRequests).where(and(
      eq(dataRequests.id, requestId),
      eq(dataRequests.organizationId, organizationId),
    )).limit(1);
    if (!privacyRequest) return Response.json({ error: "Data-subject request not found." }, { status: 404 });
    if (!["access", "portability"].includes(privacyRequest.requestType)) {
      return Response.json({ error: "A structured export is available only for access or portability requests." }, { status: 409 });
    }

    const subjectEmployees = await db.select().from(employees).where(and(
      eq(employees.organizationId, organizationId),
      eq(employees.email, privacyRequest.subjectEmail),
    ));
    const employeeIds = subjectEmployees.map((employee) => employee.id);
    const payroll = employeeIds.length
      ? await db.select({ entry: payrollEntries, run: payrollRuns })
          .from(payrollEntries)
          .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
          .where(eq(payrollRuns.organizationId, organizationId))
      : [];
    const subjectPayroll = payroll.filter((row) => employeeIds.includes(row.entry.employeeId));
    const loans = employeeIds.length
      ? (await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, organizationId)))
          .filter((loan) => employeeIds.includes(loan.employeeId))
      : [];
    const separations = employeeIds.length
      ? (await db.select().from(separationRecords).where(eq(separationRecords.organizationId, organizationId)))
          .filter((record) => employeeIds.includes(record.employeeId))
      : [];

    const exportedAt = new Date().toISOString();
    const payload = {
      request: {
        id: privacyRequest.id,
        type: privacyRequest.requestType,
        subjectEmail: privacyRequest.subjectEmail,
        requestedAt: privacyRequest.requestedAt,
        exportedAt,
      },
      employees: subjectEmployees.map((employee) => ({
        ...employee,
        bankAccount: decryptBankAccount(employee.bankAccount),
        tin: decryptGovernmentId(employee.tin),
        tinBranchCode: decryptGovernmentId(employee.tinBranchCode),
        sssNo: decryptGovernmentId(employee.sssNo),
        philHealthNo: decryptGovernmentId(employee.philHealthNo),
        pagIbigNo: decryptGovernmentId(employee.pagIbigNo),
      })),
      payroll: subjectPayroll,
      loans,
      separations,
    };

    await recordAuditEvent({
      organizationId,
      actor: session.name,
      action: "Data subject access export generated",
      resource: `${privacyRequest.requestType} · ${privacyRequest.subjectEmail}`,
      metadata: {
        requestId: privacyRequest.id,
        exportedAt,
        employeeRecords: subjectEmployees.length,
        payrollEntries: subjectPayroll.length,
        loans: loans.length,
        separations: separations.length,
      },
    });

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="data-subject-request-${privacyRequest.id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const rows = await db.select().from(dataRequests).where(eq(dataRequests.organizationId, organizationId)).orderBy(desc(dataRequests.id));

  const now = Date.now();
  return Response.json({
    internalResponseTargetDays: INTERNAL_RESPONSE_TARGET_DAYS,
    retentionSchedule: RECORD_RETENTION_SCHEDULE,
    open: rows.filter((row) => row.status === "received" || row.status === "in_progress").length,
    overdue: rows.filter((row) => row.status !== "completed" && new Date(row.dueAt).getTime() < now).length,
    requests: rows.map((row) => ({
      ...row,
      daysRemaining: Math.ceil((new Date(row.dueAt).getTime() - now) / 86_400_000),
      overdue: row.status !== "completed" && new Date(row.dueAt).getTime() < now,
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const subjectEmail = String(body.subjectEmail ?? "").trim().toLowerCase();
  const requestType = String(body.requestType ?? "").trim();
  const types = ["access", "correction", "deletion", "portability", "objection"];

  if (!Number.isInteger(organizationId) || !subjectEmail || !types.includes(requestType)) {
    return Response.json({ error: `organizationId, subjectEmail and a requestType of ${types.join("/")} are required.` }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    ["owner", "admin", "hr"],
    "Only privacy administrators can create data-subject requests.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Data-subject requests require company-wide privacy administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;

  const [row] = await db.insert(dataRequests).values({
    organizationId,
    subjectEmail,
    requestType,
    status: "received",
    dueAt: new Date(Date.now() + INTERNAL_RESPONSE_TARGET_DAYS * 86_400_000),
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Data subject request logged",
    resource: `${requestType} · ${subjectEmail}`,
    metadata: { requestId: row.id, dueAt: row.dueAt, internalResponseTargetDays: INTERNAL_RESPONSE_TARGET_DAYS },
  });

  return Response.json({ ...row, daysRemaining: INTERNAL_RESPONSE_TARGET_DAYS }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!Number.isInteger(id) || !["received", "in_progress", "completed", "rejected"].includes(status)) {
    return Response.json({ error: "id and a valid status are required." }, { status: 400 });
  }

  const [existing] = await db.select().from(dataRequests).where(eq(dataRequests.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Request not found." }, { status: 404 });
  const deniedPatch = await assertOrganizationRole(
    session.id,
    existing.organizationId ?? 0,
    ["owner", "admin", "hr"],
    "Only privacy administrators can update data-subject requests.",
  );
  if (deniedPatch) return deniedPatch;
  const access = await getAccess(session.id, existing.organizationId ?? 0);
  if (!access?.companyWide) {
    return Response.json({ error: "Data-subject requests require company-wide privacy administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;

  let fulfillmentAction = String(body.fulfillmentAction ?? "").trim().slice(0, 64);
  let fulfillmentEvidence =
    body.fulfillmentEvidence && typeof body.fulfillmentEvidence === "object" && !Array.isArray(body.fulfillmentEvidence)
      ? body.fulfillmentEvidence as Record<string, unknown>
      : {};
  let legalRetentionApplied = Boolean(body.legalRetentionApplied);

  const executeInApp = Boolean(body.executeInApp);
  if (executeInApp && existing.requestType === "correction") {
    const correction =
      body.correction && typeof body.correction === "object" && !Array.isArray(body.correction)
        ? body.correction as Record<string, unknown>
        : {};

    const allowedFields = new Set([
      "firstName",
      "middleName",
      "lastName",
      "mobile",
      "email",
      "nationality",
      "birthDate",
      "emergencyContact",
      "emergencyPhone",
      "education",
      "tin",
      "tinBranchCode",
      "sssNo",
      "philHealthNo",
      "pagIbigNo",
    ]);
    const requestedFields = Object.keys(correction);
    const disallowed = requestedFields.filter((field) => !allowedFields.has(field));
    if (requestedFields.length === 0 || disallowed.length > 0) {
      return Response.json({
        error: "Correction execution requires at least one supported profile field and cannot change payroll, role, status, rate, or payout-destination fields.",
        allowedFields: [...allowedFields],
        disallowed,
      }, { status: 400 });
    }

    const subjectEmployees = await db.select().from(employees).where(and(
      eq(employees.organizationId, existing.organizationId ?? 0),
      eq(employees.email, existing.subjectEmail),
    ));
    if (subjectEmployees.length === 0) {
      return Response.json({ error: "No employee record matches this request's subject email." }, { status: 404 });
    }

    const clean = (value: unknown, max: number) => {
      const next = String(value ?? "").trim();
      return next ? next.slice(0, max) : null;
    };
    const patch: Partial<typeof employees.$inferInsert> = {};
    if ("firstName" in correction) {
      const value = clean(correction.firstName, 80);
      if (!value) return Response.json({ error: "firstName cannot be blank." }, { status: 400 });
      patch.firstName = value;
    }
    if ("middleName" in correction) patch.middleName = clean(correction.middleName, 80);
    if ("lastName" in correction) {
      const value = clean(correction.lastName, 80);
      if (!value) return Response.json({ error: "lastName cannot be blank." }, { status: 400 });
      patch.lastName = value;
    }
    if ("mobile" in correction) patch.mobile = clean(correction.mobile, 24);
    if ("email" in correction) {
      const value = clean(correction.email, 200)?.toLowerCase() ?? null;
      if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return Response.json({ error: "Corrected email is invalid." }, { status: 400 });
      }
      patch.email = value;
    }
    if ("nationality" in correction) patch.nationality = clean(correction.nationality, 60) ?? "Filipino";
    if ("birthDate" in correction) {
      const value = clean(correction.birthDate, 10);
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return Response.json({ error: "birthDate must be YYYY-MM-DD." }, { status: 400 });
      }
      patch.birthDate = value;
    }
    if ("emergencyContact" in correction) patch.emergencyContact = clean(correction.emergencyContact, 120);
    if ("emergencyPhone" in correction) patch.emergencyPhone = clean(correction.emergencyPhone, 32);
    if ("education" in correction) patch.education = clean(correction.education, 120);

    const sealGovernmentId = (value: unknown) =>
      encryptGovernmentId(clean(value, 80), { required: process.env.NODE_ENV === "production" });
    if ("tin" in correction) patch.tin = sealGovernmentId(correction.tin);
    if ("tinBranchCode" in correction) patch.tinBranchCode = sealGovernmentId(correction.tinBranchCode);
    if ("sssNo" in correction) patch.sssNo = sealGovernmentId(correction.sssNo);
    if ("philHealthNo" in correction) patch.philHealthNo = sealGovernmentId(correction.philHealthNo);
    if ("pagIbigNo" in correction) patch.pagIbigNo = sealGovernmentId(correction.pagIbigNo);

    for (const employee of subjectEmployees) {
      await db.update(employees).set(patch).where(and(
        eq(employees.id, employee.id),
        eq(employees.organizationId, existing.organizationId ?? 0),
      ));
    }

    fulfillmentAction = "corrected-in-app";
    fulfillmentEvidence = {
      executedAt: new Date().toISOString(),
      employeeIds: subjectEmployees.map((employee) => employee.id),
      correctedFields: requestedFields,
      payoutDestinationChanged: false,
      payrollHistoryChanged: false,
    };
  }

  if (executeInApp && existing.requestType === "deletion") {
    const subjectEmployees = await db.select().from(employees).where(and(
      eq(employees.organizationId, existing.organizationId ?? 0),
      eq(employees.email, existing.subjectEmail),
    ));
    if (subjectEmployees.length === 0) {
      return Response.json({ error: "No employee record matches this request's subject email." }, { status: 404 });
    }
    const active = subjectEmployees.filter((employee) => employee.status === "Active");
    if (active.length > 0) {
      return Response.json({
        error: "In-app deletion is limited to separated/inactive employees. Active employment records have an ongoing payroll and employment purpose.",
        employeeIds: active.map((employee) => employee.id),
      }, { status: 409 });
    }

    for (const employee of subjectEmployees) {
      await db.update(employees).set({
        bankAccount: null,
        bankCode: null,
        mobile: null,
        email: null,
        emergencyContact: null,
        emergencyPhone: null,
        education: null,
      }).where(and(
        eq(employees.id, employee.id),
        eq(employees.organizationId, existing.organizationId ?? 0),
      ));
    }

    fulfillmentAction = "restricted";
    legalRetentionApplied = true;
    fulfillmentEvidence = {
      executedAt: new Date().toISOString(),
      employeeIds: subjectEmployees.map((employee) => employee.id),
      deletedProfileFields: [
        "bankAccount",
        "bankCode",
        "mobile",
        "email",
        "emergencyContact",
        "emergencyPhone",
        "education",
      ],
      retainedRecordClasses: ["payrollAccountingTax", "employmentLaborRecords"],
      retentionAssessment:
        "Non-essential contact, payout-destination, emergency-contact and education profile data was cleared in-app. Payroll, tax, statutory-identification and employment records remain restricted to their legal/accountability retention schedule and any legal hold.",
      payrollHistoryChanged: false,
    };
  }

  if (status === "completed") {
    if (existing.requestType === "access" || existing.requestType === "portability") {
      const evidenceOrganizationId = existing.organizationId ?? 0;
      const evidence = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, evidenceOrganizationId));
      const exportExists = evidence.some((event) =>
        event.action === "Data subject access export generated"
        && event.metadata
        && typeof event.metadata === "object"
        && Number((event.metadata as Record<string, unknown>).requestId) === existing.id
      );
      if (!exportExists) {
        return Response.json({
          error: "Generate the subject access/portability export before marking this request completed.",
        }, { status: 409 });
      }
    } else if (!fulfillmentAction || Object.keys(fulfillmentEvidence).length === 0) {
      return Response.json({
        error: "Correction, deletion, and objection requests require a fulfillment action and evidence before completion.",
      }, { status: 409 });
    }

    if (existing.requestType === "deletion") {
      const allowedDeletionActions = new Set([
        "deleted",
        "anonymized",
        "restricted",
        "retained-under-legal-obligation",
      ]);
      const retentionAssessment = String(
        (fulfillmentEvidence as Record<string, unknown>).retentionAssessment ?? "",
      ).trim();
      if (!allowedDeletionActions.has(fulfillmentAction) || !retentionAssessment) {
        return Response.json({
          error: "Deletion completion requires a supported disposition action and a documented retention assessment.",
          allowedActions: [...allowedDeletionActions],
        }, { status: 409 });
      }
      if (fulfillmentAction === "retained-under-legal-obligation" && !legalRetentionApplied) {
        return Response.json({
          error: "Mark legalRetentionApplied when deletion is denied or restricted because records must be retained.",
        }, { status: 409 });
      }
    }
  }

  const [row] = await db.update(dataRequests).set({
    status,
    completedAt: status === "completed" ? new Date() : null,
    handledBy: session.name,
    notes: String(body.notes ?? "").slice(0, 400) || undefined,
    fulfillmentAction: fulfillmentAction || undefined,
    fulfillmentEvidence,
    legalRetentionApplied,
  }).where(eq(dataRequests.id, id)).returning();

  if (!row) return Response.json({ error: "Request not found." }, { status: 404 });

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: session.name,
    action: `Data request ${status.replace("_", " ")}`,
    resource: `${row.requestType} · ${row.subjectEmail}`,
    metadata: {
      requestId: row.id,
      fulfillmentAction: row.fulfillmentAction,
      legalRetentionApplied: row.legalRetentionApplied,
      evidenceRecorded: Boolean(row.fulfillmentEvidence && Object.keys(row.fulfillmentEvidence as Record<string, unknown>).length),
    },
  });

  return Response.json(row);
}
