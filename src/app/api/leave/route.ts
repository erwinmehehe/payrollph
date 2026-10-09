import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  auditEvents,
  employees,
  leavePolicies,
  leaveRequestIntervals,
  leaveRequestIntervalSets,
  leaveRequests,
  separationRecords,
  userOrganizations,
  users,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, getAccess, roleAllowed } from "@/lib/access";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { approvedLeaveCoverageImpact } from "@/lib/workforce-absence";
import {
  resolveLeaveIntervalsForSchedule,
  validateLeaveIntervals,
  type PreciseLeaveInterval,
} from "@/lib/workforce-absence-intervals";
import { loadResolvedEmployeeSchedule } from "@/lib/workforce-schedule-evidence-server";
import { markTimesheetsStaleForEmployeeRange } from "@/lib/workforce-timesheet-server";
import {
  checkEmployeeLeaveEligibility,
  leaveDateWindow,
  MAX_PRECISE_LEAVE_INTERVALS,
  validLeaveDate,
} from "@/lib/hcm-leave-employment";

export const dynamic = "force-dynamic";

const LEAVE_ADMIN_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
const LEAVE_APPROVER_ROLES = ["manager", "hr", "owner", "admin", "bookkeeper"] as const;

function calendarDates(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

async function validatePreciseTiming(input: {
  organizationId: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  intervals: PreciseLeaveInterval[];
}) {
  const window = leaveDateWindow(input.startDate, input.endDate);
  if (!window.ok) return { ok: false as const, errors: [window.message], intervals: [] as PreciseLeaveInterval[] };
  if (input.intervals.length === 0 || input.intervals.length > MAX_PRECISE_LEAVE_INTERVALS) {
    return {
      ok: false as const,
      errors: [`Leave timing requires 1-${MAX_PRECISE_LEAVE_INTERVALS} intervals.`],
      intervals: [] as PreciseLeaveInterval[],
    };
  }
  if (input.intervals.some((interval) => !validLeaveDate(interval.workDate))) {
    return {
      ok: false as const,
      errors: ["Each leave interval needs a real YYYY-MM-DD work date."],
      intervals: [] as PreciseLeaveInterval[],
    };
  }
  const initial = validateLeaveIntervals(input.intervals);
  if (!initial.ok) return { ok: false as const, errors: initial.errors, intervals: [] as PreciseLeaveInterval[] };

  const outside = input.intervals.filter(
    (interval) => interval.workDate < input.startDate || interval.workDate > input.endDate,
  );
  if (outside.length) {
    return {
      ok: false as const,
      errors: ["Leave timing must fall within the leave request start/end dates."],
      intervals: [] as PreciseLeaveInterval[],
    };
  }

  const normalized: PreciseLeaveInterval[] = [];
  const errors: string[] = [];
  for (const workDate of [...new Set(input.intervals.map((row) => row.workDate))].sort()) {
    const evidence = await loadResolvedEmployeeSchedule({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      workDate,
    });
    const dayIntervals = input.intervals
      .filter((row) => row.workDate === workDate)
      .map((row) => ({ ...row, timezone: row.timezone?.trim() || evidence.timezone }));
    const impact = resolveLeaveIntervalsForSchedule({
      workDate,
      intervals: dayIntervals,
      schedule: evidence.schedule,
    });
    errors.push(...impact.blockers.map((item) => `${workDate}: ${item.message}`));
    normalized.push(...dayIntervals);
  }
  return errors.length
    ? { ok: false as const, errors, intervals: [] as PreciseLeaveInterval[] }
    : { ok: true as const, errors: [] as string[], intervals: normalized };
}

async function preciseEvidenceForRequests(organizationId: number, leaveIds: number[]) {
  if (!leaveIds.length) return new Map<number, { intervalSet: typeof leaveRequestIntervalSets.$inferSelect; intervals: Array<typeof leaveRequestIntervals.$inferSelect> }>();
  const sets = await db.select().from(leaveRequestIntervalSets).where(and(
    eq(leaveRequestIntervalSets.organizationId, organizationId),
    eq(leaveRequestIntervalSets.status, "current"),
    inArray(leaveRequestIntervalSets.leaveRequestId, leaveIds),
  ));
  const setIds = sets.map((row) => row.id);
  const intervals = setIds.length
    ? await db.select().from(leaveRequestIntervals).where(and(
        eq(leaveRequestIntervals.organizationId, organizationId),
        inArray(leaveRequestIntervals.intervalSetId, setIds),
      ))
    : [];
  return new Map(sets.map((intervalSet) => [
    intervalSet.leaveRequestId,
    {
      intervalSet,
      intervals: intervals.filter((row) => row.intervalSetId === intervalSet.id),
    },
  ]));
}

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
  const evidence = await preciseEvidenceForRequests(organizationId, visible.map(({ leave }) => leave.id));

  return Response.json({
    requests: visible.map(({ leave, employee }) => {
      const precise = evidence.get(leave.id);
      return {
        ...leave,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        avatarInitials: employee.avatarInitials,
        intervalSet: precise?.intervalSet ?? null,
        intervals: precise?.intervals ?? [],
      };
    }),
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
  const action = String(body.action ?? "create");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const deniedMembership = await assertMembership(user.id, organizationId);
  if (deniedMembership) return deniedMembership;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (action === "revise_intervals") {
    const leaveId = Number(body.leaveId);
    const rawIntervals = Array.isArray(body.intervals) ? body.intervals as PreciseLeaveInterval[] : [];
    if (!Number.isInteger(leaveId) || rawIntervals.length === 0) {
      return Response.json({ error: "leaveId and precise intervals are required." }, { status: 400 });
    }
    const [leave] = await db.select().from(leaveRequests).where(and(
      eq(leaveRequests.id, leaveId),
      eq(leaveRequests.organizationId, organizationId),
    )).limit(1);
    if (!leave) return Response.json({ error: "Leave request not found." }, { status: 404 });

    if (user.role === "employee") {
      if (user.employeeId !== leave.employeeId) return Response.json({ error: "You can revise only your own leave request." }, { status: 403 });
    } else if (!roleAllowed(access.role, LEAVE_ADMIN_ROLES)) {
      return Response.json({ error: "Your role cannot revise leave timing." }, { status: 403 });
    }
    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, leave.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    if (access.role === "manager" && !access.companyWide && access.orgUnitId && employee.orgUnitId !== access.orgUnitId) {
      return Response.json({ error: "This employee is outside your assigned unit." }, { status: 403 });
    }
    if (leave.status !== "Pending") {
      return Response.json({
        error: "Approved/rejected leave timing is immutable. Withdraw and submit a new governed request instead.",
      }, { status: 409 });
    }
    const [pendingSeparation] = employee.status === "Separating"
      ? await db.select({ lastDay: separationRecords.lastDay }).from(separationRecords)
          .where(and(
            eq(separationRecords.organizationId, organizationId),
            eq(separationRecords.employeeId, employee.id),
            inArray(separationRecords.status, ["draft", "approved"]),
          )).orderBy(desc(separationRecords.id)).limit(1)
      : [];
    const eligibility = checkEmployeeLeaveEligibility({
      employeeStatus: employee.status,
      employmentStartDate: String(employee.startDate),
      leaveStartDate: String(leave.startDate),
      leaveEndDate: String(leave.endDate),
      separationLastDay: pendingSeparation?.lastDay ?? null,
    });
    if (eligibility) {
      return Response.json({ code: eligibility.code, error: eligibility.message }, { status: 409 });
    }

    const precise = await validatePreciseTiming({
      organizationId,
      employeeId: leave.employeeId,
      startDate: String(leave.startDate),
      endDate: String(leave.endDate),
      intervals: rawIntervals,
    });
    if (!precise.ok) return Response.json({ error: "Leave timing is invalid.", errors: precise.errors }, { status: 400 });

    const existingSets = await db.select().from(leaveRequestIntervalSets).where(and(
      eq(leaveRequestIntervalSets.organizationId, organizationId),
      eq(leaveRequestIntervalSets.leaveRequestId, leave.id),
    )).orderBy(desc(leaveRequestIntervalSets.revision));
    const nextRevision = Number(existingSets[0]?.revision ?? 0) + 1;

    const intervalSet = await db.transaction(async (tx) => {
      await tx.update(leaveRequestIntervalSets).set({
        status: "superseded",
        supersededAt: new Date(),
      }).where(and(
        eq(leaveRequestIntervalSets.organizationId, organizationId),
        eq(leaveRequestIntervalSets.leaveRequestId, leave.id),
        eq(leaveRequestIntervalSets.status, "current"),
      ));
      const [created] = await tx.insert(leaveRequestIntervalSets).values({
        organizationId,
        leaveRequestId: leave.id,
        revision: nextRevision,
        status: "current",
        createdByUserId: user.id,
        createdByName: user.name,
      }).returning();
      await tx.insert(leaveRequestIntervals).values(precise.intervals.map((interval) => ({
        organizationId,
        intervalSetId: created.id,
        workDate: interval.workDate,
        kind: interval.kind,
        startLocalTime: interval.kind === "timed" ? interval.startLocalTime ?? null : null,
        endLocalTime: interval.kind === "timed" ? interval.endLocalTime ?? null : null,
        endsNextDay: interval.kind === "timed" ? Boolean(interval.endsNextDay) : false,
        timezone: interval.timezone,
        source: "revision",
      })));
      return created;
    });

    const stale = await markTimesheetsStaleForEmployeeRange({
      organizationId,
      employeeId: leave.employeeId,
      startDate: String(leave.startDate),
      endDate: String(leave.endDate),
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Leave timing revised",
      resource: `leave #${leave.id}`,
      metadata: {
        leaveId: leave.id,
        nextRevision,
        intervalSetId: intervalSet.id,
        staleTimesheetIds: stale.map((row) => row.id),
      },
    });
    return Response.json({ leave, intervalSet, intervals: precise.intervals, staleTimesheetIds: stale.map((row) => row.id) });
  }

  let employeeId = Number(body.employeeId);
  const leaveType = String(body.leaveType ?? "").trim();
  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const days = Number(body.days);
  const reason = String(body.reason ?? "").trim();

  const dateWindow = leaveDateWindow(startDate, endDate);
  if (!leaveType || !dateWindow.ok || !Number.isFinite(days) || days <= 0
    || (dateWindow.ok && days > dateWindow.calendarDays)) {
    return Response.json({
      code: !dateWindow.ok ? dateWindow.code : "LEAVE_REQUEST_INVALID",
      error: !dateWindow.ok ? dateWindow.message
        : "A leave request needs a leave type and positive leave days no greater than its calendar date range.",
    }, { status: 400 });
  }

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

  if (
    access.role === "manager" &&
    !access.companyWide &&
    access.orgUnitId &&
    employee.orgUnitId !== access.orgUnitId
  ) {
    return Response.json({ error: "Managers can submit leave only for employees in their assigned unit." }, { status: 403 });
  }
  const [pendingSeparation] = employee.status === "Separating"
    ? await db.select({ lastDay: separationRecords.lastDay }).from(separationRecords)
        .where(and(
          eq(separationRecords.organizationId, organizationId),
          eq(separationRecords.employeeId, employee.id),
          inArray(separationRecords.status, ["draft", "approved"]),
        )).orderBy(desc(separationRecords.id)).limit(1)
    : [];
  const eligibility = checkEmployeeLeaveEligibility({
    employeeStatus: employee.status,
    employmentStartDate: String(employee.startDate),
    leaveStartDate: startDate,
    leaveEndDate: endDate,
    separationLastDay: pendingSeparation?.lastDay ?? null,
  });
  if (eligibility) {
    return Response.json({ code: eligibility.code, error: eligibility.message }, { status: 409 });
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

  const headerImpact = approvedLeaveCoverageImpact({
    id: 0,
    employeeId,
    startDate,
    endDate,
    days,
    leaveType,
  });
  let requestedIntervals = Array.isArray(body.intervals) ? body.intervals as PreciseLeaveInterval[] : [];
  if (headerImpact.kind === "ambiguous_partial" && requestedIntervals.length === 0) {
    return Response.json({
      error: "Precise timing is required for partial-day leave. Choose first half, second half, or custom hours.",
    }, { status: 400 });
  }
  if (headerImpact.kind === "full_day" && requestedIntervals.length === 0) {
    requestedIntervals = calendarDates(startDate, endDate).map((workDate) => ({
      workDate,
      kind: "full_day" as const,
      timezone: "Asia/Manila",
    }));
  }

  const precise = await validatePreciseTiming({
    organizationId,
    employeeId,
    startDate,
    endDate,
    intervals: requestedIntervals,
  });
  if (!precise.ok) return Response.json({ error: "Leave timing is invalid.", errors: precise.errors }, { status: 400 });

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

  const created = await db.transaction(async (tx) => {
    const [task] = await tx.insert(approvalTasks).values({
      organizationId,
      title: "Approve leave request",
      detail: `${employee.firstName} ${employee.lastName} · ${leaveType} · ${startDate}–${endDate}`,
      approver: approver.name,
      dueLabel: "Due in 2 days",
      priority: "Normal",
    }).returning();

    const [row] = await tx.insert(leaveRequests).values({
      organizationId,
      employeeId,
      leaveType,
      startDate,
      endDate,
      days: days.toFixed(1),
      reason: reason.slice(0, 240),
      status: "Pending",
      approvalTaskId: task.id,
    }).returning();

    const [intervalSet] = await tx.insert(leaveRequestIntervalSets).values({
      organizationId,
      leaveRequestId: row.id,
      revision: 1,
      status: "current",
      createdByUserId: user.id,
      createdByName: user.name,
    }).returning();
    await tx.insert(leaveRequestIntervals).values(precise.intervals.map((interval) => ({
      organizationId,
      intervalSetId: intervalSet.id,
      workDate: interval.workDate,
      kind: interval.kind,
      startLocalTime: interval.kind === "timed" ? interval.startLocalTime ?? null : null,
      endLocalTime: interval.kind === "timed" ? interval.endLocalTime ?? null : null,
      endsNextDay: interval.kind === "timed" ? Boolean(interval.endsNextDay) : false,
      timezone: interval.timezone,
      source: "request",
    })));
    await tx.insert(auditEvents).values({
      organizationId,
      actor: user.name,
      action: "Leave request submitted",
      resource: `${employee.firstName} ${employee.lastName} · ${leaveType}`.slice(0, 160),
      metadata: {
        leaveId: row.id,
        taskId: task.id,
        requesterUserId: user.id,
        approverUserId: approver.id,
        intervalSetId: intervalSet.id,
        intervalRevision: intervalSet.revision,
        workerStatusAtSubmission: employee.status,
        employmentStartDate: employee.startDate,
        separationLastDay: pendingSeparation?.lastDay ?? null,
      },
    });
    return { task, row, intervalSet };
  });

  const automation = await runAutomationEventSafely({
    organizationId,
    employeeId,
    trigger: "leave.requested",
    eventKey: `leave-requested:${created.row.id}`,
    context: {
      leaveId: created.row.id,
      leaveType,
      leaveDays: days,
      eventAmount: days,
      startDate,
      endDate,
      approvalTaskId: created.task.id,
      approver: approver.name,
      intervalRevision: created.intervalSet.revision,
    },
  });

  return Response.json({
    ...created.row,
    intervalSet: created.intervalSet,
    intervals: precise.intervals,
    automation,
  }, { status: 201 });
}
