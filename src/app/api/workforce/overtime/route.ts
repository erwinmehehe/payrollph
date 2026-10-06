import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  orgUnits,
  overtimeBudgetPolicies,
  overtimeRequests,
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
  evaluateOvertimeBudget,
  overtimeBudgetMonthStart,
  overtimeBudgetScopeKey,
  resolveOvertimeBudgetPolicy,
  type OvertimeBudgetPolicyRecord,
} from "@/lib/workforce-overtime-budget";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import { runAutomationEventSafely } from "@/lib/automation";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_KINDS = new Set(["pre_approved", "emergency_post_approval"]);
const BUDGET_MODES = new Set(["advisory", "blocking"]);
const OT_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const OT_DECIDER_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
const OT_BUDGET_ADMIN_ROLES = ["owner", "admin", "bookkeeper", "hr"] as const;

function monthEnd(monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
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

function budgetRecord(row: typeof overtimeBudgetPolicies.$inferSelect): OvertimeBudgetPolicyRecord {
  return {
    id: row.id,
    orgUnitId: row.orgUnitId,
    managerUserId: row.managerUserId,
    monthStart: String(row.monthStart),
    budgetMinutes: row.budgetMinutes,
    enforcementMode: row.enforcementMode,
    active: row.active,
  };
}

function budgetUsedMinutes(input: {
  policy: OvertimeBudgetPolicyRecord;
  requests: Array<typeof overtimeRequests.$inferSelect>;
  employeeById: Map<number, typeof employees.$inferSelect>;
}) {
  const end = monthEnd(input.policy.monthStart);
  return input.requests
    .filter((request) => {
      if (request.status !== "approved") return false;
      const date = String(request.workDate);
      if (date < input.policy.monthStart || date > end) return false;
      const employee = input.employeeById.get(request.employeeId);
      if (!employee || employee.orgUnitId !== input.policy.orgUnitId) return false;
      if (input.policy.managerUserId != null && request.decidedByUserId !== input.policy.managerUserId) return false;
      return true;
    })
    .reduce((sum, request) => sum + Math.max(0, request.requestedMinutes), 0);
}

async function approvalBudgetCheck(input: {
  organizationId: number;
  managerUserId: number;
  selected: Array<{ request: typeof overtimeRequests.$inferSelect; employee: typeof employees.$inferSelect }>;
}) {
  const policies = await db.select().from(overtimeBudgetPolicies).where(and(
    eq(overtimeBudgetPolicies.organizationId, input.organizationId),
    eq(overtimeBudgetPolicies.active, true),
  ));
  if (policies.length === 0 || input.selected.length === 0) {
    return { blocked: false, warnings: [] as string[], evidence: [] as Array<Record<string, unknown>> };
  }

  const allRequests = await db.select().from(overtimeRequests)
    .where(eq(overtimeRequests.organizationId, input.organizationId));
  const employeeRows = await db.select().from(employees)
    .where(eq(employees.organizationId, input.organizationId));
  const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const policyRows = policies.map(budgetRecord);
  const additions = new Map<number, number>();
  const policyById = new Map(policyRows.map((policy) => [policy.id, policy]));

  for (const item of input.selected) {
    const policy = resolveOvertimeBudgetPolicy({
      policies: policyRows,
      orgUnitId: item.employee.orgUnitId,
      managerUserId: input.managerUserId,
      workDate: String(item.request.workDate),
    });
    if (!policy) continue;
    additions.set(policy.id, (additions.get(policy.id) ?? 0) + item.request.requestedMinutes);
  }

  const warnings: string[] = [];
  const evidence: Array<Record<string, unknown>> = [];
  let blocked = false;

  for (const [policyId, requestedMinutes] of additions) {
    const policy = policyById.get(policyId)!;
    const usedMinutes = budgetUsedMinutes({ policy, requests: allRequests, employeeById });
    const evaluation = evaluateOvertimeBudget({
      budgetMinutes: policy.budgetMinutes,
      usedMinutes,
      requestedMinutes,
      enforcementMode: policy.enforcementMode,
    });
    evidence.push({
      policyId,
      orgUnitId: policy.orgUnitId,
      managerUserId: policy.managerUserId,
      monthStart: policy.monthStart,
      ...evaluation,
    });
    if (evaluation.exceeded) {
      warnings.push(
        `OT budget #${policyId} would be exceeded by ${evaluation.overageMinutes} minute(s) (${evaluation.projectedMinutes}/${evaluation.budgetMinutes}).`,
      );
    }
    if (evaluation.blocked) blocked = true;
  }

  return { blocked, warnings, evidence };
}

async function loadDecisionCandidates(input: {
  userId: number;
  organizationId: number;
  requestIds: number[];
}) {
  const rows = await db.select().from(overtimeRequests).where(and(
    eq(overtimeRequests.organizationId, input.organizationId),
    inArray(overtimeRequests.id, input.requestIds),
  ));
  if (rows.length !== input.requestIds.length) {
    return { error: Response.json({ error: "One or more overtime requests were not found." }, { status: 404 }), selected: [] };
  }

  const access = await getAccess(input.userId, input.organizationId);
  if (!access) {
    return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }), selected: [] };
  }

  const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
  const employeeRows = await db.select().from(employees).where(and(
    eq(employees.organizationId, input.organizationId),
    inArray(employees.id, employeeIds),
  ));
  const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const selected: Array<{ request: typeof overtimeRequests.$inferSelect; employee: typeof employees.$inferSelect }> = [];

  for (const row of rows.sort((a, b) => a.id - b.id)) {
    const employee = employeeById.get(row.employeeId);
    if (!employee) {
      return { error: Response.json({ error: `Employee for overtime request #${row.id} was not found.` }, { status: 409 }), selected: [] };
    }
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) {
      return { error: Response.json({ error: scope.error }, { status: scope.status }), selected: [] };
    }
    if (row.status !== "pending") {
      return { error: Response.json({ error: `Overtime request #${row.id} is no longer pending.` }, { status: 409 }), selected: [] };
    }
    if (row.requestedByUserId == null) {
      return {
        error: Response.json({
          error: `Overtime request #${row.id} predates stable requester identity tracking and cannot be safely approved. Cancel and recreate it.`,
        }, { status: 409 }),
        selected: [],
      };
    }
    if (row.requestedByUserId === input.userId) {
      return {
        error: Response.json({
          error: `Overtime request #${row.id} cannot be self-approved. A different authorized manager must decide it.`,
        }, { status: 409 }),
        selected: [],
      };
    }
    selected.push({ request: row, employee });
  }

  return { error: null, selected };
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
    OT_ROLES,
    "You do not have permission to review overtime requests.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const [employeeRows, requests, budgetRows, unitRows, membershipRows] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(overtimeRequests)
      .where(eq(overtimeRequests.organizationId, organizationId))
      .orderBy(asc(overtimeRequests.workDate), asc(overtimeRequests.id)),
    db.select().from(overtimeBudgetPolicies)
      .where(eq(overtimeBudgetPolicies.organizationId, organizationId))
      .orderBy(asc(overtimeBudgetPolicies.monthStart), asc(overtimeBudgetPolicies.id)),
    db.select().from(orgUnits)
      .where(eq(orgUnits.organizationId, organizationId))
      .orderBy(asc(orgUnits.name)),
    db.select({
      userId: userOrganizations.userId,
      role: userOrganizations.role,
      orgUnitId: userOrganizations.orgUnitId,
      name: users.name,
    }).from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
      )),
  ]);

  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));
  const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const visibleUnitIds = new Set(
    access.companyWide
      ? unitRows.map((unit) => unit.id)
      : unitRows.filter((unit) => unit.id === access.orgUnitId).map((unit) => unit.id),
  );

  const budgets = budgetRows
    .filter((row) => visibleUnitIds.has(row.orgUnitId))
    .map((row) => {
      const policy = budgetRecord(row);
      const usedMinutes = budgetUsedMinutes({ policy, requests, employeeById });
      return {
        ...row,
        usedMinutes,
        remainingMinutes: Math.max(0, row.budgetMinutes - usedMinutes),
        exceeded: usedMinutes > row.budgetMinutes,
      };
    });

  return Response.json({
    requests: requests.filter((row) => visibleEmployeeIds.has(row.employeeId)),
    budgets,
    managers: membershipRows
      .filter((row) => OT_DECIDER_ROLES.includes(row.role as typeof OT_DECIDER_ROLES[number]))
      .filter((row) => access.companyWide || row.orgUnitId == null || row.orgUnitId === access.orgUnitId)
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        role: row.role,
        orgUnitId: row.orgUnitId,
      })),
    canManageBudgets: OT_BUDGET_ADMIN_ROLES.includes(access.role as typeof OT_BUDGET_ADMIN_ROLES[number]),
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

  const roles =
    action === "upsert_budget"
      ? OT_BUDGET_ADMIN_ROLES
      : action === "decide_request" || action === "bulk_decide_requests"
        ? OT_DECIDER_ROLES
        : OT_ROLES;
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    roles,
    action === "upsert_budget"
      ? "Only People/organization administrators can manage overtime budgets."
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

  if (action === "upsert_budget") {
    const orgUnitId = Number(body.orgUnitId);
    const managerUserId = body.managerUserId == null || body.managerUserId === ""
      ? null
      : Number(body.managerUserId);
    const monthStart = String(body.monthStart ?? "").trim();
    const budgetMinutes = Number(body.budgetMinutes);
    const enforcementMode = String(body.enforcementMode ?? "advisory");

    if (
      !Number.isInteger(orgUnitId)
      || orgUnitId <= 0
      || !/^\d{4}-\d{2}-01$/.test(monthStart)
      || !Number.isInteger(budgetMinutes)
      || budgetMinutes < 0
      || budgetMinutes > 1_000_000
      || !BUDGET_MODES.has(enforcementMode)
      || (managerUserId != null && (!Number.isInteger(managerUserId) || managerUserId <= 0))
    ) {
      return Response.json({
        error: "orgUnitId, first day of month, whole budgetMinutes, and advisory/blocking enforcement are required.",
      }, { status: 400 });
    }

    const access = await getAccess(user.id, organizationId);
    if (!access || (!access.companyWide && access.orgUnitId !== orgUnitId)) {
      return Response.json({ error: "This overtime budget is outside your organization-unit scope." }, { status: 403 });
    }
    const [unit] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, orgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
    if (!unit) return Response.json({ error: "Organization unit not found." }, { status: 404 });

    if (managerUserId != null) {
      const [membership] = await db.select().from(userOrganizations).where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.userId, managerUserId),
        eq(userOrganizations.active, true),
      )).limit(1);
      if (
        !membership
        || !OT_DECIDER_ROLES.includes(membership.role as typeof OT_DECIDER_ROLES[number])
        || (membership.orgUnitId != null && membership.orgUnitId !== orgUnitId)
      ) {
        return Response.json({
          error: "Manager must be an active OT decision-maker with access to this organization unit.",
        }, { status: 422 });
      }
    }

    const scopeKey = overtimeBudgetScopeKey(orgUnitId, managerUserId);
    const [saved] = await db.insert(overtimeBudgetPolicies).values({
      organizationId,
      orgUnitId,
      managerUserId,
      scopeKey,
      monthStart,
      budgetMinutes,
      enforcementMode,
      active: true,
      updatedBy: user.name,
      updatedByUserId: user.id,
    }).onConflictDoUpdate({
      target: [
        overtimeBudgetPolicies.organizationId,
        overtimeBudgetPolicies.scopeKey,
        overtimeBudgetPolicies.monthStart,
      ],
      set: {
        orgUnitId,
        managerUserId,
        budgetMinutes,
        enforcementMode,
        active: true,
        updatedBy: user.name,
        updatedByUserId: user.id,
        updatedAt: new Date(),
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Overtime budget configured",
      resource: `${unit.code} · ${monthStart}`,
      metadata: {
        overtimeBudgetPolicyId: saved.id,
        orgUnitId,
        managerUserId,
        monthStart,
        budgetMinutes,
        enforcementMode,
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

    const [created] = await db.insert(overtimeRequests).values({
      organizationId,
      employeeId,
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
      resource: `${employeeCheck.employee!.employeeNo} · ${workDate}`,
      metadata: {
        overtimeRequestId: created.id,
        employeeId,
        workDate,
        requestedMinutes,
        requestKind,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      },
    });

    const automation = await runAutomationEventSafely({
      organizationId,
      employeeId,
      trigger: "overtime.requested",
      eventKey: `overtime-requested:${created.id}`,
      context: {
        overtimeRequestId: created.id,
        overtimeMinutes: requestedMinutes,
        eventAmount: requestedMinutes,
        workDate,
        requestKind,
      },
    });

    return Response.json({
      request: created,
      staleTimesheetIds: staleTimesheets.map((row) => row.id),
      automation,
    }, { status: 201 });
  }

  if (action === "decide_request" || action === "bulk_decide_requests") {
    const requestIds = action === "decide_request"
      ? [Number(body.requestId)]
      : Array.isArray(body.requestIds)
        ? [...new Set(body.requestIds.map(Number))]
        : [];
    const decision = String(body.decision ?? "").trim();
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;

    if (
      requestIds.length < 1
      || requestIds.length > 50
      || requestIds.some((id) => !Number.isInteger(id) || id <= 0)
      || !["approved", "rejected"].includes(decision)
    ) {
      return Response.json({
        error: "1-50 request IDs and decision (approved or rejected) are required.",
      }, { status: 400 });
    }

    const candidates = await loadDecisionCandidates({
      userId: user.id,
      organizationId,
      requestIds,
    });
    if (candidates.error) return candidates.error;

    const budget = decision === "approved"
      ? await approvalBudgetCheck({
          organizationId,
          managerUserId: user.id,
          selected: candidates.selected,
        })
      : { blocked: false, warnings: [] as string[], evidence: [] as Array<Record<string, unknown>> };

    if (budget.blocked) {
      return Response.json({
        error: "Approval would exceed a blocking overtime budget.",
        code: "OVERTIME_BUDGET_BLOCKED",
        budgetWarnings: budget.warnings,
        budgetEvidence: budget.evidence,
      }, { status: 409 });
    }

    const updated = await db.transaction(async (tx) => {
      const rows: Array<typeof overtimeRequests.$inferSelect> = [];
      for (const item of candidates.selected) {
        const [row] = await tx.update(overtimeRequests)
          .set({
            status: decision,
            decidedBy: user.name,
            decidedByUserId: user.id,
            decidedAt: new Date(),
            decisionNote,
            updatedAt: new Date(),
          })
          .where(and(
            eq(overtimeRequests.id, item.request.id),
            eq(overtimeRequests.status, "pending"),
          ))
          .returning();
        if (!row) {
          throw new Error(`Overtime request #${item.request.id} changed while the decision batch was being committed.`);
        }
        rows.push(row);
      }
      return rows;
    }).catch((error) => error instanceof Error ? error : new Error("Bulk overtime decision failed."));

    if (updated instanceof Error) {
      return Response.json({ error: updated.message }, { status: 409 });
    }

    const automation: unknown[] = [];
    const staleTimesheetIds: number[] = [];
    for (const item of candidates.selected) {
      const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
        organizationId,
        employeeId: item.request.employeeId,
        workDate: String(item.request.workDate),
      });
      staleTimesheetIds.push(...staleTimesheets.map((row) => row.id));

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: decision === "approved" ? "Overtime request approved" : "Overtime request rejected",
        resource: `${item.employee.employeeNo} · ${item.request.workDate}`,
        metadata: {
          overtimeRequestId: item.request.id,
          employeeId: item.request.employeeId,
          workDate: item.request.workDate,
          requestedMinutes: item.request.requestedMinutes,
          requestKind: item.request.requestKind,
          decision,
          bulkDecision: requestIds.length > 1,
          budgetEvidence: budget.evidence,
          budgetWarnings: budget.warnings,
          staleTimesheetIds: staleTimesheets.map((row) => row.id),
        },
      });

      if (decision === "approved") {
        automation.push(...await runAutomationEventSafely({
          organizationId,
          employeeId: item.request.employeeId,
          trigger: "overtime.approved",
          eventKey: `overtime-approved:${item.request.id}`,
          context: {
            overtimeRequestId: item.request.id,
            overtimeMinutes: item.request.requestedMinutes,
            eventAmount: item.request.requestedMinutes,
            workDate: item.request.workDate,
            requestKind: item.request.requestKind,
            approvedBy: user.name,
          },
        }));
      }
    }

    return Response.json({
      requests: updated,
      request: action === "decide_request" ? updated[0] : undefined,
      staleTimesheetIds: [...new Set(staleTimesheetIds)],
      automation,
      budgetWarnings: budget.warnings,
      budgetEvidence: budget.evidence,
    });
  }

  return Response.json({ error: "Unsupported overtime action." }, { status: 400 });
}
