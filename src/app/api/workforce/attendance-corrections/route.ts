import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests,
  employees,
  payrollEntries,
  payrollJobs,
  payrollRuns,
  timePunches,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  attendancePunchSnapshot,
  attendancePunchSnapshotsMatch,
  normalizeAttendanceCorrection,
  punchStatusAfterCorrection,
  type AttendancePunchSnapshot,
} from "@/lib/workforce-attendance-correction";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const REQUEST_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const DECIDER_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function storedSnapshot(value: unknown): AttendancePunchSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<AttendancePunchSnapshot>;
  if (
    typeof row.workDate !== "string"
    || !("timeIn" in row)
    || !("timeOut" in row)
    || !("breakStart" in row)
    || !("breakEnd" in row)
    || typeof row.status !== "string"
  ) return null;
  return row as AttendancePunchSnapshot;
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return { employee: null, denied: Response.json({ error: "Employee not found." }, { status: 404 }) };
  }
  const access = await getAccess(userId, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) {
    return {
      employee: null,
      denied: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }
  return { employee, denied: null };
}

function payrollIsImmutable(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === "released"
    || normalized === "paid"
    || normalized === "paid out"
    || normalized === "settled";
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const status = String(url.searchParams.get("status") ?? "").trim();
  const startDate = String(url.searchParams.get("startDate") ?? "").trim();
  const endDate = String(url.searchParams.get("endDate") ?? "").trim();

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  if ((startDate && !ISO_DATE.test(startDate)) || (endDate && !ISO_DATE.test(endDate))) {
    return Response.json({ error: "startDate and endDate must use YYYY-MM-DD." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    REQUEST_ROLES,
    "You do not have permission to review attendance corrections.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const employeeRows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));
  const visibleEmployeeIds = new Set(
    (access.companyWide
      ? employeeRows
      : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId))
      .map((employee) => employee.id),
  );

  const requests = await db.select().from(attendanceCorrectionRequests)
    .where(eq(attendanceCorrectionRequests.organizationId, organizationId))
    .orderBy(asc(attendanceCorrectionRequests.createdAt), asc(attendanceCorrectionRequests.id));

  return Response.json({
    requests: requests.filter((row) =>
      visibleEmployeeIds.has(row.employeeId)
      && (!status || row.status === status)
      && (!startDate || String(row.workDate) >= startDate)
      && (!endDate || String(row.workDate) <= endDate)
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
  const action = String(body.action ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    action === "decide_request" ? DECIDER_ROLES : REQUEST_ROLES,
    action === "decide_request"
      ? "Only authorized workforce managers can decide attendance corrections."
      : "You do not have permission to manage attendance corrections.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-attendance-correction-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_request") {
    const punchId = Number(body.punchId);
    const reason = String(body.reason ?? "").trim().slice(0, 240);
    if (!Number.isInteger(punchId) || !reason) {
      return Response.json({ error: "punchId and reason are required." }, { status: 400 });
    }

    const [punch] = await db.select().from(timePunches).where(and(
      eq(timePunches.id, punchId),
      eq(timePunches.organizationId, organizationId),
    )).limit(1);
    if (!punch) return Response.json({ error: "Attendance punch not found." }, { status: 404 });

    const employeeCheck = await scopedEmployee(user.id, organizationId, punch.employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    const [pending] = await db.select({ id: attendanceCorrectionRequests.id })
      .from(attendanceCorrectionRequests)
      .where(and(
        eq(attendanceCorrectionRequests.organizationId, organizationId),
        eq(attendanceCorrectionRequests.punchId, punchId),
        eq(attendanceCorrectionRequests.status, "pending"),
      ))
      .limit(1);
    if (pending) {
      return Response.json({
        error: "This attendance punch already has a pending correction request.",
      }, { status: 409 });
    }

    const original = attendancePunchSnapshot(punch);
    let proposed: AttendancePunchSnapshot;
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
      organizationId,
      employeeId: punch.employeeId,
      punchId,
      workDate: punch.workDate,
      originalPunchSnapshot: original,
      proposedPunchSnapshot: proposed,
      reason,
      status: "pending",
      requestedBy: user.name,
      requestedByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Attendance correction requested",
      resource: `${employeeCheck.employee!.employeeNo} · ${punch.workDate}`,
      metadata: {
        attendanceCorrectionRequestId: created.id,
        punchId,
        employeeId: punch.employeeId,
        originalPunchSnapshot: original,
        proposedPunchSnapshot: proposed,
      },
    });

    return Response.json({ correction: created }, { status: 201 });
  }

  if (action === "decide_request") {
    const requestId = Number(body.requestId);
    const decision = String(body.decision ?? "").trim();
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;
    if (!Number.isInteger(requestId) || !["approved", "rejected"].includes(decision)) {
      return Response.json({
        error: "requestId and decision (approved or rejected) are required.",
      }, { status: 400 });
    }

    const [existing] = await db.select().from(attendanceCorrectionRequests).where(and(
      eq(attendanceCorrectionRequests.id, requestId),
      eq(attendanceCorrectionRequests.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Attendance correction not found." }, { status: 404 });
    if (existing.status !== "pending") {
      return Response.json({ error: "Only pending attendance corrections can be decided." }, { status: 409 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, existing.employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    if (existing.requestedByUserId == null) {
      return Response.json({
        error: "This request lacks stable requester identity and cannot be safely approved. Reject and recreate it.",
      }, { status: 409 });
    }
    if (existing.requestedByUserId === user.id) {
      return Response.json({
        error: "Attendance corrections cannot be self-approved. A different workforce manager must decide this request.",
      }, { status: 409 });
    }

    if (decision === "rejected") {
      const [updated] = await db.update(attendanceCorrectionRequests).set({
        status: "rejected",
        decidedBy: user.name,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote,
        updatedAt: new Date(),
      }).where(and(
        eq(attendanceCorrectionRequests.id, requestId),
        eq(attendanceCorrectionRequests.status, "pending"),
      )).returning();

      if (!updated) {
        return Response.json({ error: "Attendance correction was already decided." }, { status: 409 });
      }

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Attendance correction rejected",
        resource: `${employeeCheck.employee!.employeeNo} · ${existing.workDate}`,
        metadata: { attendanceCorrectionRequestId: requestId, decisionNote },
      });
      return Response.json({ correction: updated });
    }

    const original = storedSnapshot(existing.originalPunchSnapshot);
    const proposed = storedSnapshot(existing.proposedPunchSnapshot);
    if (!original || !proposed) {
      return Response.json({
        error: "Stored attendance correction snapshot is invalid; approval is blocked.",
      }, { status: 409 });
    }

    const [currentPunch] = await db.select().from(timePunches).where(and(
      eq(timePunches.id, existing.punchId),
      eq(timePunches.organizationId, organizationId),
      eq(timePunches.employeeId, existing.employeeId),
    )).limit(1);
    if (!currentPunch) return Response.json({ error: "Attendance punch no longer exists." }, { status: 409 });

    const current = attendancePunchSnapshot(currentPunch);
    if (!attendancePunchSnapshotsMatch(original, current)) {
      return Response.json({
        error: "Attendance changed after this correction was requested. Reject and recreate the request from the current punch.",
      }, { status: 409 });
    }

    const scopeClause = employeeCheck.employee!.orgUnitId == null
      ? isNull(payrollRuns.scopeOrgUnitId)
      : or(
          isNull(payrollRuns.scopeOrgUnitId),
          eq(payrollRuns.scopeOrgUnitId, employeeCheck.employee!.orgUnitId),
        );
    const affectedRuns = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      lte(payrollRuns.periodStart, existing.workDate),
      gte(payrollRuns.periodEnd, existing.workDate),
      scopeClause,
    ));
    const immutableRun = affectedRuns.find((run) => payrollIsImmutable(run.status));
    if (immutableRun) {
      return Response.json({
        error: `Attendance for ${existing.workDate} is already included in immutable payroll run "${immutableRun.periodLabel}". Use a post-payroll adjustment instead of rewriting historical attendance.`,
      }, { status: 409 });
    }

    const invalidatedRunIds = affectedRuns.map((run) => run.id);

    try {
      const result = await db.transaction(async (tx) => {
        const [updatedPunch] = await tx.update(timePunches).set({
          timeIn: proposed.timeIn ? new Date(proposed.timeIn) : null,
          timeOut: proposed.timeOut ? new Date(proposed.timeOut) : null,
          breakStart: proposed.breakStart ? new Date(proposed.breakStart) : null,
          breakEnd: proposed.breakEnd ? new Date(proposed.breakEnd) : null,
          status: punchStatusAfterCorrection(proposed),
        }).where(and(
          eq(timePunches.id, existing.punchId),
          eq(timePunches.organizationId, organizationId),
          eq(timePunches.employeeId, existing.employeeId),
          eq(timePunches.workDate, original.workDate),
          original.timeIn ? eq(timePunches.timeIn, new Date(original.timeIn)) : isNull(timePunches.timeIn),
          original.timeOut ? eq(timePunches.timeOut, new Date(original.timeOut)) : isNull(timePunches.timeOut),
          original.breakStart ? eq(timePunches.breakStart, new Date(original.breakStart)) : isNull(timePunches.breakStart),
          original.breakEnd ? eq(timePunches.breakEnd, new Date(original.breakEnd)) : isNull(timePunches.breakEnd),
          eq(timePunches.status, original.status),
        )).returning();

        if (!updatedPunch) {
          throw new Error("Attendance changed while the correction was being approved. No correction was applied.");
        }

        if (invalidatedRunIds.length > 0) {
          await tx.delete(payrollJobs).where(inArray(payrollJobs.payrollRunId, invalidatedRunIds));
          await tx.delete(payrollEntries).where(inArray(payrollEntries.payrollRunId, invalidatedRunIds));
          await tx.update(payrollRuns).set({
            status: "Draft",
            grossPay: "0",
            netPay: "0",
            exceptions: 0,
            processedChunks: 0,
            totalChunks: 0,
          }).where(inArray(payrollRuns.id, invalidatedRunIds));
        }

        const [updatedRequest] = await tx.update(attendanceCorrectionRequests).set({
          status: "approved",
          decidedBy: user.name,
          decidedByUserId: user.id,
          decidedAt: new Date(),
          decisionNote,
          appliedAt: new Date(),
          invalidatedPayrollRunIds: invalidatedRunIds,
          updatedAt: new Date(),
        }).where(and(
          eq(attendanceCorrectionRequests.id, requestId),
          eq(attendanceCorrectionRequests.status, "pending"),
        )).returning();

        if (!updatedRequest) {
          throw new Error("Attendance correction was already decided by another transaction.");
        }

        return { updatedPunch, updatedRequest };
      });

      const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
        organizationId,
        employeeId: existing.employeeId,
        workDate: String(existing.workDate),
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Attendance correction approved and applied",
        resource: `${employeeCheck.employee!.employeeNo} · ${existing.workDate}`,
        metadata: {
          attendanceCorrectionRequestId: requestId,
          punchId: existing.punchId,
          employeeId: existing.employeeId,
          originalPunchSnapshot: original,
          proposedPunchSnapshot: proposed,
          invalidatedPayrollRunIds: invalidatedRunIds,
          staleTimesheetIds: staleTimesheets.map((row) => row.id),
          decisionNote,
        },
      });

      return Response.json({
        correction: result.updatedRequest,
        punch: result.updatedPunch,
        invalidatedPayrollRunIds: invalidatedRunIds,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Attendance correction could not be applied.",
      }, { status: 409 });
    }
  }

  return Response.json({
    error: "Unsupported action. Use create_request or decide_request.",
  }, { status: 400 });
}
