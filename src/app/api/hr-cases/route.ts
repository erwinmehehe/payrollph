import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documentObjectKey, putDocumentObject } from "@/lib/document-object-storage";
import { auditEvents, documents, employeeHrCaseMessages, employeeHrCases, employees, organizations } from "@/db/schema";
import {
  assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  approvedCoeText, HR_CASE_TYPES, hrCaseDueAt, hrCaseSlaStatus,
  hrCaseTransitionAllowed, hrCaseRoleCanWork, visibleHrCaseMessages,
  isHrCaseType, type HrCaseStatus,
} from "@/lib/hr-case-policy";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const STATES = new Set(["open", "in_progress", "waiting_employee", "resolved", "closed"]);
const enabled = () => criticalReleaseFlagEnabled("employeeHrCases");
const unavailable = () => Response.json({ error: "HR cases are not enabled for this release." }, { status: 404 });
const caseIdValid = (n: number) => Number.isSafeInteger(n) && n > 0;
const restrictedStaff = (role: string) => !["owner", "admin", "hr", "payroll"].includes(role);
const noStore = { "Cache-Control": "private, no-store" } as const;

async function employeeForSession(session: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  if (session.role !== "employee" || !session.employeeId) return null;
  const [worker] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!worker) return null;
  const denied = await assertMembership(session.id, worker.organizationId);
  return denied ? null : worker;
}

