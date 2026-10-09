import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, separationRecords } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertScope, getAccess } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import {
  resolveLeaveIntervalsForSchedule,
  validateLeaveIntervals,
  type PreciseLeaveInterval,
} from "@/lib/workforce-absence-intervals";
import { loadResolvedEmployeeSchedule } from "@/lib/workforce-schedule-evidence-server";
import {
  checkEmployeeLeaveEligibility,
  leaveDateWindow,
  MAX_PRECISE_LEAVE_INTERVALS,
  validLeaveDate,
} from "@/lib/hcm-leave-employment";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  let employeeId = Number(body.employeeId);
  const intervals = Array.isArray(body.intervals) ? body.intervals as PreciseLeaveInterval[] : [];

  if (!Number.isInteger(organizationId) || intervals.length === 0) {
    return Response.json({ error: "organizationId and at least one leave interval are required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    employeeId = user.employeeId;
  }
  if (!Number.isInteger(employeeId)) {
    return Response.json({ error: "employeeId is required." }, { status: 400 });
  }

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.id, employeeId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });

  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  // The preview must obey the same bounded Gregorian/employment checks as
  // submission. Never fan out thousands of schedule lookups on bad input.
  if (intervals.length > MAX_PRECISE_LEAVE_INTERVALS
    || intervals.some(interval => !interval
      || typeof interval.workDate !== "string" || !validLeaveDate(interval.workDate))) {
    return Response.json({
      code: "LEAVE_PREVIEW_INVALID_INTERVALS",
      error: "Leave preview requires genuine work dates and no more than 1,500 intervals.",
    }, { status: 400 });
  }
  const dates = [...new Set(intervals.map((interval) => interval.workDate))].sort();
  const window = leaveDateWindow(dates[0], dates[dates.length - 1]);
  if (!window.ok) {
    return Response.json({ code: window.code, error: window.message }, { status: 400 });
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
    leaveStartDate: dates[0],
    leaveEndDate: dates[dates.length - 1],
    separationLastDay: pendingSeparation?.lastDay ?? null,
  });
  if (eligibility) {
    return Response.json({ code: eligibility.code, error: eligibility.message }, { status: 409 });
  }
  const validation = validateLeaveIntervals(intervals);
  if (!validation.ok) {
    return Response.json({ error: "Leave timing is invalid.", errors: validation.errors }, { status: 400 });
  }
  const previews = [];
  for (const workDate of dates) {
    const evidence = await loadResolvedEmployeeSchedule({ organizationId, employeeId, workDate });
    const dayIntervals = intervals
      .filter((interval) => interval.workDate === workDate)
      .map((interval) => ({
        ...interval,
        timezone: interval.timezone?.trim() || evidence.timezone,
      }));
    const impact = resolveLeaveIntervalsForSchedule({
      workDate,
      intervals: dayIntervals,
      schedule: evidence.schedule,
    });
    previews.push({
      workDate,
      timezone: evidence.timezone,
      schedule: evidence.schedule,
      ...impact,
    });
  }

  return Response.json({
    employee: {
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
    },
    previews,
    blocking: previews.some((preview) => preview.blockers.length > 0),
  });
}
