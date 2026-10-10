import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  scheduleSwapRequests,
  shiftDefinitions,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  resolveDailySchedule,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import {
  assertScheduleSwappable,
  scheduleSwapOverrideValues,
  scheduleSwapSnapshot,
  scheduleSwapSnapshotsMatch,
  type ScheduleSwapSnapshot,
} from "@/lib/workforce-swap";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

async function resolveSchedulesForPair(input: {
  organizationId: number;
  requesterEmployeeId: number;
  counterpartyEmployeeId: number;
  requesterWorkDate: string;
  counterpartyWorkDate: string;
}, executor: Pick<typeof db, "select"> = db) {
  const employeeIds = [input.requesterEmployeeId, input.counterpartyEmployeeId];
  const dates = [...new Set([input.requesterWorkDate, input.counterpartyWorkDate])];

  const [shifts, patterns, assignments, overrides, worksiteAssignments] = await Promise.all([
    executor.select().from(shiftDefinitions)
      .where(eq(shiftDefinitions.organizationId, input.organizationId))
      .orderBy(asc(shiftDefinitions.code)),
    executor.select().from(schedulePatterns)
      .where(eq(schedulePatterns.organizationId, input.organizationId))
      .orderBy(asc(schedulePatterns.code)),
    executor.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, input.organizationId),
      inArray(employeeScheduleAssignments.employeeId, employeeIds),
    )).orderBy(
      asc(employeeScheduleAssignments.employeeId),
      asc(employeeScheduleAssignments.effectiveFrom),
      asc(employeeScheduleAssignments.id),
    ),
    executor.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, input.organizationId),
      inArray(scheduleOverrides.employeeId, employeeIds),
      inArray(scheduleOverrides.workDate, dates),
    )).orderBy(
      asc(scheduleOverrides.employeeId),
      asc(scheduleOverrides.workDate),
      asc(scheduleOverrides.id),
    ),
    executor.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, input.organizationId),
      inArray(employeeWorksiteAssignments.employeeId, employeeIds),
    )).orderBy(
      asc(employeeWorksiteAssignments.employeeId),
      asc(employeeWorksiteAssignments.effectiveFrom),
      asc(employeeWorksiteAssignments.id),
    ),
  ]);

  const patternIds = patterns.map((pattern) => pattern.id);
  const days = patternIds.length
    ? await executor.select({
        id: schedulePatternDays.id,
        patternId: schedulePatternDays.patternId,
        dayIndex: schedulePatternDays.dayIndex,
        isRestDay: schedulePatternDays.isRestDay,
        label: schedulePatternDays.label,
      }).from(schedulePatternDays)
        .where(inArray(schedulePatternDays.patternId, patternIds))
        .orderBy(asc(schedulePatternDays.patternId), asc(schedulePatternDays.dayIndex))
    : [];
  const dayIds = days.map((day) => day.id);
  const segments = dayIds.length
    ? await executor.select({
        id: schedulePatternSegments.id,
        patternDayId: schedulePatternSegments.patternDayId,
        shiftDefinitionId: schedulePatternSegments.shiftDefinitionId,
        segmentOrder: schedulePatternSegments.segmentOrder,
      }).from(schedulePatternSegments)
        .where(inArray(schedulePatternSegments.patternDayId, dayIds))
        .orderBy(asc(schedulePatternSegments.patternDayId), asc(schedulePatternSegments.segmentOrder))
    : [];

  function resolve(employeeId: number, date: string) {
    return resolveDailySchedule({
      date,
      assignments: assignments
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({
          id: row.id,
          patternId: row.patternId,
          effectiveFrom: String(row.effectiveFrom),
          effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
          anchorDate: String(row.anchorDate),
          workLocationOrgUnitId: row.workLocationOrgUnitId,
          worksiteId: row.worksiteId,
        })),
      patterns: patterns.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        cycleDays: row.cycleDays,
      })),
      patternDays: days.map((row) => ({
        id: row.id,
        patternId: row.patternId,
        dayIndex: row.dayIndex,
        isRestDay: row.isRestDay,
        label: row.label,
      })),
      patternSegments: segments.map((row) => ({
        patternDayId: row.patternDayId,
        shiftDefinitionId: row.shiftDefinitionId,
        segmentOrder: row.segmentOrder,
      })),
      shifts: shifts.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        startTime: row.startTime,
        endTime: row.endTime,
        breakMinutes: row.breakMinutes,
        spansMidnight: row.spansMidnight,
      })),
      overrides: overrides
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({
          id: row.id,
          workDate: String(row.workDate),
          kind: row.kind as "shift" | "split_shift" | "rest_day" | "off" | "location",
          isRestDay: row.isRestDay,
          segments: Array.isArray(row.segments)
            ? row.segments as WorkforceScheduleOverrideSegment[]
            : [],
          workLocationOrgUnitId: row.workLocationOrgUnitId,
          worksiteId: row.worksiteId,
          status: row.status as "pending" | "approved" | "rejected" | "cancelled",
          reason: row.reason,
        })),
      defaultWorksiteId:
        selectEffectiveWorksiteAssignment(
          worksiteAssignments
            .filter((row) => row.employeeId === employeeId)
            .map((row) => ({
              id: row.id,
              worksiteId: row.worksiteId,
              effectiveFrom: String(row.effectiveFrom),
              effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
            })),
          date,
        )?.worksiteId ?? null,
    });
  }

  return {
    requester: resolve(input.requesterEmployeeId, input.requesterWorkDate),
    counterparty: resolve(input.counterpartyEmployeeId, input.counterpartyWorkDate),
  };
}

