import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  workforceTimesheetPolicies,
  workforceTimesheets,
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
  buildEmployeeTimesheetSnapshot,
  latestTimesheetsForPeriod,
  loadTimesheetPolicy,
} from "@/lib/workforce-timesheet-server";
import {
  linkTimesheetExpectationsToTimesheet,
  listTimesheetExpectationsForPeriod,
} from "@/lib/workforce-timesheet-expectations";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function visibleEmployees(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return null;
  const rows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));
  return {
    access,
    employees: access.companyWide
      ? rows
      : rows.filter((employee) => employee.orgUnitId === access.orgUnitId),
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const periodStart = String(url.searchParams.get("periodStart") ?? "");
  const periodEnd = String(url.searchParams.get("periodEnd") ?? "");
  if (!Number.isInteger(organizationId) || !ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd) || periodEnd < periodStart) {
    return Response.json({ error: "organizationId, periodStart and periodEnd are required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  const manager = WORKFORCE_MANAGER_ROLES.includes(access.role as typeof WORKFORCE_MANAGER_ROLES[number]);
  let employeeRows: typeof employees.$inferSelect[] = [];
  if (manager) {
    const visible = await visibleEmployees(user.id, organizationId);
    employeeRows = visible?.employees ?? [];
  } else if (user.employeeId) {
    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, user.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (employee) employeeRows = [employee];
  } else {
    return Response.json({ error: "Your role cannot review workforce timesheets." }, { status: 403 });
  }

  const employeeIds = employeeRows.map((employee) => employee.id);
  const latest = await latestTimesheetsForPeriod({
    organizationId,
    employeeIds,
    periodStart,
    periodEnd,
  });
  const allHistory = employeeIds.length
    ? await db.select().from(workforceTimesheets).where(and(
        eq(workforceTimesheets.organizationId, organizationId),
        inArray(workforceTimesheets.employeeId, employeeIds),
        eq(workforceTimesheets.periodStart, periodStart),
        eq(workforceTimesheets.periodEnd, periodEnd),
      )).orderBy(asc(workforceTimesheets.employeeId), desc(workforceTimesheets.version))
    : [];

  const expectations = await listTimesheetExpectationsForPeriod({
    organizationId,
    employeeIds,
    periodStart,
    periodEnd,
  });

  return Response.json({
    policy: await loadTimesheetPolicy(organizationId),
    manager,
    employees: employeeRows.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
      orgUnitId: employee.orgUnitId,
    })),
    latest,
    history: allHistory,
    expectations,
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
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `wfm-timesheet-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 60,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "update_policy") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      WORKFORCE_MANAGER_ROLES,
      "Only workforce managers can configure the timesheet payroll gate.",
    );
    if (denied) return denied;
    if (!access.companyWide) {
      return Response.json({ error: "Timesheet policy requires company-wide workforce access." }, { status: 403 });
    }
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const enforcementMode = String(body.enforcementMode ?? "advisory");
    const active = body.active == null ? true : Boolean(body.active);
    if (!["advisory", "block"].includes(enforcementMode)) {
      return Response.json({ error: "enforcementMode must be advisory or block." }, { status: 400 });
    }

    const [existing] = await db.select().from(workforceTimesheetPolicies)
      .where(eq(workforceTimesheetPolicies.organizationId, organizationId))
      .limit(1);
    const values = {
      enforcementMode,
      active,
      updatedBy: user.name,
      updatedByUserId: user.id,
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await db.update(workforceTimesheetPolicies).set(values)
          .where(eq(workforceTimesheetPolicies.id, existing.id)).returning()
      : await db.insert(workforceTimesheetPolicies)
          .values({ organizationId, ...values }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "WFM timesheet payroll gate policy updated",
      resource: "Workforce timesheets",
      metadata: { policyId: saved.id, enforcementMode, active },
    });
    return Response.json({ policy: { active: saved.active, enforcementMode: saved.enforcementMode } });
  }

  if (action === "submit") {
    const employeeId = Number(body.employeeId ?? user.employeeId);
    const periodStart = String(body.periodStart ?? "");
    const periodEnd = String(body.periodEnd ?? "");
    if (!Number.isInteger(employeeId) || !ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd) || periodEnd < periodStart) {
      return Response.json({ error: "employeeId and valid periodStart/periodEnd are required." }, { status: 400 });
    }

    const selfService = user.employeeId === employeeId;
    if (!selfService) {
      const denied = await assertOrganizationRole(
        user.id,
        organizationId,
        WORKFORCE_MANAGER_ROLES,
        "Only workforce managers can submit a timesheet for another employee.",
      );
      if (denied) return denied;
    }

    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const existing = await db.select().from(workforceTimesheets).where(and(
      eq(workforceTimesheets.organizationId, organizationId),
      eq(workforceTimesheets.employeeId, employeeId),
      eq(workforceTimesheets.periodStart, periodStart),
      eq(workforceTimesheets.periodEnd, periodEnd),
    )).orderBy(desc(workforceTimesheets.version));
    if (existing[0]?.status === "submitted") {
      return Response.json({ error: "The latest timesheet version is already submitted for review." }, { status: 409 });
    }

    const built = await buildEmployeeTimesheetSnapshot({
      organizationId,
      employeeId,
      periodStart,
      periodEnd,
    });
    const version = (existing[0]?.version ?? 0) + 1;
    const [created] = await db.transaction(async (tx) => {
      const [submitted] = await tx.insert(workforceTimesheets).values({
        organizationId,
        employeeId,
        periodStart,
        periodEnd,
        version,
        status: "submitted",
        scheduledMinutes: built.scheduledMinutes,
        workedMinutes: built.workedMinutes,
        overtimeMinutes: built.overtimeMinutes,
        exceptionCount: built.exceptionCount,
        blockerCount: built.blockerCount,
        snapshot: built.snapshot,
        snapshotHash: built.snapshotHash,
        submittedBy: user.name,
        submittedByUserId: user.id,
        submittedAt: new Date(),
      }).returning();
      await linkTimesheetExpectationsToTimesheet({
        organizationId,
        employeeId,
        periodStart,
        periodEnd,
        timesheetId: submitted.id,
        timesheetVersion: submitted.version,
        timesheetStatus: submitted.status,
        submittedAt: submitted.submittedAt,
      }, tx);
      return [submitted];
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "WFM timesheet submitted",
      resource: `${employee.employeeNo} · ${periodStart}–${periodEnd}`,
      metadata: {
        timesheetId: created.id,
        version,
        employeeId,
        snapshotHash: built.snapshotHash,
        blockerCount: built.blockerCount,
        exceptionCount: built.exceptionCount,
      },
    });

    return Response.json({ timesheet: created }, { status: 201 });
  }

  if (action === "decide") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      WORKFORCE_MANAGER_ROLES,
      "Only workforce managers can approve or reject timesheets.",
    );
    if (denied) return denied;
    const timesheetId = Number(body.timesheetId);
    const decision = String(body.decision ?? "");
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;
    if (!Number.isInteger(timesheetId) || !["approved", "rejected"].includes(decision)) {
      return Response.json({ error: "timesheetId and approved/rejected decision are required." }, { status: 400 });
    }

    const [timesheet] = await db.select().from(workforceTimesheets).where(and(
      eq(workforceTimesheets.id, timesheetId),
      eq(workforceTimesheets.organizationId, organizationId),
    )).limit(1);
    if (!timesheet) return Response.json({ error: "Timesheet not found." }, { status: 404 });
    if (timesheet.status !== "submitted") {
      return Response.json({ error: "Only submitted timesheets can be decided." }, { status: 409 });
    }
    if (timesheet.submittedByUserId === user.id) {
      return Response.json({ error: "A timesheet submitter cannot approve their own submitted version." }, { status: 409 });
    }

    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, timesheet.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    if (decision === "approved") {
      const current = await buildEmployeeTimesheetSnapshot({
        organizationId,
        employeeId: timesheet.employeeId,
        periodStart: String(timesheet.periodStart),
        periodEnd: String(timesheet.periodEnd),
      });
      if (current.snapshotHash !== timesheet.snapshotHash) {
        await db.update(workforceTimesheets).set({
          status: "stale",
          updatedAt: new Date(),
        }).where(eq(workforceTimesheets.id, timesheet.id));
        return Response.json({
          error: "Timesheet evidence changed after submission. The submitted version was marked stale; submit a new version.",
          code: "TIMESHEET_EVIDENCE_CHANGED",
        }, { status: 409 });
      }
      if (current.blockerCount > 0) {
        return Response.json({
          error: `Timesheet has ${current.blockerCount} blocking attendance/OT issue(s). Resolve them before approval.`,
          code: "TIMESHEET_BLOCKERS",
          blockerCount: current.blockerCount,
        }, { status: 409 });
      }
    }

    const [updated] = await db.transaction(async (tx) => {
      const [decided] = await tx.update(workforceTimesheets).set({
        status: decision,
        decidedBy: user.name,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote,
        updatedAt: new Date(),
      }).where(and(
        eq(workforceTimesheets.id, timesheet.id),
        eq(workforceTimesheets.status, "submitted"),
      )).returning();
      if (!decided) return [];
      await linkTimesheetExpectationsToTimesheet({
        organizationId,
        employeeId: decided.employeeId,
        periodStart: String(decided.periodStart),
        periodEnd: String(decided.periodEnd),
        timesheetId: decided.id,
        timesheetVersion: decided.version,
        timesheetStatus: decided.status,
        submittedAt: decided.submittedAt,
      }, tx);
      return [decided];
    });
    if (!updated) return Response.json({ error: "Timesheet state changed while deciding it. Refresh and retry." }, { status: 409 });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: decision === "approved" ? "WFM timesheet approved" : "WFM timesheet rejected",
      resource: `${employee.employeeNo} · ${timesheet.periodStart}–${timesheet.periodEnd} · v${timesheet.version}`,
      metadata: {
        timesheetId: timesheet.id,
        employeeId: timesheet.employeeId,
        version: timesheet.version,
        snapshotHash: timesheet.snapshotHash,
        decisionNote,
      },
    });

    return Response.json({ timesheet: updated });
  }

  return Response.json({
    error: "Unsupported action. Use update_policy, submit or decide.",
  }, { status: 400 });
}
