import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  orgUnits,
  overtimeRequests,
  workforceOvertimeBudgets,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { runAutomationEventSafely } from "@/lib/automation";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { evaluateOvertimeBudget } from "@/lib/workforce-overtime";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_KINDS = new Set(["pre_approved", "emergency_post_approval"]);
const OT_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const OT_DECIDER_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
const OT_BUDGET_OVERRIDE_ROLES = new Set(["owner", "admin", "bookkeeper", "hr"]);

class OvertimeDecisionError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 409, code = "OVERTIME_DECISION_BLOCKED") {
    super(message);
    this.status = status;
    this.code = code;
  }
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

function budgetUsage(input: {
  budgetMinutes: number;
  warningThresholdPercent: number;
  approvedMinutes: number;
  pendingMinutes: number;
}) {
  return evaluateOvertimeBudget({
    budgetMinutes: input.budgetMinutes,
    warningThresholdPercent: input.warningThresholdPercent,
    approvedMinutesBefore: input.approvedMinutes,
    pendingMinutes: input.pendingMinutes,
  });
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

  const [employeeRows, requests, budgetRows, unitRows] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(overtimeRequests)
      .where(eq(overtimeRequests.organizationId, organizationId))
      .orderBy(asc(overtimeRequests.workDate), asc(overtimeRequests.id)),
    db.select().from(workforceOvertimeBudgets)
      .where(eq(workforceOvertimeBudgets.organizationId, organizationId))
      .orderBy(asc(workforceOvertimeBudgets.periodStart), asc(workforceOvertimeBudgets.id)),
    db.select().from(orgUnits)
      .where(eq(orgUnits.organizationId, organizationId))
      .orderBy(asc(orgUnits.name), asc(orgUnits.id)),
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
  const visibleBudgets = budgetRows.filter((row) => visibleUnitIds.has(row.orgUnitId));

  const budgets = visibleBudgets.map((budget) => {
    const employeeIds = new Set(
      visibleEmployees
        .filter((employee) => employee.orgUnitId === budget.orgUnitId)
        .map((employee) => employee.id),
    );
    const inPeriod = visibleRequests.filter((row) =>
      employeeIds.has(row.employeeId)
      && String(row.workDate) >= String(budget.periodStart)
      && String(row.workDate) <= String(budget.periodEnd),
    );
    const approvedMinutes = inPeriod
      .filter((row) => row.status === "approved")
      .reduce((sum, row) => sum + row.requestedMinutes, 0);
    const pendingMinutes = inPeriod
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + row.requestedMinutes, 0);

    return {
      ...budget,
      ...budgetUsage({
        budgetMinutes: budget.budgetMinutes,
        warningThresholdPercent: budget.warningThresholdPercent,
        approvedMinutes,
        pendingMinutes,
      }),
    };
  });

  return Response.json({
    requests: visibleRequests,
    budgets,
    orgUnits: unitRows
      .filter((unit) => visibleUnitIds.has(unit.id))
      .map((unit) => ({ id: unit.id, name: unit.name, code: unit.code, type: unit.type })),
    budgetPolicy: {
      payrollEntitlementIndependent: true,
      managerOverBudgetApproval: "blocked",
      elevatedOverrideRequiresReason: true,
    },
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
  const decisionAction = action === "decide_request" || action === "bulk_decide_requests";

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    decisionAction || action === "upsert_budget" || action === "set_budget_active"
      ? OT_DECIDER_ROLES
      : OT_ROLES,
    decisionAction
      ? "Only authorized workforce managers can decide overtime requests."
      : action === "upsert_budget" || action === "set_budget_active"
        ? "Only authorized workforce managers can manage overtime budgets."
        : "You do not have permission to manage overtime requests.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

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
    const periodStart = String(body.periodStart ?? "").trim();
    const periodEnd = String(body.periodEnd ?? "").trim();
    const budgetMinutes = Number(body.budgetMinutes);
    const warningThresholdPercent = Number(body.warningThresholdPercent ?? 80);

    if (
      !Number.isInteger(orgUnitId)
      || !ISO_DATE.test(periodStart)
      || !ISO_DATE.test(periodEnd)
      || periodEnd < periodStart
      || !Number.isInteger(budgetMinutes)
      || budgetMinutes < 0
      || !Number.isInteger(warningThresholdPercent)
      || warningThresholdPercent < 1
      || warningThresholdPercent > 100
    ) {
      return Response.json({
        error: "orgUnitId, valid period dates, non-negative budgetMinutes, and warningThresholdPercent (1-100) are required.",
      }, { status: 400 });
    }

    const [unit] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, orgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
    if (!unit) return Response.json({ error: "Organization unit not found." }, { status: 404 });
    if (!access.companyWide && access.orgUnitId !== orgUnitId) {
      return Response.json({ error: "This OT budget is outside your assigned organization unit." }, { status: 403 });
    }

    const rows = await db.select().from(workforceOvertimeBudgets).where(and(
      eq(workforceOvertimeBudgets.organizationId, organizationId),
      eq(workforceOvertimeBudgets.orgUnitId, orgUnitId),
    ));
    const exact = rows.find((row) =>
      String(row.periodStart) === periodStart && String(row.periodEnd) === periodEnd,
    );
    const overlap = rows.find((row) =>
      row.active
      && row.id !== exact?.id
      && String(row.periodStart) <= periodEnd
      && String(row.periodEnd) >= periodStart,
    );
    if (overlap) {
      return Response.json({
        error: `OT budget overlaps active budget #${overlap.id} (${overlap.periodStart} to ${overlap.periodEnd}).`,
        code: "OT_BUDGET_OVERLAP",
      }, { status: 409 });
    }

    const [saved] = exact
      ? await db.update(workforceOvertimeBudgets).set({
          budgetMinutes,
          warningThresholdPercent,
          active: true,
          updatedAt: new Date(),
        }).where(eq(workforceOvertimeBudgets.id, exact.id)).returning()
      : await db.insert(workforceOvertimeBudgets).values({
          organizationId,
          orgUnitId,
          periodStart,
          periodEnd,
          budgetMinutes,
          warningThresholdPercent,
          active: true,
          createdBy: user.name,
          createdByUserId: user.id,
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: exact ? "Overtime budget updated" : "Overtime budget created",
      resource: `${unit.code} · ${periodStart} to ${periodEnd}`,
      metadata: {
        overtimeBudgetId: saved.id,
        orgUnitId,
        periodStart,
        periodEnd,
        budgetMinutes,
        warningThresholdPercent,
        payrollEntitlementIndependent: true,
      },
    });

    return Response.json({ budget: saved });
  }

  if (action === "set_budget_active") {
    const budgetId = Number(body.budgetId);
    const active = Boolean(body.active);
    if (!Number.isInteger(budgetId)) {
      return Response.json({ error: "budgetId is required." }, { status: 400 });
    }
    const [existing] = await db.select().from(workforceOvertimeBudgets).where(and(
      eq(workforceOvertimeBudgets.id, budgetId),
      eq(workforceOvertimeBudgets.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "OT budget not found." }, { status: 404 });
    if (!access.companyWide && access.orgUnitId !== existing.orgUnitId) {
      return Response.json({ error: "This OT budget is outside your assigned organization unit." }, { status: 403 });
    }
    const [updated] = await db.update(workforceOvertimeBudgets)
      .set({ active, updatedAt: new Date() })
      .where(eq(workforceOvertimeBudgets.id, budgetId))
      .returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: active ? "Overtime budget activated" : "Overtime budget deactivated",
      resource: `OT budget #${budgetId}`,
      metadata: { overtimeBudgetId: budgetId, orgUnitId: existing.orgUnitId, active },
    });
    return Response.json({ budget: updated });
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

  if (decisionAction) {
    const decision = String(body.decision ?? "").trim();
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;
    const budgetOverrideReason = String(body.budgetOverrideReason ?? "").trim().slice(0, 240) || null;
    const requestIds = action === "bulk_decide_requests"
      ? [...new Set(
          (Array.isArray(body.requestIds) ? body.requestIds : [])
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isInteger(value)),
        )]
      : [Number(body.requestId)];

    if (
      !["approved", "rejected"].includes(decision)
      || requestIds.length < 1
      || requestIds.length > 100
      || requestIds.some((id) => !Number.isInteger(id))
    ) {
      return Response.json({
        error: "One to 100 request IDs and decision (approved or rejected) are required.",
      }, { status: 400 });
    }

    const employeeRows = await db.select().from(employees)
      .where(eq(employees.organizationId, organizationId));
    const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));

    try {
      const results = await db.transaction(async (tx) => {
        const rows = await tx.select().from(overtimeRequests).where(and(
          eq(overtimeRequests.organizationId, organizationId),
          inArray(overtimeRequests.id, requestIds),
        ));
        if (rows.length !== requestIds.length) {
          throw new OvertimeDecisionError("One or more overtime requests were not found.", 404, "OT_REQUEST_NOT_FOUND");
        }

        const ordered = [...rows].sort((a, b) => a.id - b.id);
        const decided = [];

        for (const existing of ordered) {
          if (existing.status !== "pending") {
            throw new OvertimeDecisionError(
              `Overtime request #${existing.id} is no longer pending.`,
              409,
              "OT_REQUEST_NOT_PENDING",
            );
          }
          const employee = employeeById.get(existing.employeeId);
          if (!employee) {
            throw new OvertimeDecisionError(`Employee for OT request #${existing.id} was not found.`, 404);
          }
          const scope = assertScope(access, employee.orgUnitId);
          if (!scope.ok) {
            throw new OvertimeDecisionError(scope.error, scope.status, "OT_REQUEST_OUT_OF_SCOPE");
          }
          if (existing.requestedByUserId == null) {
            throw new OvertimeDecisionError(
              `OT request #${existing.id} predates stable requester identity tracking. Cancel and recreate it.`,
              409,
              "OT_LEGACY_REQUESTER_IDENTITY",
            );
          }
          if (existing.requestedByUserId === user.id) {
            throw new OvertimeDecisionError(
              `Overtime request #${existing.id} cannot be self-approved. A different authorized manager must decide it.`,
              409,
              "OT_SELF_APPROVAL_BLOCKED",
            );
          }

          let budgetId: number | null = null;
          let budgetMinutesAtDecision: number | null = null;
          let budgetApprovedMinutesBefore: number | null = null;
          let appliedOverrideReason: string | null = null;

          if (decision === "approved" && employee.orgUnitId != null) {
            const matchingBudgets = await tx.select().from(workforceOvertimeBudgets).where(and(
              eq(workforceOvertimeBudgets.organizationId, organizationId),
              eq(workforceOvertimeBudgets.orgUnitId, employee.orgUnitId),
              eq(workforceOvertimeBudgets.active, true),
              lte(workforceOvertimeBudgets.periodStart, existing.workDate),
              gte(workforceOvertimeBudgets.periodEnd, existing.workDate),
            ));
            if (matchingBudgets.length > 1) {
              throw new OvertimeDecisionError(
                `OT request #${existing.id} matches multiple active budgets. Resolve the overlap before approval.`,
                409,
                "OT_BUDGET_AMBIGUOUS",
              );
            }
            const budget = matchingBudgets[0] ?? null;
            if (budget) {
              await tx.execute(sql`SELECT id FROM workforce_overtime_budgets WHERE id = ${budget.id} FOR UPDATE`);
              const [usage] = await tx.select({
                approvedMinutes: sql<number>`coalesce(sum(${overtimeRequests.requestedMinutes}), 0)`,
              })
                .from(overtimeRequests)
                .innerJoin(employees, eq(overtimeRequests.employeeId, employees.id))
                .where(and(
                  eq(overtimeRequests.organizationId, organizationId),
                  eq(overtimeRequests.status, "approved"),
                  eq(employees.orgUnitId, employee.orgUnitId),
                  gte(overtimeRequests.workDate, budget.periodStart),
                  lte(overtimeRequests.workDate, budget.periodEnd),
                ));

              const approvedMinutesBefore = Number(usage?.approvedMinutes ?? 0);
              const evaluation = evaluateOvertimeBudget({
                budgetMinutes: budget.budgetMinutes,
                approvedMinutesBefore,
                requestMinutes: existing.requestedMinutes,
                warningThresholdPercent: budget.warningThresholdPercent,
              });
              if (evaluation.overBudget) {
                const canOverride = OT_BUDGET_OVERRIDE_ROLES.has(access.role);
                if (!canOverride || !budgetOverrideReason) {
                  throw new OvertimeDecisionError(
                    `Approving OT request #${existing.id} would exceed the ${budget.budgetMinutes}-minute budget by ${evaluation.projectedApprovedMinutes - budget.budgetMinutes} minute(s). An owner/admin/bookkeeper/HR override with reason is required.`,
                    409,
                    "OT_BUDGET_EXCEEDED",
                  );
                }
                appliedOverrideReason = budgetOverrideReason;
              }

              budgetId = budget.id;
              budgetMinutesAtDecision = budget.budgetMinutes;
              budgetApprovedMinutesBefore = approvedMinutesBefore;
            }
          }

          const [updated] = await tx.update(overtimeRequests)
            .set({
              status: decision,
              decidedBy: user.name,
              decidedByUserId: user.id,
              decidedAt: new Date(),
              decisionNote,
              budgetId,
              budgetMinutesAtDecision,
              budgetApprovedMinutesBefore,
              budgetOverrideReason: appliedOverrideReason,
              updatedAt: new Date(),
            })
            .where(and(
              eq(overtimeRequests.id, existing.id),
              eq(overtimeRequests.status, "pending"),
            ))
            .returning();

          if (!updated) {
            throw new OvertimeDecisionError(
              `OT request #${existing.id} changed while this decision was being saved.`,
              409,
              "OT_CONCURRENT_DECISION",
            );
          }
          decided.push({
            request: updated,
            employee,
            budgetEvidence: budgetId == null ? null : {
              budgetId,
              budgetMinutesAtDecision,
              budgetApprovedMinutesBefore,
              budgetOverrideReason: appliedOverrideReason,
            },
          });
        }
        return decided;
      });

      const responseRows = [];
      for (const result of results) {
        const existing = result.request;
        const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
          organizationId,
          employeeId: existing.employeeId,
          workDate: String(existing.workDate),
        });

        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: decision === "approved" ? "Overtime request approved" : "Overtime request rejected",
          resource: `${result.employee.employeeNo} · ${existing.workDate}`,
          metadata: {
            overtimeRequestId: existing.id,
            employeeId: existing.employeeId,
            workDate: existing.workDate,
            requestedMinutes: existing.requestedMinutes,
            requestKind: existing.requestKind,
            decision,
            bulkDecision: action === "bulk_decide_requests",
            budgetEvidence: result.budgetEvidence,
            payrollEntitlementIndependent: true,
            staleTimesheetIds: staleTimesheets.map((row) => row.id),
          },
        });

        const automation = decision === "approved"
          ? await runAutomationEventSafely({
              organizationId,
              employeeId: existing.employeeId,
              trigger: "overtime.approved",
              eventKey: `overtime-approved:${existing.id}`,
              context: {
                overtimeRequestId: existing.id,
                overtimeMinutes: existing.requestedMinutes,
                eventAmount: existing.requestedMinutes,
                workDate: existing.workDate,
                requestKind: existing.requestKind,
                approvedBy: user.name,
                overtimeBudgetId: result.budgetEvidence?.budgetId ?? null,
                overtimeBudgetOverride: Boolean(result.budgetEvidence?.budgetOverrideReason),
              },
            })
          : [];

        responseRows.push({
          request: existing,
          staleTimesheetIds: staleTimesheets.map((row) => row.id),
          automation,
          budgetEvidence: result.budgetEvidence,
        });
      }

      return Response.json({
        request: responseRows.length === 1 ? responseRows[0].request : undefined,
        requests: responseRows.map((row) => row.request),
        decisions: responseRows,
        payrollEntitlementIndependent: true,
      });
    } catch (error) {
      if (error instanceof OvertimeDecisionError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  }

  return Response.json({ error: "Unsupported overtime action." }, { status: 400 });
}