function storedSnapshot(value: unknown): ScheduleSwapSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<ScheduleSwapSnapshot>;
  if (
    typeof row.date !== "string"
    || typeof row.source !== "string"
    || typeof row.isRestDay !== "boolean"
    || !Array.isArray(row.segments)
  ) return null;
  return row as ScheduleSwapSnapshot;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can review schedule swaps.",
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

  const swaps = await db.select().from(scheduleSwapRequests)
    .where(eq(scheduleSwapRequests.organizationId, organizationId))
    .orderBy(asc(scheduleSwapRequests.createdAt), asc(scheduleSwapRequests.id));

  return Response.json({
    swaps: swaps.filter((swap) =>
      visibleEmployeeIds.has(swap.requesterEmployeeId)
      && visibleEmployeeIds.has(swap.counterpartyEmployeeId),
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
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can manage schedule swaps.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-schedule-swap-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_request") {
    const requesterEmployeeId = Number(body.requesterEmployeeId);
    const counterpartyEmployeeId = Number(body.counterpartyEmployeeId);
    const requesterWorkDate = String(body.requesterWorkDate ?? "").trim();
    const counterpartyWorkDate = String(body.counterpartyWorkDate ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 240);

    if (
      !Number.isInteger(requesterEmployeeId)
      || !Number.isInteger(counterpartyEmployeeId)
      || requesterEmployeeId === counterpartyEmployeeId
      || !ISO_DATE.test(requesterWorkDate)
      || !ISO_DATE.test(counterpartyWorkDate)
      || !reason
    ) {
      return Response.json({
        error: "Two different employees, both work dates, and a reason are required.",
      }, { status: 400 });
    }

    const [requesterCheck, counterpartyCheck] = await Promise.all([
      scopedEmployee(user.id, organizationId, requesterEmployeeId),
      scopedEmployee(user.id, organizationId, counterpartyEmployeeId),
    ]);
    if (requesterCheck.denied) return requesterCheck.denied;
    if (counterpartyCheck.denied) return counterpartyCheck.denied;

    const pendingConflict = await db.select({ id: scheduleSwapRequests.id })
      .from(scheduleSwapRequests)
      .where(and(
        eq(scheduleSwapRequests.organizationId, organizationId),
        eq(scheduleSwapRequests.status, "pending"),
        or(
          and(
            eq(scheduleSwapRequests.requesterEmployeeId, requesterEmployeeId),
            eq(scheduleSwapRequests.requesterWorkDate, requesterWorkDate),
          ),
          and(
            eq(scheduleSwapRequests.counterpartyEmployeeId, requesterEmployeeId),
            eq(scheduleSwapRequests.counterpartyWorkDate, requesterWorkDate),
          ),
          and(
            eq(scheduleSwapRequests.requesterEmployeeId, counterpartyEmployeeId),
            eq(scheduleSwapRequests.requesterWorkDate, counterpartyWorkDate),
          ),
          and(
            eq(scheduleSwapRequests.counterpartyEmployeeId, counterpartyEmployeeId),
            eq(scheduleSwapRequests.counterpartyWorkDate, counterpartyWorkDate),
          ),
        ),
      ))
      .limit(1);
    if (pendingConflict[0]) {
      return Response.json({
        error: "A pending schedule swap already uses one of these employee/date assignments.",
      }, { status: 409 });
    }

    const current = await resolveSchedulesForPair({
      organizationId,
      requesterEmployeeId,
      counterpartyEmployeeId,
      requesterWorkDate,
      counterpartyWorkDate,
    });
    const requesterSnapshot = scheduleSwapSnapshot(current.requester);
    const counterpartySnapshot = scheduleSwapSnapshot(current.counterparty);
    try {
      assertScheduleSwappable(requesterSnapshot);
      assertScheduleSwappable(counterpartySnapshot);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "The schedules cannot be swapped safely.",
      }, { status: 422 });
    }

    const [created] = await db.insert(scheduleSwapRequests).values({
      organizationId,
      requesterEmployeeId,
      counterpartyEmployeeId,
      requesterWorkDate,
      counterpartyWorkDate,
      requesterScheduleSnapshot: requesterSnapshot,
      counterpartyScheduleSnapshot: counterpartySnapshot,
      reason,
      status: "pending",
      requestedBy: user.name,
      requestedByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Workforce schedule swap requested",
      resource: `Swap #${created.id}`,
      metadata: {
        scheduleSwapRequestId: created.id,
        requesterEmployeeId,
        counterpartyEmployeeId,
        requesterWorkDate,
        counterpartyWorkDate,
        requesterScheduleSnapshot: requesterSnapshot,
        counterpartyScheduleSnapshot: counterpartySnapshot,
      },
    });

    return Response.json({ swap: created }, { status: 201 });
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

    const [existing] = await db.select().from(scheduleSwapRequests).where(and(
      eq(scheduleSwapRequests.id, requestId),
      eq(scheduleSwapRequests.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Schedule swap request not found." }, { status: 404 });
    if (existing.status !== "pending") {
      return Response.json({ error: "Only pending schedule swaps can be decided." }, { status: 409 });
    }

    const [requesterCheck, counterpartyCheck] = await Promise.all([
      scopedEmployee(user.id, organizationId, existing.requesterEmployeeId),
      scopedEmployee(user.id, organizationId, existing.counterpartyEmployeeId),
    ]);
    if (requesterCheck.denied) return requesterCheck.denied;
    if (counterpartyCheck.denied) return counterpartyCheck.denied;

    if (existing.requestedByUserId == null) {
      return Response.json({
        error: "This swap lacks stable requester identity and cannot be safely approved. Reject and recreate it.",
      }, { status: 409 });
    }
    if (existing.requestedByUserId === user.id) {
      return Response.json({
        error: "Schedule swaps cannot be self-approved. A different workforce manager must decide this request.",
      }, { status: 409 });
    }

    if (decision === "rejected") {
      const [updated] = await db.update(scheduleSwapRequests).set({
        status: "rejected",
        decidedBy: user.name,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote,
        updatedAt: new Date(),
      }).where(eq(scheduleSwapRequests.id, requestId)).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce schedule swap rejected",
        resource: `Swap #${requestId}`,
        metadata: { scheduleSwapRequestId: requestId, decisionNote },
      });
      return Response.json({ swap: updated });
    }

    const storedRequester = storedSnapshot(existing.requesterScheduleSnapshot);
    const storedCounterparty = storedSnapshot(existing.counterpartyScheduleSnapshot);
    if (!storedRequester || !storedCounterparty) {
      return Response.json({
        error: "Stored schedule snapshot is invalid; approval is blocked.",
      }, { status: 409 });
    }

    const current = await resolveSchedulesForPair({
      organizationId,
      requesterEmployeeId: existing.requesterEmployeeId,
      counterpartyEmployeeId: existing.counterpartyEmployeeId,
      requesterWorkDate: String(existing.requesterWorkDate),
      counterpartyWorkDate: String(existing.counterpartyWorkDate),
    });
    const currentRequester = scheduleSwapSnapshot(current.requester);
    const currentCounterparty = scheduleSwapSnapshot(current.counterparty);

    try {
      assertScheduleSwappable(currentRequester);
      assertScheduleSwappable(currentCounterparty);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Current schedules are no longer swappable.",
      }, { status: 409 });
    }

    if (
      !scheduleSwapSnapshotsMatch(storedRequester, currentRequester)
      || !scheduleSwapSnapshotsMatch(storedCounterparty, currentCounterparty)
    ) {
      return Response.json({
        error: "One or both schedules changed after this swap was requested. Reject and recreate the request from the current roster.",
      }, { status: 409 });
    }

    const requesterOverride = scheduleSwapOverrideValues(
      storedCounterparty,
      `Approved schedule swap #${requestId}: ${existing.reason}`,
    );
    const counterpartyOverride = scheduleSwapOverrideValues(
      storedRequester,
      `Approved schedule swap #${requestId}: ${existing.reason}`,
    );

    try {
      const result = await db.transaction(async (tx) => {
        const [requesterCreated] = await tx.insert(scheduleOverrides).values({
          organizationId,
          employeeId: existing.requesterEmployeeId,
          workDate: existing.requesterWorkDate,
          ...requesterOverride,
          status: "approved",
          createdBy: user.name,
          approvedBy: user.name,
          approvedAt: new Date(),
        }).returning();

        const [counterpartyCreated] = await tx.insert(scheduleOverrides).values({
          organizationId,
          employeeId: existing.counterpartyEmployeeId,
          workDate: existing.counterpartyWorkDate,
          ...counterpartyOverride,
          status: "approved",
          createdBy: user.name,
          approvedBy: user.name,
          approvedAt: new Date(),
        }).returning();

        const [updated] = await tx.update(scheduleSwapRequests).set({
          status: "approved",
          decidedBy: user.name,
          decidedByUserId: user.id,
          decidedAt: new Date(),
          decisionNote,
          updatedAt: new Date(),
        }).where(and(
          eq(scheduleSwapRequests.id, requestId),
          eq(scheduleSwapRequests.status, "pending"),
        )).returning();

        if (!updated) throw new Error("Schedule swap was already decided by another transaction.");
        return { updated, requesterCreated, counterpartyCreated };
      });

      const [requesterStaleTimesheets, counterpartyStaleTimesheets] = await Promise.all([
        markTimesheetsStaleForEmployeeDate({
          organizationId,
          employeeId: existing.requesterEmployeeId,
          workDate: String(existing.requesterWorkDate),
        }),
        markTimesheetsStaleForEmployeeDate({
          organizationId,
          employeeId: existing.counterpartyEmployeeId,
          workDate: String(existing.counterpartyWorkDate),
        }),
      ]);

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce schedule swap approved",
        resource: `Swap #${requestId}`,
        metadata: {
          scheduleSwapRequestId: requestId,
          requesterOverrideId: result.requesterCreated.id,
          counterpartyOverrideId: result.counterpartyCreated.id,
          requesterEmployeeId: existing.requesterEmployeeId,
          counterpartyEmployeeId: existing.counterpartyEmployeeId,
          requesterWorkDate: existing.requesterWorkDate,
          counterpartyWorkDate: existing.counterpartyWorkDate,
          requesterStaleTimesheetIds: requesterStaleTimesheets.map((row) => row.id),
          counterpartyStaleTimesheetIds: counterpartyStaleTimesheets.map((row) => row.id),
          decisionNote,
        },
      });

      return Response.json({
        swap: result.updated,
        overrides: [result.requesterCreated, result.counterpartyCreated],
        staleTimesheetIds: [
          ...requesterStaleTimesheets.map((row) => row.id),
          ...counterpartyStaleTimesheets.map((row) => row.id),
        ],
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Schedule swap approval could not be applied.",
      }, { status: 409 });
    }
  }

  return Response.json({
    error: "Unsupported action. Use create_request or decide_request.",
  }, { status: 400 });
}
