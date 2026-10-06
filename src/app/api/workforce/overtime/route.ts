import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, overtimeBudgets, overtimeRequests } from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  evaluateOvertimeBudget,
  monthForWorkDate,
  summarizeOvertimeBudget,
} from "@/lib/workforce-overtime-budget";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const REQUEST_KINDS = new Set(["pre_approved", "emergency_post_approval"]);
const OT_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const OT_DECIDER_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
const OT_BUDGET_ADMIN_ROLES = ["owner", "admin", "bookkeeper", "hr"] as const;

function currentManilaMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function monthBounds(periodMonth: string) {
  if (!PERIOD_MONTH.test(periodMonth)) throw new Error("periodMonth must use YYYY-MM.");
  const [yearText, monthText] = periodMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = `${periodMonth}-01`;
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { start, next };
}

function canRole(role: string, roles: readonly string[]) {
  return roles.includes(role);
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

function budgetLockKey(organizationId: number, orgUnitId: number, periodMonth: string) {
  return `ot-budget:${organizationId}:${orgUnitId}:${periodMonth}`;
}

async function decideRequests(input: {
  organizationId: number;
  requestIds: number[];
  decision: "approved" | "rejected";
  decisionNote: string | null;
  user: { id: number; name: string };
}) {
  const requestIds = [...new Set(input.requestIds)].sort((a, b) => a - b);
  if (requestIds.length === 0 || requestIds.length > 100) {
    throw new Error("Select between 1 and 100 overtime requests.");
  }

  const existingRows = await db.select().from(overtimeRequests).where(and(
    eq(overtimeRequests.organizationId, input.organizationId),
    inArray(overtimeRequests.id, requestIds),
  )).orderBy(asc(overtimeRequests.id));

  if (existingRows.length !== requestIds.length) {
    throw new Error("One or more overtime requests no longer exist in this organization.");
  }

  for (const existing of existingRows) {
    if (existing.status !== "pending") {
      throw new Error(`Overtime request #${existing.id} is no longer pending.`);
    }
    if (existing.requestedByUserId == null) {
      throw new Error(
        `Overtime request #${existing.id} predates stable requester identity tracking and cannot be safely approved. Cancel and recreate it.`,
      );
    }
    if (existing.requestedByUserId === input.user.id) {
      throw new Error(
        `Overtime request #${existing.id} cannot be self-approved. A different authorized manager must decide it.`,
      );
    }
    const employeeCheck = await scopedEmployee(
      input.user.id,
      input.organizationId,
      existing.employeeId,
    );
    if (employeeCheck.denied) {
      throw new Error(
        `Overtime request #${existing.id} is outside the approver's current workforce scope.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const lockKeys = [...new Set(
      existingRows
        .filter((row) => row.orgUnitId != null)
        .map((row) => budgetLockKey(
          input.organizationId,
          row.orgUnitId!,
          monthForWorkDate(String(row.workDate)),
        )),
    )].sort();

    for (const lockKey of lockKeys) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    }

    const budgetRows = await tx.select().from(overtimeBudgets).where(and(
      eq(overtimeBudgets.organizationId, input.organizationId),
      eq(overtimeBudgets.active, true),
    ));
    const budgetByKey = new Map(
      budgetRows.map((budget) => [
        `${budget.orgUnitId}|${budget.periodMonth}`,
        budget,
      ]),
    );

    const approvedByKey = new Map<string, number>();
    const pendingByKey = new Map<string, number>();

    for (const existing of existingRows) {
      if (existing.orgUnitId == null) continue;
      const periodMonth = monthForWorkDate(String(existing.workDate));
      const mapKey = `${existing.orgUnitId}|${periodMonth}`;
      if (approvedByKey.has(mapKey)) continue;
      const { start, next } = monthBounds(periodMonth);
      const rows = await tx.select({
        status: overtimeRequests.status,
        requestedMinutes: overtimeRequests.requestedMinutes,
      }).from(overtimeRequests).where(and(
        eq(overtimeRequests.organizationId, input.organizationId),
        eq(overtimeRequests.orgUnitId, existing.orgUnitId),
        gte(overtimeRequests.workDate, start),
        lt(overtimeRequests.workDate, next),
      ));
      approvedByKey.set(
        mapKey,
        rows
          .filter((row) => row.status === "approved")
          .reduce((sum, row) => sum + row.requestedMinutes, 0),
      );
      pendingByKey.set(
        mapKey,
        rows
          .filter((row) => row.status === "pending")
          .reduce((sum, row) => sum + row.requestedMinutes, 0),
      );
    }

    const updated = [];
    for (const existing of existingRows) {
      let budgetId: number | null = existing.budgetId;
      let budgetSnapshot: Record<string, unknown> = {};
      if (input.decision === "approved" && existing.orgUnitId != null) {
        const periodMonth = monthForWorkDate(String(existing.workDate));
        const mapKey = `${existing.orgUnitId}|${periodMonth}`;
        const budget = budgetByKey.get(mapKey) ?? null;
        const evaluation = evaluateOvertimeBudget({
          budget: budget ? {
            id: budget.id,
            orgUnitId: budget.orgUnitId,
            periodMonth: budget.periodMonth,
            budgetMinutes: budget.budgetMinutes,
            enforcementMode: budget.enforcementMode,
            managerUserId: budget.managerUserId,
            active: budget.active,
          } : null,
          approvedMinutes: approvedByKey.get(mapKey) ?? 0,
          pendingMinutes: pendingByKey.get(mapKey) ?? 0,
          requestedMinutes: existing.requestedMinutes,
          requestKind: existing.requestKind,
        });

        if (evaluation.approvalBlocked) {
          throw new Error(
            `Overtime request #${existing.id} cannot be approved: ${evaluation.approvalBlockReason}`,
          );
        }

        budgetId = budget?.id ?? null;
        budgetSnapshot = {
          ...evaluation,
          evaluatedAt: new Date().toISOString(),
          requestKind: existing.requestKind,
          entitlementNote:
            "Budget authorization never suppresses legally payable overtime from validated attendance.",
        };

        if (budget) {
          approvedByKey.set(
            mapKey,
            (approvedByKey.get(mapKey) ?? 0) + existing.requestedMinutes,
          );
          pendingByKey.set(
            mapKey,
            Math.max(0, (pendingByKey.get(mapKey) ?? 0) - existing.requestedMinutes),
          );
        }
      }

      const [row] = await tx.update(overtimeRequests)
        .set({
          status: input.decision,
          budgetId,
          budgetSnapshot,
          decidedBy: input.user.name,
          decidedByUserId: input.user.id,
          decidedAt: new Date(),
          decisionNote: input.decisionNote,
          updatedAt: new Date(),
        })
        .where(and(
          eq(overtimeRequests.id, existing.id),
          eq(overtimeRequests.status, "pending"),
        ))
        .returning();

      if (!row) {
        throw new Error(
          `Overtime request #${existing.id} changed while the decision was being saved. Refresh and try again.`,
        );
      }
      updated.push(row);
    }

    return { updated, originals: existingRows };
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const periodMonth = String(url.searchParams.get("month") ?? currentManilaMonth());
  if (!Number.isInteger(organizationId) || !PERIOD_MONTH.test(periodMonth)) {
    return Response.json({
      error: "organizationId and month (YYYY-MM) are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OT_ROLES,
    "You do not have permission to review overtime requests.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const [employeeRows, unitRows, requests, budgetRows] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(orgUnits)
      .where(eq(orgUnits.organizationId, organizationId))
      .orderBy(asc(orgUnits.name)),
    db.select().from(overtimeRequests)
      .where(eq(overtimeRequests.organizationId, organizationId))
      .orderBy(asc(overtimeRequests.workDate), asc(overtimeRequests.id)),
    db.select().from(overtimeBudgets).where(and(
      eq(overtimeBudgets.organizationId, organizationId),
      eq(overtimeBudgets.periodMonth, periodMonth),
      eq(overtimeBudgets.active, true),
    )).orderBy(asc(overtimeBudgets.orgUnitId)),
  ]);

  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));
  const visibleUnitIds = new Set(
    access.companyWide
      ? unitRows.map((unit) => unit.id)
      : unitRows.filter((unit) => unit.id === access.orgUnitId).map((unit) => unit.id),
  );
  const visibleRequests = requests.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const monthRequests = visibleRequests.filter(
    (row) => String(row.workDate).slice(0, 7) === periodMonth,
  );

  const budgets = budgetRows
    .filter((budget) => visibleUnitIds.has(budget.orgUnitId))
    .map((budget) => {
      const scoped = monthRequests.filter((row) => row.orgUnitId === budget.orgUnitId);
      const approvedMinutes = scoped
        .filter((row) => row.status === "approved")
        .reduce((sum, row) => sum + row.requestedMinutes, 0);
      const pendingMinutes = scoped
        .filter((row) => row.status === "pending")
        .reduce((sum, row) => sum + row.requestedMinutes, 0);
      return {
        ...budget,
        ...summarizeOvertimeBudget({
          budgetMinutes: budget.budgetMinutes,
          approvedMinutes,
          pendingMinutes,
        }),
      };
    });

  return Response.json({
    month: periodMonth,
    requests: visibleRequests,
    orgUnits: unitRows.filter((unit) => visibleUnitIds.has(unit.id)),
    budgets,
    canManageBudgets: canRole(access.role, OT_BUDGET_ADMIN_ROLES),
    canDecide: canRole(access.role, OT_DECIDER_ROLES),
    entitlementBoundary:
      "OT budget authorization is operational evidence only and never suppresses legally payable worked overtime.",
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

  const actionRoles =
    action === "save_budget"
      ? OT_BUDGET_ADMIN_ROLES
      : action === "decide_request" || action === "bulk_decide_requests"
        ? OT_DECIDER_ROLES
        : OT_ROLES;
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    actionRoles,
    action === "save_budget"
      ? "Only HR/payroll administrators can set overtime budgets."
      : action === "decide_request" || action === "bulk_decide_requests"
        ? "Only authorized workforce managers can decide overtime requests."
        : "You do not have permission to manage overtime requests.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-overtime-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "save_budget") {
    const orgUnitId = Number(body.orgUnitId);
    const periodMonth = String(body.periodMonth ?? "").trim();
    const budgetMinutes = Number(body.budgetMinutes);
    const enforcementMode = body.enforcementMode === "block" ? "block" : "advisory";
    const notes = String(body.notes ?? "").trim().slice(0, 240) || null;
    if (
      !Number.isInteger(orgUnitId)
      || !PERIOD_MONTH.test(periodMonth)
      || !Number.isInteger(budgetMinutes)
      || budgetMinutes < 0
      || budgetMinutes > 1_000_000
    ) {
      return Response.json({
        error: "orgUnitId, periodMonth (YYYY-MM), and budgetMinutes (0-1,000,000) are required.",
      }, { status: 400 });
    }

    const access = await getAccess(user.id, organizationId);
    if (!access || (!access.companyWide && access.orgUnitId !== orgUnitId)) {
      return Response.json({ error: "This organization unit is outside your assigned scope." }, { status: 403 });
    }
    const [unit] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, orgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
    if (!unit) return Response.json({ error: "Organization unit not found." }, { status: 404 });

    const saved = await db.transaction(async (tx) => {
      const lockKey = budgetLockKey(organizationId, orgUnitId, periodMonth);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx.select().from(overtimeBudgets).where(and(
        eq(overtimeBudgets.organizationId, organizationId),
        eq(overtimeBudgets.orgUnitId, orgUnitId),
        eq(overtimeBudgets.periodMonth, periodMonth),
      )).limit(1);

      if (existing) {
        const [updated] = await tx.update(overtimeBudgets).set({
          budgetMinutes,
          enforcementMode,
          active: true,
          notes,
          updatedBy: user.name,
          updatedByUserId: user.id,
          updatedAt: new Date(),
        }).where(eq(overtimeBudgets.id, existing.id)).returning();
        return updated;
      }

      const [created] = await tx.insert(overtimeBudgets).values({
        organizationId,
        orgUnitId,
        periodMonth,
        budgetMinutes,
        enforcementMode,
        active: true,
        notes,
        updatedBy: user.name,
        updatedByUserId: user.id,
      }).returning();
      return created;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Overtime budget saved",
      resource: `${unit.code} · ${periodMonth}`,
      metadata: {
        overtimeBudgetId: saved.id,
        orgUnitId,
        periodMonth,
        budgetMinutes,
        enforcementMode,
        payrollEntitlementIndependent: true,
      },
    });

    return Response.json({ budget: saved });
  }

  if (action === "create_request") {
    const employeeId = Number(body.employeeId);
    const workDate = String(body.workDate ?? "").trim();
    const requestedMinutes = Number(body.requestedMinutes);
    const reason = String(body.reason ?? "").trim().slice(0, 240);
    const requestKind = String(body.requestKind ?? "pre_approved").trim();

    if (
      !Number.isInteger(employeeId)
      || !ISO_DATE.test(workDate)
      || !Number.isInteger(requestedMinutes)
      || requestedMinutes < 1
      || requestedMinutes > 1_440
      || !reason
      || !REQUEST_KINDS.has(requestKind)
    ) {
      return Response.json({
        error: "employeeId, workDate, requestedMinutes (1-1440), reason, and a valid requestKind are required.",
      }, { status: 400 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;
    const employee = employeeCheck.employee!;

    const [created] = await db.insert(overtimeRequests).values({
      organizationId,
      employeeId,
      orgUnitId: employee.orgUnitId,
      workDate,
      requestedMinutes,
      reason,
      requestKind,
      status: "pending",
      requestedBy: user.name,
      requestedByUserId: user.id,
    }).returning();

    const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId,
      workDate,
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Overtime request created",
      resource: `${employee.employeeNo} · ${workDate}`,
      metadata: {
        overtimeRequestId: created.id,
        employeeId,
        orgUnitId: employee.orgUnitId,
        workDate,
        requestedMinutes,
        requestKind,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      },
    });

    return Response.json({
      request: created,
      staleTimesheetIds: staleTimesheets.map((row) => row.id),
    }, { status: 201 });
  }

  if (action === "decide_request" || action === "bulk_decide_requests") {
    const requestIds = action === "decide_request"
      ? [Number(body.requestId)]
      : Array.isArray(body.requestIds)
        ? body.requestIds.map(Number)
        : [];
    const decision = String(body.decision ?? "").trim();
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;
    if (
      requestIds.some((id) => !Number.isInteger(id) || id <= 0)
      || !["approved", "rejected"].includes(decision)
    ) {
      return Response.json({
        error: "Valid request ID(s) and decision (approved or rejected) are required.",
      }, { status: 400 });
    }

    try {
      const result = await decideRequests({
        organizationId,
        requestIds,
        decision: decision as "approved" | "rejected",
        decisionNote,
        user: { id: user.id, name: user.name },
      });

      const staleByRequest = [];
      for (const original of result.originals) {
        const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
          organizationId,
          employeeId: original.employeeId,
          workDate: String(original.workDate),
        });
        staleByRequest.push({
          requestId: original.id,
          ids: staleTimesheets.map((row) => row.id),
        });

        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: decision === "approved" ? "Overtime request approved" : "Overtime request rejected",
          resource: `OT #${original.id} · ${original.workDate}`,
          metadata: {
            overtimeRequestId: original.id,
            employeeId: original.employeeId,
            orgUnitId: original.orgUnitId,
            workDate: original.workDate,
            requestedMinutes: original.requestedMinutes,
            requestKind: original.requestKind,
            decision,
            bulkDecision: action === "bulk_decide_requests",
            staleTimesheetIds:
              staleByRequest.find((row) => row.requestId === original.id)?.ids ?? [],
          },
        });
      }

      return Response.json({
        requests: result.updated,
        staleTimesheets: staleByRequest,
        bulk: action === "bulk_decide_requests",
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Overtime decision could not be saved.",
      }, { status: 409 });
    }
  }

  return Response.json({ error: "Unsupported overtime action." }, { status: 400 });
}
