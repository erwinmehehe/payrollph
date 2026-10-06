import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employeePayProfiles, employees, hcmLeaveTimeWindows, leavePolicies, leaveRequests, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, getAccess, roleAllowed } from "@/lib/access";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { preciseLeaveDayEquivalent, preciseLeaveMinutes } from "@/lib/workforce-absence";

export const dynamic = "force-dynamic";

const LEAVE_ADMIN_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
const LEAVE_APPROVER_ROLES = ["manager", "hr", "owner", "admin", "bookkeeper"] as const;

export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  await ensureLeavePayrollSchema();
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  let employeeIds: number[] | null = null;
  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    employeeIds = [user.employeeId];
  } else if (!roleAllowed(access.role, LEAVE_ADMIN_ROLES)) {
    return Response.json({ error: "Your role cannot view leave requests." }, { status: 403 });
  } else if (access.role === "manager" && !access.companyWide && access.orgUnitId) {
    const team = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.organizationId, organizationId), eq(employees.orgUnitId, access.orgUnitId)));
    employeeIds = team.map((row) => row.id);
  }

  const rows = await db.select({
    leave: leaveRequests,
    employee: employees,
  })
    .from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .where(eq(leaveRequests.organizationId, organizationId))
    .orderBy(desc(leaveRequests.id));

  const visible = employeeIds
    ? rows.filter(({ leave }) => employeeIds!.includes(leave.employeeId))
    : rows;

  const windows = visible.length
    ? await db.select().from(hcmLeaveTimeWindows).where(and(
        eq(hcmLeaveTimeWindows.organizationId, organizationId),
        inArray(hcmLeaveTimeWindows.leaveRequestId, visible.map(({ leave }) => leave.id)),
      ))
    : [];
  const windowByRequest = new Map(windows.map((window) => [window.leaveRequestId, window]));

  return Response.json({
    requests: visible.map(({ leave, employee }) => ({
      ...leave,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      avatarInitials: employee.avatarInitials,
      timeWindow: windowByRequest.get(leave.id) ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  await ensureLeavePayrollSchema();

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  let employeeId = Number(body.employeeId);
  const leaveType = String(body.leaveType ?? "").trim();
  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const timingMode = body.timingMode === "timed" ? "timed" : "range";
  const startTime = String(body.startTime ?? "");
  const endTime = String(body.endTime ?? "");
  let days = Number(body.days);
  let timedMinutes: number | null = null;
  let standardDayMinutes: number | null = null;
  const reason = String(body.reason ?? "").trim();

  if (
    !Number.isInteger(organizationId) ||
    !leaveType ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
    endDate < startDate ||
    (timingMode === "range" && (!Number.isFinite(days) || days <= 0))
    || (timingMode === "timed" && startDate !== endDate)
  ) {
    return Response.json({
      error: "organizationId, leaveType, valid start/end dates and positive days are required.",
    }, { status: 400 });
  }

  const deniedMembership = await assertMembership(user.id, organizationId);
  if (deniedMembership) return deniedMembership;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    employeeId = user.employeeId;
  } else if (!roleAllowed(access.role, LEAVE_ADMIN_ROLES)) {
    return Response.json({ error: "Your role cannot submit leave requests for employees." }, { status: 403 });
  }

  if (!Number.isInteger(employeeId)) {
    return Response.json({ error: "employeeId is required." }, { status: 400 });
  }

  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });

  if (timingMode === "timed") {
    const [profile] = await db.select({ standardHoursPerDay: employeePayProfiles.standardHoursPerDay })
      .from(employeePayProfiles).where(and(
        eq(employeePayProfiles.organizationId, organizationId),
        eq(employeePayProfiles.employeeId, employeeId),
      )).limit(1);
    if (!profile) {
      return Response.json({
        error: "Configure the worker's standard payroll hours per day before requesting clock-precise leave.",
      }, { status: 422 });
    }
    try {
      standardDayMinutes = Math.round(Number(profile.standardHoursPerDay) * 60);
      timedMinutes = preciseLeaveMinutes(startTime, endTime);
      days = preciseLeaveDayEquivalent(timedMinutes, standardDayMinutes);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Invalid single-day timed leave.",
      }, { status: 400 });
    }

    const rows = await db.select().from(leaveRequests).where(and(
      eq(leaveRequests.organizationId, organizationId),
      eq(leaveRequests.employeeId, employeeId),
    ));
    if (rows.some((row) =>
      ["Pending", "Approved"].includes(row.status)
      && String(row.startDate) <= startDate && String(row.endDate) >= startDate
    )) {
      return Response.json({
        error: "Another pending or approved leave request already covers this date. Resolve it before entering exact hours.",
      }, { status: 409 });
    }
  }

  if (
    access.role === "manager" &&
    !access.companyWide &&
    access.orgUnitId &&
    employee.orgUnitId !== access.orgUnitId
  ) {
    return Response.json({ error: "Managers can submit leave only for employees in their assigned unit." }, { status: 403 });
  }

  const policies = await db.select().from(leavePolicies)
    .where(and(eq(leavePolicies.organizationId, organizationId), eq(leavePolicies.active, true)));
  const policy = policies.find(
    (item) => item.leaveType.trim().toLowerCase() === leaveType.toLowerCase(),
  );
  if (!policy || !["paid", "unpaid", "partial"].includes(policy.payTreatment.toLowerCase())) {
    return Response.json({
      error: `Configure the payroll treatment for ${leaveType} before submitting this leave request.`,
    }, { status: 422 });
  }

  const members = await db
    .select({ id: users.id, name: users.name, role: userOrganizations.role })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, organizationId));

  const priority = new Map(LEAVE_APPROVER_ROLES.map((role, index) => [role, index]));
  const approver = members
    .filter((member) => member.id !== user.id && roleAllowed(member.role, LEAVE_APPROVER_ROLES))
    .sort((a, b) => (priority.get(a.role as typeof LEAVE_APPROVER_ROLES[number]) ?? 99) - (priority.get(b.role as typeof LEAVE_APPROVER_ROLES[number]) ?? 99))[0];

  if (!approver) {
    return Response.json({
      error: "No separate leave approver is configured for this workspace. Add another manager, HR administrator, or owner before submitting.",
    }, { status: 409 });
  }

  const { task, row } = await db.transaction(async (tx) => {
    const [task] = await tx.insert(approvalTasks).values({
      organizationId,
      title: "Approve leave request",
      detail: employee.firstName + " " + employee.lastName + " · " + leaveType
        + " · " + startDate + "–" + endDate
        + (timingMode === "timed" ? " (" + startTime + "–" + endTime + ")" : ""),
      approver: approver.name,
      dueLabel: "Due in 2 days",
      priority: "Normal",
    }).returning();
    const [row] = await tx.insert(leaveRequests).values({
      organizationId, employeeId, leaveType, startDate, endDate,
      days: days.toFixed(4),
      reason: reason.slice(0, 240),
      status: "Pending",
      approvalTaskId: task.id,
    }).returning();

    if (timedMinutes != null && standardDayMinutes != null) {
      await tx.insert(hcmLeaveTimeWindows).values({
        organizationId, leaveRequestId: row.id, employeeId,
        workDate: startDate, startTime, endTime, minutes: timedMinutes,
        standardDayMinutes, exactDayEquivalent: days.toFixed(4),
      });
    }
    return { task, row };
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Leave request submitted",
    resource: `${employee.firstName} ${employee.lastName} · ${leaveType}`,
    metadata: { leaveId: row.id, taskId: task.id, approverUserId: approver.id, timingMode, startTime: timingMode === "timed" ? startTime : null, endTime: timingMode === "timed" ? endTime : null, timedMinutes, standardDayMinutes, exactDayEquivalent: days },
  });

  const automation = await runAutomationEventSafely({
    organizationId,
    employeeId,
    trigger: "leave.requested",
    eventKey: `leave-requested:${row.id}`,
    context: {
      leaveId: row.id,
      leaveType,
      leaveDays: days,
      timingMode,
      timedMinutes,
      eventAmount: days,
      startDate,
      endDate,
      approvalTaskId: task.id,
      approver: approver.name,
    },
  });

  return Response.json({ ...row, automation }, { status: 201 });
}
