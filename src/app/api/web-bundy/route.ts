import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, timePunches } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";
import { reconcileAttendanceExceptionEvents } from "@/lib/workforce-attendance-exception-events";
import { attendanceMutationLock, loadActiveAttendanceLocks } from "@/lib/workforce-attendance-lock";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import { evaluateGeofenceFix, geofencePilotEnabledForOrganization } from "@/lib/workforce-geofence";
import { authorizedGeofenceSites } from "@/lib/workforce-geofence-server";
import { eligiblePreviousWebBundyPunch, previousManilaWorkDate, resolveWebBundyPunchAnchor } from "@/lib/web-bundy-overnight-anchor";

export const dynamic = "force-dynamic";

async function syncAttendanceExceptionEvents(organizationId: number, employeeId: number, workDate: string) {
  try {
    const result = await reconcileAttendanceExceptionEvents({ organizationId, employeeId, workDate });
    return { status: "ok", createdIds: result.createdIds, resolvedIds: result.resolvedIds };
  } catch (error) {
    return {
      status: "sync_error",
      error: error instanceof Error ? error.message.slice(0, 1000) : "Attendance exception sync failed.",
    };
  }
}

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  let employeeId = Number(url.searchParams.get("employeeId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can view team attendance.",
    );
    if (denied) return denied;
  }

  const todayStr = manilaToday();
  const yesterdayStr = previousManilaWorkDate(todayStr);
  const filter = employeeId > 0
    ? and(
        eq(timePunches.organizationId, organizationId),
        eq(timePunches.employeeId, employeeId),
        or(eq(timePunches.workDate, todayStr), eq(timePunches.workDate, yesterdayStr)),
      )
    : and(eq(timePunches.organizationId, organizationId), eq(timePunches.workDate, todayStr));

  const todayPunches = await db.select({
    punch: timePunches,
    employee: employees,
  })
    .from(timePunches)
    .innerJoin(employees, eq(timePunches.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(timePunches.id));

  // An authorized worker may close a recent Web Bundy shift started yesterday.
  // Never use a stale, closed or different-source punch as an active shift.
  const currentRow = employeeId > 0 ? todayPunches.find(({ punch }) => punch.workDate === todayStr) : null;
  const priorRow = employeeId > 0 ? todayPunches.find(({ punch }) => punch.workDate === yesterdayStr) : null;
  const previousOpen = eligiblePreviousWebBundyPunch(priorRow?.punch ?? null, todayStr, new Date());
  const visibleRows = employeeId > 0
    ? currentRow ? [currentRow] : previousOpen && priorRow ? [priorRow] : []
    : todayPunches;

  return Response.json({
    date: todayStr,
    previousShiftNeedsReview: Boolean(priorRow?.punch.timeIn && !priorRow.punch.timeOut && !previousOpen),
    geofence: {
      required: geofencePilotEnabledForOrganization(organizationId),
      canClockWithLocation: user.role === "employee",
    },
    punches: visibleRows.map(({ punch, employee }) => ({
      ...punch,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      avatarInitials: employee.avatarInitials,
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  let employeeId = Number(body.employeeId);
  const actionType = String(body.actionType ?? "");
  let location = String(body.location ?? "Web Bundy Clock (Browser)").slice(0, 160);
  const ip = clientIp(request);

  const validActions = ["clock_in", "break_start", "break_end", "clock_out"];
  if (!Number.isInteger(organizationId) || !validActions.includes(actionType)) {
    return Response.json({
      error: "organizationId and actionType clock_in/break_start/break_end/clock_out are required.",
    }, { status: 400 });
  }

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can record attendance for another employee.",
    );
    if (denied) return denied;
  }

  if (!Number.isInteger(employeeId)) return Response.json({ error: "employeeId is required." }, { status: 400 });

  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });

  const todayStr = manilaToday();
  const now = new Date();
  const yesterdayStr = previousManilaWorkDate(todayStr);
  // Only a recent unclosed browser punch may remain on yesterday's workDate.
  // Never guess that a biometric, stale or future-dated record is this shift.
  const [todayPunch] = await db.select().from(timePunches).where(and(
    eq(timePunches.organizationId, organizationId),
    eq(timePunches.employeeId, employeeId),
    eq(timePunches.workDate, todayStr),
  )).limit(1);
  const [previousPunch] = await db.select().from(timePunches).where(and(
    eq(timePunches.organizationId, organizationId),
    eq(timePunches.employeeId, employeeId),
    eq(timePunches.workDate, yesterdayStr),
  )).limit(1);
  const anchor = resolveWebBundyPunchAnchor({
    today: todayStr, now,
    todayPunch: todayPunch ?? null,
    previousPunch: previousPunch ?? null,
    action: actionType as "clock_in" | "break_start" | "break_end" | "clock_out",
  });
  if (anchor.previousOpenRequiresClose) {
    return Response.json({
      code: "PREVIOUS_SHIFT_STILL_OPEN",
      error: "An overnight shift remains open. Clock out or request an approved attendance correction before starting a new shift.",
    }, { status: 409 });
  }
  const effectiveWorkDate = anchor.workDate;
  const existingPunch = anchor.usePrevious ? previousPunch : todayPunch;
  const geofenceRequired = geofencePilotEnabledForOrganization(organizationId);
  // A team administrator cannot silently bypass an enforced employee self-clock.
  // Approved manual exceptions use the separate HR correction workflow.
  if (geofenceRequired && user.role !== "employee") {
    return Response.json({
      code: "GEOFENCE_SELF_CLOCK_ONLY",
      error: "Geofenced attendance requires the employee to clock themself. Ask HR for a reviewed manual attendance exception.",
    }, { status: 403 });
  }
  if (geofenceRequired) {
    // Avoid a GPS-boundary probing oracle and repeated rejected clock requests.
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id,
      action: "geofenced-web-bundy",
      resourceId: organizationId,
      limit: 24,
      windowMs: 5 * 60_000,
    });
    if (rateDenied) return rateDenied;
  }
  // An overnight completion must honor both the shift-start cutoff and the
  // current-day capture lock. A locked previous period must never be mutated.
  const locks = await loadActiveAttendanceLocks(organizationId);
  const attendanceLock = attendanceMutationLock(locks, effectiveWorkDate, "capture")
    ?? (effectiveWorkDate !== todayStr ? attendanceMutationLock(locks, todayStr, "capture") : null);
  if (attendanceLock) {
    return Response.json({
      error: attendanceLock.lockType === "payroll_cutoff"
        ? "Attendance is frozen for a payroll cutoff covering this punch."
        : "Attendance capture is locked for a period covering this punch.",
      code: "ATTENDANCE_PERIOD_LOCKED",
      attendanceLockId: attendanceLock.id,
      lockType: attendanceLock.lockType,
    }, { status: 423 });
  }

  let geofenceAudit: {
    policyVersion: string;
    worksiteId: number;
    distanceBand: string;
    accuracyBand: string;
  } | null = null;
  if (geofenceRequired && (actionType === "clock_in" || actionType === "clock_out")) {
    const sites = await authorizedGeofenceSites(organizationId, employeeId, effectiveWorkDate);
    const decision = evaluateGeofenceFix({ fix: body.geolocation, sites, now: now.getTime() });
    if (!decision.ok) {
      // Rejected checks must be reviewable without preserving the submitted
      // GPS fix, which can reveal a home or sensitive travel location.
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Web Bundy GPS verification rejected",
        resource: employee.employeeNo,
        metadata: { employeeId, workDate: effectiveWorkDate, code: decision.code },
      });
      return Response.json({ error: decision.error, code: decision.code }, { status: 422 });
    }
    geofenceAudit = {
      policyVersion: decision.policyVersion,
      worksiteId: decision.worksiteId,
      distanceBand: decision.distanceBand,
      accuracyBand: decision.accuracyBand,
    };
    // The raw fix is deliberately not persisted to punches, audits, logs or exports.
    location = `Verified worksite #${decision.worksiteId}`;
  }

  if (actionType === "break_start") {
    if (!existingPunch?.timeIn || existingPunch.timeOut) {
      return Response.json({ error: "Clock in before starting a break, and breaks cannot be added after clock-out." }, { status: 409 });
    }
    if (existingPunch.breakStart) {
      return Response.json({ error: "A break has already been started for this attendance record." }, { status: 409 });
    }
    const [updated] = await db.update(timePunches).set({
      breakStart: now,
      notes: (existingPunch.notes ? existingPunch.notes + " · " : "") + "Break started via Web Bundy",
    }).where(eq(timePunches.id, existingPunch.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Break START",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: effectiveWorkDate, breakStart: now.toISOString(), ip },
    });
    await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId,
      workDate: effectiveWorkDate,
    });
    if (effectiveWorkDate !== todayStr) {
      await markTimesheetsStaleForEmployeeDate({ organizationId, employeeId, workDate: todayStr });
    }
    const attendanceExceptionSync = await syncAttendanceExceptionEvents(organizationId, employeeId, effectiveWorkDate);
    return Response.json({ ok: true, action: "break_start", punch: updated, attendanceExceptionSync });
  }

  if (actionType === "break_end") {
    if (!existingPunch?.timeIn || !existingPunch.breakStart || existingPunch.timeOut) {
      return Response.json({ error: "Start a break before ending it, and end the break before clock-out." }, { status: 409 });
    }
    if (existingPunch.breakEnd) {
      return Response.json({ error: "This break has already ended." }, { status: 409 });
    }
    const [updated] = await db.update(timePunches).set({
      breakEnd: now,
      notes: (existingPunch.notes ? existingPunch.notes + " · " : "") + "Break ended via Web Bundy",
    }).where(eq(timePunches.id, existingPunch.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Break END",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: effectiveWorkDate, breakEnd: now.toISOString(), ip },
    });
    await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId,
      workDate: effectiveWorkDate,
    });
    if (effectiveWorkDate !== todayStr) {
      await markTimesheetsStaleForEmployeeDate({ organizationId, employeeId, workDate: todayStr });
    }
    const attendanceExceptionSync = await syncAttendanceExceptionEvents(organizationId, employeeId, effectiveWorkDate);
    return Response.json({ ok: true, action: "break_end", punch: updated, attendanceExceptionSync });
  }

  if (actionType === "clock_in") {
    if (existingPunch?.timeIn) {
      return Response.json({
        error: `Already clocked in today at ${new Date(existingPunch.timeIn).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}.`,
        punch: existingPunch,
      }, { status: 409 });
    }
    if (existingPunch?.timeOut) {
      // A previous clock-out-only record requires an authorized correction,
      // never a later clock-in that would invert the payable time sequence.
      return Response.json({
        error: "A clock-out has already been recorded without clock-in. Request an attendance correction.",
        code: "ATTENDANCE_CORRECTION_REQUIRED",
      }, { status: 409 });
    }

    const [punch] = existingPunch
      ? await db.update(timePunches).set({
          timeIn: now,
          source: "web_bundy",
          ipAddress: ip,
          location,
          status: existingPunch.timeOut ? "Complete" : "Incomplete",
        }).where(eq(timePunches.id, existingPunch.id)).returning()
      : await db.insert(timePunches).values({
          organizationId,
          employeeId,
          workDate: effectiveWorkDate,
          timeIn: now,
          timeOut: null,
          shiftStart: "09:00",
          shiftEnd: "18:00",
          source: "web_bundy",
          ipAddress: ip,
          location,
          status: "Incomplete",
          notes: "Clocked in via Web Bundy",
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Clock IN",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: effectiveWorkDate, timeIn: now.toISOString(), ip, ...(geofenceAudit ? { geofence: geofenceAudit } : {}) },
    });

    await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId,
      workDate: effectiveWorkDate,
    });
    if (effectiveWorkDate !== todayStr) {
      await markTimesheetsStaleForEmployeeDate({ organizationId, employeeId, workDate: todayStr });
    }
    const attendanceExceptionSync = await syncAttendanceExceptionEvents(organizationId, employeeId, effectiveWorkDate);
    return Response.json({ ok: true, action: "clock_in", punch, attendanceExceptionSync }, { status: existingPunch ? 200 : 201 });
  }

  if (existingPunch?.timeOut) {
    // This covers both completed and clock-out-only attendance records.
    // Do not INSERT another row for a date that already has an orphan out.
    return Response.json({
      error: `Already clocked out today at ${new Date(existingPunch.timeOut).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}.`,
      code: "ATTENDANCE_ALREADY_CLOCKED_OUT",
    }, { status: 409 });
  }

  if (existingPunch && !existingPunch.timeIn) {
    // A partial source record is not authorization for a duplicate insert.
    return Response.json({
      error: "An incomplete attendance record already exists. Request an attendance correction.",
      code: "ATTENDANCE_CORRECTION_REQUIRED",
    }, { status: 409 });
  }

  if (!existingPunch) {
    const [created] = await db.insert(timePunches).values({
      organizationId,
      employeeId,
      workDate: effectiveWorkDate,
      timeIn: null,
      timeOut: now,
      shiftStart: "09:00",
      shiftEnd: "18:00",
      source: "web_bundy",
      ipAddress: ip,
      location,
      status: "Incomplete",
      notes: "Clocked out without Clock IN punch",
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Web Bundy Clock OUT without IN",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { employeeId, workDate: effectiveWorkDate, timeOut: now.toISOString(), ip, ...(geofenceAudit ? { geofence: geofenceAudit } : {}) },
    });

    await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId,
      workDate: effectiveWorkDate,
    });
    if (effectiveWorkDate !== todayStr) {
      await markTimesheetsStaleForEmployeeDate({ organizationId, employeeId, workDate: todayStr });
    }
    const attendanceExceptionSync = await syncAttendanceExceptionEvents(organizationId, employeeId, effectiveWorkDate);
    return Response.json({
      ok: true,
      action: "clock_out",
      punch: created,
      warning: "Clock out recorded without prior clock-in.",
      attendanceExceptionSync,
    }, { status: 201 });
  }

  if (existingPunch.breakStart && !existingPunch.breakEnd) {
    return Response.json({
      error: "End the active break before clocking out so paid hours and night differential can be calculated correctly.",
    }, { status: 409 });
  }

  const [updated] = await db.update(timePunches).set({
    timeOut: now,
    status: "Complete",
    notes: (existingPunch.notes ? existingPunch.notes + " · " : "") + "Clocked out via Web Bundy",
  }).where(and(
    eq(timePunches.id, existingPunch.id),
    isNull(timePunches.timeOut),
  )).returning();
  if (!updated) {
    return Response.json({
      code: "ATTENDANCE_ALREADY_CLOCKED_OUT",
      error: "Attendance has changed. Refresh the current punch before retrying.",
    }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Web Bundy Clock OUT",
    resource: `${employee.firstName} ${employee.lastName}`,
    metadata: { employeeId, workDate: effectiveWorkDate, timeOut: now.toISOString(), ip, ...(geofenceAudit ? { geofence: geofenceAudit } : {}) },
  });

  // Final clock-out changes payable hours. Submitted/approved timesheets must
  // be reviewed again before payroll handoff, just as with all other punches.
  await markTimesheetsStaleForEmployeeDate({
    organizationId,
    employeeId,
    workDate: effectiveWorkDate,
  });
  if (effectiveWorkDate !== todayStr) {
    await markTimesheetsStaleForEmployeeDate({ organizationId, employeeId, workDate: todayStr });
  }
  const attendanceExceptionSync = await syncAttendanceExceptionEvents(organizationId, employeeId, effectiveWorkDate);
  return Response.json({ ok: true, action: "clock_out", punch: updated, attendanceExceptionSync });
}
