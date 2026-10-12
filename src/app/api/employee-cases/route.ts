import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeeServiceCases, employeeServiceCaseMessages, employees, userOrganizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, getAccess } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const CATEGORIES = new Set(["pay_question","leave","schedule","employment_record","workplace","other"]);
const STATUSES = new Set(["open","in_review","waiting_employee","resolved"]);
const unavailable = () => Response.json({ error: "Employee requests are disabled." }, { status: 404 });
const error = (message: string, status = 400) => Response.json({ error: message }, { status });

async function authorize(userId: number, organizationId: number, employeeId: number | null | undefined) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return { denied: error("Invalid workspace.") };
  const denied = await assertMembership(userId, organizationId);
  if (denied) return { denied };
  const access = await getAccess(userId, organizationId);
  if (!access) return { denied: error("Unauthorized workspace.",403) };
  if (access.role === "employee") {
    if (!Number.isSafeInteger(employeeId) || !employeeId)
      return { denied: error("Link your employee account to use requests.",403) };
    const [worker] = await db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.id, employeeId), eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!worker) return { denied: error("Employee is not linked to this workspace.",403) };
    return { access, employeeId, hr: false as const };
  }
  if (!["owner","admin","bookkeeper","hr"].includes(access.role))
    return { denied: error("People administrators only.",403) };
  return { access, employeeId: null, hr: true as const };
}
async function scopedCase(organizationId: number, id: number,
  scope: { employeeId: number | null | undefined; hr: boolean; access: { companyWide: boolean; orgUnitId: number | null } }) {
  const [row] = await db.select({
    item: employeeServiceCases, orgUnitId: employees.orgUnitId,
    employeeName: employees.firstName, employeeSurname: employees.lastName,
  }).from(employeeServiceCases).innerJoin(employees, eq(employeeServiceCases.employeeId, employees.id))
    .where(and(eq(employeeServiceCases.organizationId, organizationId), eq(employeeServiceCases.id, id),
      eq(employees.organizationId, organizationId))).limit(1);
  if (!row) return null;
  if (!scope.hr && row.item.employeeId !== scope.employeeId) return null;
  if (scope.hr && !scope.access.companyWide && row.orgUnitId !== scope.access.orgUnitId) return null;
  return { ...row.item, employeeName: row.employeeName + " " + row.employeeSurname };
}
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("employeeCases")) return unavailable();
  const user = await getSessionUser();
  if (!user) return error("Sign in required.", 401);
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const auth = await authorize(user.id, organizationId, user.employeeId);
  if (auth.denied) return auth.denied;
  const access = auth.access!;
  const id = Number(url.searchParams.get("id") ?? "0");
  if (id) {
    if (!Number.isSafeInteger(id) || id <= 0) return error("Invalid request id.");
    const item = await scopedCase(organizationId, id,
      { employeeId: auth.employeeId, hr: auth.hr!, access });
    if (!item) return error("Request not found.",404);
    const messages = await db.select().from(employeeServiceCaseMessages).where(and(
      eq(employeeServiceCaseMessages.organizationId, organizationId),
      eq(employeeServiceCaseMessages.caseId, id),
      auth.hr ? undefined : eq(employeeServiceCaseMessages.internal, false),
    )).orderBy(employeeServiceCaseMessages.createdAt).limit(200);
    return Response.json({ item, messages }, { headers: { "Cache-Control": "private,no-store" } });
  }
  const records = await db.select({
    item: employeeServiceCases, orgUnitId: employees.orgUnitId,
    firstName: employees.firstName, lastName: employees.lastName,
  }).from(employeeServiceCases).innerJoin(employees, eq(employeeServiceCases.employeeId, employees.id))
    .where(and(eq(employeeServiceCases.organizationId, organizationId),
      eq(employees.organizationId, organizationId),
      auth.hr ? access.companyWide ? undefined : eq(employees.orgUnitId, access.orgUnitId!)
        : eq(employeeServiceCases.employeeId, auth.employeeId!),
    )).orderBy(desc(employeeServiceCases.createdAt)).limit(150);
  return Response.json({ cases: records.map(row => ({
    ...row.item, employeeName: row.firstName + " " + row.lastName,
  })) }, { headers: { "Cache-Control": "private,no-store" } });
}
export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("employeeCases")) return unavailable();
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return error("Sign in required.",401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const auth = await authorize(user.id, organizationId, user.employeeId);
  if (auth.denied) return auth.denied;
  if (auth.hr || !auth.employeeId) return error("Submit requests through your linked employee account.",403);
  const subject = String(body.subject ?? "").trim();
  const description = String(body.description ?? "").trim();
  const category = String(body.category ?? "");
  if (!CATEGORIES.has(category) || subject.length < 4 || subject.length > 160 ||
      description.length < 10 || description.length > 4000)
    return error("Category, 4–160 character subject and 10–4000 character description are required.",422);
  const limit = await rateLimitDistributed("employee-service-case:" + organizationId + ":" + user.id, {
    limit: 6, windowMs: 60*60_000,
  });
  if (!limit.allowed) return error("Too many requests. Please retry later.",429);
  const [created] = await db.transaction(async tx => {
    const [item] = await tx.insert(employeeServiceCases).values({
      organizationId, employeeId: auth.employeeId!, category, subject, description,
    }).returning();
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: "Employee service request submitted", resource: String(item.id),
      metadata: { employeeId: auth.employeeId, category, actorUserId: user.id } });
    return [item];
  });
  return Response.json({ item: created }, { status: 201 });
}
export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("employeeCases")) return unavailable();
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return error("Sign in required.",401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId), id = Number(body.id);
  const auth = await authorize(user.id, organizationId, user.employeeId);
  if (auth.denied) return auth.denied;
  if (!auth.hr) return error("HR role required.",403);
  if (!Number.isSafeInteger(id) || id <= 0 || !STATUSES.has(String(body.status)))
    return error("Valid case and status required.",400);
  const existing = await scopedCase(organizationId,id,{employeeId:null,hr:true,access:auth.access!});
  if (!existing) return error("Request not found.",404);
  const assignee = body.assignedToUserId == null ? null : Number(body.assignedToUserId);
  if (assignee !== null) {
    if (!Number.isSafeInteger(assignee) || assignee <= 0) return error("Invalid assignee.",422);
    const [member] = await db.select({ userId: userOrganizations.userId }).from(userOrganizations).where(and(
      eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.userId, assignee),
      eq(userOrganizations.active, true),
      sql`${userOrganizations.role} IN ('owner','admin','bookkeeper','hr')`,
    )).limit(1);
    if (!member) return error("Assignee must be an active member of the same workspace.",422);
  }
  const [updated] = await db.transaction(async tx => {
    const [item] = await tx.update(employeeServiceCases).set({
      status: String(body.status), assignedToUserId: assignee,
      priority: body.priority === "high" ? "high" : "normal", updatedAt: new Date(),
    }).where(and(eq(employeeServiceCases.id,id),eq(employeeServiceCases.organizationId,organizationId))).returning();
    if (!item) throw Error("Case changed before update.");
    await tx.insert(auditEvents).values({
      organizationId, actor: user.name, action: "Employee service case updated",
      resource: String(id), metadata: { status: item.status, assigneeUserId: assignee, actorUserId: user.id },
    });
    return [item];
  });
  return Response.json({ item: updated });
}
export async function PUT(request: Request) {
  if (!criticalReleaseFlagEnabled("employeeCases")) return unavailable();
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return error("Sign in required.",401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId), id = Number(body.id);
  const auth = await authorize(user.id,organizationId,user.employeeId);
  if (auth.denied) return auth.denied;
  if (!Number.isSafeInteger(id) || id<=0) return error("Invalid case.",400);
  const item = await scopedCase(organizationId,id,{employeeId:auth.employeeId,hr:auth.hr!,access:auth.access!});
  if (!item) return error("Request not found.",404);
  if (item.status === "resolved") return error("A resolved request is read-only.",409);
  const message = String(body.message ?? "").trim();
  const internal = body.internal === true && auth.hr;
  if (message.length < 2 || message.length > 2000) return error("Message must be 2–2000 characters.",422);
  if (body.internal === true && !auth.hr) return error("Internal notes are restricted to HR.",403);
  const [created] = await db.transaction(async tx => {
    const [row] = await tx.insert(employeeServiceCaseMessages).values({
      organizationId, caseId: id, authorUserId: user.id, body: message, internal,
    }).returning();
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: internal ? "Internal HR case note" : "Employee case message sent",
      resource: String(id), metadata: { messageId: row.id, actorUserId: user.id, internal } });
    return [row];
  });
  return Response.json({ message: created }, { status: 201 });
}
