import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceExceptionEvents,
  employees,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  attendanceExceptionAgeHours,
  attendanceExceptionSlaStatus,
} from "@/lib/workforce-attendance-exception-governance";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const OPERATOR_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function operationalView(row: typeof attendanceExceptionEvents.$inferSelect, now: Date) {
  return {
    ...row,
    ageHours: attendanceExceptionAgeHours(row.firstDetectedAt, now),
    slaStatus: attendanceExceptionSlaStatus({
      status: row.status,
      slaDueAt: row.slaDueAt,
      now,
    }),
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const startDate = String(url.searchParams.get("startDate") ?? "").trim();
  const endDate = String(url.searchParams.get("endDate") ?? "").trim();
  const status = String(url.searchParams.get("status") ?? "").trim();

  if (
    !Number.isInteger(organizationId)
    || !ISO_DATE.test(startDate)
    || !ISO_DATE.test(endDate)
    || endDate < startDate
    || (status && !["open", "resolved"].includes(status))
  ) {
    return Response.json({
      error: "organizationId and a valid startDate/endDate are required; status may be open or resolved.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OPERATOR_ROLES,
    "Only authorized workforce, People, or Payroll operators can review attendance exception operations.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  const employeeRows = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    orgUnitId: employees.orgUnitId,
  }).from(employees).where(eq(employees.organizationId, organizationId));

  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((row) => row.orgUnitId === access.orgUnitId);
  const employeeIds = visibleEmployees.map((row) => row.id);

  const memberships = await db.select({
    userId: userOrganizations.userId,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
    name: users.name,
    email: users.email,
  }).from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
      eq(users.active, true),
      inArray(userOrganizations.role, [...OPERATOR_ROLES]),
    ))
    .orderBy(asc(users.name), asc(users.id));

  if (employeeIds.length === 0) {
    return Response.json({
      summary: { open: 0, overdue: 0, unassigned: 0, resolved: 0 },
      exceptions: [],
      ownerCandidates: [],
    });
  }

  const predicates = [
    eq(attendanceExceptionEvents.organizationId, organizationId),
    inArray(attendanceExceptionEvents.employeeId, employeeIds),
    gte(attendanceExceptionEvents.workDate, startDate),
    lte(attendanceExceptionEvents.workDate, endDate),
  ];
  if (status) predicates.push(eq(attendanceExceptionEvents.status, status));

  const rows = await db.select().from(attendanceExceptionEvents)
    .where(and(...predicates))
    .orderBy(
      asc(attendanceExceptionEvents.status),
      asc(attendanceExceptionEvents.slaDueAt),
      asc(attendanceExceptionEvents.workDate),
      asc(attendanceExceptionEvents.id),
    );

  const now = new Date();
  const employeeById = new Map(visibleEmployees.map((row) => [row.id, row]));
  const exceptions = rows.map((row) => ({
    ...operationalView(row, now),
    employee: employeeById.get(row.employeeId) ?? null,
  }));

  return Response.json({
    summary: {
      open: exceptions.filter((row) => row.status === "open").length,
      overdue: exceptions.filter((row) => row.status === "open" && row.slaStatus === "overdue").length,
      unassigned: exceptions.filter((row) => row.status === "open" && row.ownerUserId == null).length,
      resolved: exceptions.filter((row) => row.status === "resolved").length,
    },
    exceptions,
    ownerCandidates: memberships.filter((membership) =>
      access.companyWide
      || membership.orgUnitId == null
      || membership.orgUnitId === access.orgUnitId
    ),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const eventId = Number(body.eventId);
  const action = String(body.action ?? "").trim();

  if (!Number.isInteger(organizationId) || !Number.isInteger(eventId)) {
    return Response.json({ error: "organizationId and eventId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OPERATOR_ROLES,
    "Only authorized workforce, People, or Payroll operators can manage attendance exceptions.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `wfm-attendance-exception-${action || "mutation"}`,
    resourceId: eventId,
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [event] = await db.select().from(attendanceExceptionEvents).where(and(
    eq(attendanceExceptionEvents.id, eventId),
    eq(attendanceExceptionEvents.organizationId, organizationId),
  )).limit(1);
  if (!event) return Response.json({ error: "Attendance exception event not found." }, { status: 404 });

  const [employee] = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    orgUnitId: employees.orgUnitId,
  }).from(employees).where(and(
    eq(employees.id, event.employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  if (action === "assign_owner") {
    if (event.status !== "open") {
      return Response.json({ error: "Only open attendance exceptions can be assigned." }, { status: 409 });
    }
    const rawOwnerUserId = body.ownerUserId;
    const ownerUserId = rawOwnerUserId == null || rawOwnerUserId === "" ? null : Number(rawOwnerUserId);
    if (ownerUserId != null && !Number.isInteger(ownerUserId)) {
      return Response.json({ error: "ownerUserId must be a valid user id or null." }, { status: 400 });
    }

    let ownerName: string | null = null;
    if (ownerUserId != null) {
      const [owner] = await db.select({
        userId: userOrganizations.userId,
        role: userOrganizations.role,
        orgUnitId: userOrganizations.orgUnitId,
        name: users.name,
      }).from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(and(
          eq(userOrganizations.organizationId, organizationId),
          eq(userOrganizations.userId, ownerUserId),
          eq(userOrganizations.active, true),
          eq(users.active, true),
        ))
        .limit(1);
      if (!owner || !OPERATOR_ROLES.includes(owner.role as typeof OPERATOR_ROLES[number])) {
        return Response.json({ error: "Owner must be an active authorized operator in this organization." }, { status: 422 });
      }
      if (!access.companyWide && owner.orgUnitId != null && owner.orgUnitId !== access.orgUnitId) {
        return Response.json({ error: "Scoped operators cannot assign exceptions outside their organization unit." }, { status: 403 });
      }
      ownerName = owner.name;
    }

    const [updated] = await db.update(attendanceExceptionEvents).set({
      ownerUserId,
      ownerName,
      updatedAt: new Date(),
    }).where(and(
      eq(attendanceExceptionEvents.id, eventId),
      eq(attendanceExceptionEvents.status, "open"),
    )).returning();
    if (!updated) return Response.json({ error: "Attendance exception changed before assignment." }, { status: 409 });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: ownerUserId == null
        ? "WFM attendance exception unassigned"
        : "WFM attendance exception assigned",
      resource: `${employee.employeeNo} · ${event.workDate} · ${event.exceptionKind}`,
      metadata: {
        attendanceExceptionEventId: eventId,
        employeeId: event.employeeId,
        ownerUserId,
        ownerName,
        slaDueAt: event.slaDueAt,
      },
    });

    return Response.json({ exception: operationalView(updated, new Date()) });
  }

  if (action === "record_resolution") {
    const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 1000);
    if (event.status !== "resolved") {
      return Response.json({
        error: "Resolution evidence can only be recorded after the underlying attendance exception is resolved.",
      }, { status: 409 });
    }
    if (event.resolutionRecordedAt) {
      return Response.json({ error: "Resolution evidence is immutable once recorded." }, { status: 409 });
    }
    if (resolutionNote.length < 3) {
      return Response.json({ error: "A resolution note is required." }, { status: 400 });
    }

    const now = new Date();
    const [updated] = await db.update(attendanceExceptionEvents).set({
      resolutionNote,
      resolvedByUserId: user.id,
      resolvedByName: user.name,
      resolutionRecordedAt: now,
      updatedAt: now,
    }).where(and(
      eq(attendanceExceptionEvents.id, eventId),
      eq(attendanceExceptionEvents.status, "resolved"),
    )).returning();
    if (!updated) return Response.json({ error: "Attendance exception changed before resolution evidence was recorded." }, { status: 409 });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "WFM attendance exception resolution evidence recorded",
      resource: `${employee.employeeNo} · ${event.workDate} · ${event.exceptionKind}`,
      metadata: {
        attendanceExceptionEventId: eventId,
        employeeId: event.employeeId,
        resolvedAt: event.resolvedAt,
        resolutionRecordedAt: now,
        ownerUserId: event.ownerUserId,
      },
    });

    return Response.json({ exception: operationalView(updated, now) });
  }

  return Response.json({
    error: "Unsupported action. Use assign_owner or record_resolution.",
  }, { status: 400 });
}