export async function GET(request: Request) {
  if (!enabled()) return unavailable();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const isEmployee = user.role === "employee";
  const worker = isEmployee ? await employeeForSession(user) : null;
  if (isEmployee && !worker) return Response.json({ error: "Employee access denied." }, { status: 403 });
  const organizationId = worker?.organizationId ?? Number(new URL(request.url).searchParams.get("organizationId"));
  if (!caseIdValid(organizationId)) return Response.json({ error: "Valid organizationId required." }, { status: 400 });

  const access = isEmployee ? null : await getAccess(user.id, organizationId);
  if (!isEmployee) {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES);
    if (denied) return denied;
    if (!access || restrictedStaff(access.role)) {
      return Response.json({ error: "HR case inbox access denied." }, { status: 403 });
    }
  }
  const staff = isEmployee ? [] : await db.select({
    id: employees.id, orgUnitId: employees.orgUnitId,
    firstName: employees.firstName, lastName: employees.lastName,
    title: employees.title, startDate: employees.startDate,
  }).from(employees).where(eq(employees.organizationId, organizationId));
  const visibleIds = isEmployee ? [worker!.id] :
    staff.filter(row => access!.companyWide || row.orgUnitId === access!.orgUnitId).map(row => row.id);
  const cases = visibleIds.length ? await db.select().from(employeeHrCases).where(and(
    eq(employeeHrCases.organizationId, organizationId),
    inArray(employeeHrCases.employeeId, visibleIds),
    !isEmployee && (access!.role === "hr" || access!.role === "payroll")
      ? eq(employeeHrCases.assignedRole, access!.role) : undefined,
  )).orderBy(desc(employeeHrCases.createdAt), desc(employeeHrCases.id)).limit(100) : [];
  const caseIds = cases.map(row => row.id);
  const messages = caseIds.length ? await db.select().from(employeeHrCaseMessages).where(and(
    eq(employeeHrCaseMessages.organizationId, organizationId),
    inArray(employeeHrCaseMessages.caseId, caseIds),
    isEmployee ? eq(employeeHrCaseMessages.visibility, "employee") : undefined,
  )).orderBy(employeeHrCaseMessages.createdAt).limit(500) : [];
  const peopleById = new Map(staff.map(item => [item.id, item]));
  return Response.json({
    cases: cases.filter(row => isEmployee || hrCaseRoleCanWork(access!.role, row.assignedRole))
      .map(row => {
        const person = peopleById.get(row.employeeId);
        return {
          ...row,
          employeeName: person ? person.firstName + " " + person.lastName : undefined,
          employeeTitle: person?.title,
          employeeStartDate: person?.startDate,
          sla: hrCaseSlaStatus(row.slaDueAt, row.status),
          messages: visibleHrCaseMessages(
            messages.filter(message => message.caseId === row.id),
            isEmployee ? "employee" : "staff",
          ),
        };
      }),
  }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!enabled()) return unavailable();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const worker = await employeeForSession(user);
  if (!worker) return Response.json({ error: "Linked employee access required." }, { status: 403 });
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "employee-hr-case", resourceId: worker.organizationId,
    limit: 8, windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;
  const body = await request.json().catch(() => ({}));
  const caseType = body.caseType;
  const subject = String(body.subject ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!isHrCaseType(caseType) || subject.length < 4 || subject.length > 160
    || description.length < 12 || description.length > 3000) {
    return Response.json({ error: "Select a valid request type, subject (4-160) and description (12-3000)." }, { status: 422 });
  }
  const now = new Date();
  const created = await db.transaction(async tx => {
    const [row] = await tx.insert(employeeHrCases).values({
      organizationId: worker.organizationId, employeeId: worker.id, createdByUserId: user.id,
      caseType, subject, description, assignedRole: HR_CASE_TYPES[caseType].assignedRole,
      slaDueAt: hrCaseDueAt(caseType, now),
    }).returning();
    await tx.insert(employeeHrCaseMessages).values({
      organizationId: worker.organizationId, caseId: row.id, actorUserId: user.id,
      visibility: "employee", body: description,
    });
    await tx.insert(auditEvents).values({
      organizationId: worker.organizationId, actor: user.name,
      action: "Employee HR request submitted", resource: String(row.id),
      metadata: { caseId: row.id, caseType, employeeId: worker.id, assignedRole: row.assignedRole },
    });
    return row;
  });
  return Response.json({ case: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!enabled()) return unavailable();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const caseId = Number(body.id);
  if (!caseIdValid(caseId)) return Response.json({ error: "Case id required." }, { status: 422 });
  const [existing] = await db.select().from(employeeHrCases).where(eq(employeeHrCases.id, caseId)).limit(1);
  if (!existing) return Response.json({ error: "Case not found." }, { status: 404 });
  const isEmployee = user.role === "employee";
  if (isEmployee) {
    const worker = await employeeForSession(user);
    if (!worker || worker.organizationId !== existing.organizationId || worker.id !== existing.employeeId) {
      return Response.json({ error: "Case not found." }, { status: 404 });
    }
  } else {
    const denied = await assertOrganizationRole(user.id, existing.organizationId, PEOPLE_PAYROLL_ROLES);
    if (denied) return denied;
    const access = await getAccess(user.id, existing.organizationId);
    if (!access || !hrCaseRoleCanWork(access.role, existing.assignedRole)) {
      return Response.json({ error: "Case not found." }, { status: 404 });
    }
    const [worker] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees).where(and(
      eq(employees.id, existing.employeeId), eq(employees.organizationId, existing.organizationId),
    )).limit(1);
    const scope = assertScope(access, worker?.orgUnitId ?? null);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  }
  const action = String(body.action ?? "");
  if (isEmployee && action !== "reply") return Response.json({ error: "Employee action is not permitted." }, { status: 403 });
  if (!["reply", "internal_note", "status", "approve_coe"].includes(action)) {
    return Response.json({ error: "Invalid case action." }, { status: 422 });
  }
  const message = String(body.message ?? "").trim();
  if (["reply", "internal_note"].includes(action) && (message.length < 2 || message.length > 3000)) {
    return Response.json({ error: "Reply must be 2-3000 characters." }, { status: 422 });
  }
  if (action === "approve_coe") {
    if (isEmployee) return Response.json({ error: "Employees cannot approve COEs." }, { status: 403 });
    const access = await getAccess(user.id, existing.organizationId);
    if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
      return Response.json({ error: "Company-wide HR approval required." }, { status: 403 });
    }
    if (!criticalReleaseFlagEnabled("employeeDocumentVault")) {
      return Response.json({ error: "COE issuance requires the audited private document vault." }, { status: 503 });
    }
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    if (existing.createdByUserId === user.id) {
      return Response.json({ error: "Maker and COE approver must be different users." }, { status: 403 });
    }
  }
  const outcome = await db.transaction(async tx => {
    const [row] = await tx.select().from(employeeHrCases).where(and(
      eq(employeeHrCases.id, caseId), eq(employeeHrCases.organizationId, existing.organizationId),
    )).for("update").limit(1);
    if (!row || row.status === "closed") throw new Error("CASE_CLOSED_OR_MISSING");
    let result = row;
    if (action === "approve_coe") {
      if (row.caseType !== "coe" || row.coeDocumentId != null) throw new Error("COE_ALREADY_APPROVED_OR_WRONG_TYPE");
      const [worker] = await tx.select().from(employees).where(and(
        eq(employees.id, row.employeeId), eq(employees.organizationId, row.organizationId),
      )).limit(1);
      const [employer] = await tx.select().from(organizations)
        .where(eq(organizations.id, row.organizationId)).limit(1);
      if (!worker || !employer) throw new Error("COE_SOURCE_NOT_FOUND");
      const approvedDate = new Date().toISOString().slice(0, 10);
      const text = approvedCoeText({
        employerName: employer.legalName, employeeName: worker.firstName + " " + worker.lastName,
        employeeTitle: worker.title, startDate: worker.startDate, approvedBy: user.name,
        approvedDate,
      });
      const content = Buffer.from(text, "utf8");
      const objectKey = documentObjectKey(row.organizationId, row.employeeId);
      await putDocumentObject(objectKey, content, "text/plain; charset=utf-8");
      const [document] = await tx.insert(documents).values({
        organizationId: row.organizationId, employeeId: row.employeeId,
        kind: "coe", fileName: "coe-" + worker.employeeNo + "-" + caseId + ".txt",
        mimeType: "text/plain; charset=utf-8", byteSize: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        scannedClean: true, scanNote: "Generated and independently reviewed COE",
        sourceType: "generated", sourceKey: "hr-case-coe:" + caseId,
        generationMetadata: { caseId, template: "coe-v1", approvedByUserId: user.id, approvedDate },
        uploadedBy: user.name, uploadedByUserId: user.id, content: "", objectStorageKey: objectKey,
      }).returning({ id: documents.id });
      [result] = await tx.update(employeeHrCases).set({
        coeDocumentId: document.id, coeApprovedByUserId: user.id,
        coeApprovedAt: new Date(), status: "resolved", updatedAt: new Date(),
      }).where(eq(employeeHrCases.id, caseId)).returning();
    } else if (action === "status") {
      if (isEmployee) throw new Error("FORBIDDEN_CASE_TRANSITION");
      const next = String(body.status ?? "") as HrCaseStatus;
      if (!STATES.has(next) || !hrCaseTransitionAllowed(
        row.status as HrCaseStatus, next, row.caseType as keyof typeof HR_CASE_TYPES,
        row.coeDocumentId != null,
      )) throw new Error("INVALID_CASE_TRANSITION");
      [result] = await tx.update(employeeHrCases).set({
        status: next, updatedAt: new Date(),
      }).where(eq(employeeHrCases.id, caseId)).returning();
    } else {
      await tx.insert(employeeHrCaseMessages).values({
        organizationId: row.organizationId, caseId, actorUserId: user.id,
        visibility: action === "internal_note" ? "internal" : "employee", body: message,
      });
      if (isEmployee && row.status === "waiting_employee") {
        [result] = await tx.update(employeeHrCases).set({
          status: "in_progress", updatedAt: new Date(),
        }).where(eq(employeeHrCases.id, caseId)).returning();
      }
    }
    await tx.insert(auditEvents).values({
      organizationId: row.organizationId, actor: user.name,
      action: "HR case " + action, resource: String(caseId),
      metadata: { caseId, employeeId: row.employeeId, newStatus: result.status,
        visibility: action === "internal_note" ? "internal" : "employee",
        documentId: result.coeDocumentId, actorUserId: user.id },
    });
    return result;
  }).catch(e => e instanceof Error ? e : new Error("CASE_UPDATE_FAILED"));
  if (outcome instanceof Error) {
    return Response.json({ error: outcome.message }, { status: 409 });
  }
  return Response.json({ case: outcome });
}
