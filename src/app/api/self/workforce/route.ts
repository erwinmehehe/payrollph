import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests,
  employees,
  timePunches,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  attendancePunchSnapshot,
  normalizeAttendanceCorrection,
} from "@/lib/workforce-attendance-correction";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validWindow(startDate: string, endDate: string) {
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || endDate < startDate) return false;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Number.isFinite(start)
    && Number.isFinite(end)
    && Math.floor((end - start) / 86_400_000) + 1 <= 42;
}

async function selfEmployee() {
  const session = await getSessionUser();
  if (!session) {
    return {
      session: null,
      employee: null,
      denied: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  if (session.role !== "employee" || !session.employeeId) {
    return {
      session,
      employee: null,
      denied: Response.json({ error: "Employee self-service account required." }, { status: 403 }),
    };
  }
  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);
  if (!employee) {
    return {
      session,
      employee: null,
      denied: Response.json({ error: "Employee record not found." }, { status: 404 }),
    };
  }
  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return { session, employee: null, denied: membershipDenied };
  return { session, employee, denied: null };
}

export async function GET(request: Request) {
  const self = await selfEmployee();
  if (self.denied) return self.denied;
  const employee = self.employee!;

  const url = new URL(request.url);
  const today = todayPh();
  const startDate = String(url.searchParams.get("startDate") ?? addDays(today, -7)).trim();
  const endDate = String(url.searchParams.get("endDate") ?? addDays(today, 14)).trim();
  if (!validWindow(startDate, endDate)) {
    return Response.json({
      error: "Self-service workforce range must use valid YYYY-MM-DD dates and cannot exceed 42 days.",
    }, { status: 400 });
  }

  const [schedule, punches, corrections] = await Promise.all([
    resolveEmployeeScheduleWindow({
      organizationId: employee.organizationId,
      employeeId: employee.id,
      startDate,
      endDate,
    }),
    db.select({
      id: timePunches.id,
      workDate: timePunches.workDate,
      timeIn: timePunches.timeIn,
      timeOut: timePunches.timeOut,
      breakStart: timePunches.breakStart,
      breakEnd: timePunches.breakEnd,
      status: timePunches.status,
      source: timePunches.source,
    }).from(timePunches).where(and(
      eq(timePunches.organizationId, employee.organizationId),
      eq(timePunches.employeeId, employee.id),
      gte(timePunches.workDate, startDate),
      lte(timePunches.workDate, endDate),
    )).orderBy(desc(timePunches.workDate), desc(timePunches.id)),
    db.select().from(attendanceCorrectionRequests).where(and(
      eq(attendanceCorrectionRequests.organizationId, employee.organizationId),
      eq(attendanceCorrectionRequests.employeeId, employee.id),
      gte(attendanceCorrectionRequests.workDate, startDate),
      lte(attendanceCorrectionRequests.workDate, endDate),
    )).orderBy(desc(attendanceCorrectionRequests.createdAt), desc(attendanceCorrectionRequests.id)),
  ]);

  return Response.json({
    range: { startDate, endDate },
    employee: {
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
    },
    schedule,
    punches,
    corrections,
    boundary: "Employee self-service resolves employee and organization scope from the authenticated session; client-supplied employee or organization identifiers are not accepted."
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const self = await selfEmployee();
  if (self.denied) return self.denied;
  const session = self.session!;
  const employee = self.employee!;

  const demoDenied = publicDemoMutationDenied(
    session.email,
    "Employee self-service attendance correction request",
  );
  if (demoDenied) return demoDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id,
    action: "self-workforce-attendance-correction-request",
    resourceId: employee.id,
    limit: 12,
    windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "").trim();
  if (action !== "request_correction") {
    return Response.json({ error: "Unsupported action. Use request_correction." }, { status: 400 });
  }

  const punchId = Number(body.punchId);
  const reason = String(body.reason ?? "").trim().slice(0, 240);
  if (!Number.isInteger(punchId) || reason.length < 3) {
    return Response.json({ error: "punchId and a correction reason are required." }, { status: 400 });
  }

  const [punch] = await db.select().from(timePunches).where(and(
    eq(timePunches.id, punchId),
    eq(timePunches.organizationId, employee.organizationId),
    eq(timePunches.employeeId, employee.id),
  )).limit(1);
  if (!punch) {
    return Response.json({ error: "Attendance punch not found in your employee record." }, { status: 404 });
  }

  const [pending] = await db.select({ id: attendanceCorrectionRequests.id })
    .from(attendanceCorrectionRequests)
    .where(and(
      eq(attendanceCorrectionRequests.organizationId, employee.organizationId),
      eq(attendanceCorrectionRequests.employeeId, employee.id),
      eq(attendanceCorrectionRequests.punchId, punch.id),
      eq(attendanceCorrectionRequests.status, "pending"),
    ))
    .limit(1);
  if (pending) {
    return Response.json({ error: "This attendance punch already has a pending correction request." }, { status: 409 });
  }

  const original = attendancePunchSnapshot(punch);
  let proposed;
  try {
    proposed = normalizeAttendanceCorrection({
      original,
      proposedTimeIn: body.proposedTimeIn,
      proposedTimeOut: body.proposedTimeOut,
      proposedBreakStart: body.proposedBreakStart,
      proposedBreakEnd: body.proposedBreakEnd,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Attendance correction is invalid.",
    }, { status: 422 });
  }

  const [created] = await db.insert(attendanceCorrectionRequests).values({
    organizationId: employee.organizationId,
    employeeId: employee.id,
    punchId: punch.id,
    workDate: punch.workDate,
    originalPunchSnapshot: original,
    proposedPunchSnapshot: proposed,
    reason,
    status: "pending",
    requestedBy: session.name,
    requestedByUserId: session.id,
  }).returning();

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: session.name,
    action: "Employee self-service attendance correction requested",
    resource: `${employee.employeeNo} · ${punch.workDate}`,
    metadata: {
      attendanceCorrectionRequestId: created.id,
      employeeId: employee.id,
      punchId: punch.id,
      originalPunchSnapshot: original,
      proposedPunchSnapshot: proposed,
      approvalRequired: true,
      payrollMutationPerformed: false,
    },
  });

  return Response.json({
    correction: created,
    message: "Correction request submitted for manager review. Attendance and payroll were not changed.",
  }, { status: 201 });
}
