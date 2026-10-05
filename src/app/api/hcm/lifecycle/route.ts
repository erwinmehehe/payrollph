import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLifecycleTransactions,
  employees,
  jobProfiles,
  positionAssignments,
  positions,
} from "@/db/schema";
import {
  APPROVAL_ADMIN_ROLES,
  PEOPLE_ADMIN_ROLES,
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  EMPLOYEE_LIFECYCLE_CHANGE_TYPES,
  applyEmployeeLifecycleTransaction,
  lifecycleChangeNeedsEmploymentType,
  lifecycleChangeNeedsManager,
  lifecycleChangeNeedsPosition,
  loadEmployeeLifecycleSnapshot,
  manilaToday,
} from "@/lib/hcm-employee-lifecycle";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const UNRESOLVED_STATUSES = ["pending", "scheduled", "failed"] as const;

function isoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function scopedEmployee(
  userId: number,
  organizationId: number,
  employeeId: number,
) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return {
      employee: null,
      access: null,
      denied: Response.json({ error: "Employee not found in this organization." }, { status: 404 }),
    };
  }
  const access = await getAccess(userId, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) {
    return {
      employee: null,
      access,
      denied: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }
  return { employee, access, denied: null };
}

async function validateTargetPosition(input: {
  userId: number;
  organizationId: number;
  employeeId: number;
  targetPositionId: number;
  currentPositionId: number | null;
}) {
  const [position] = await db.select().from(positions).where(and(
    eq(positions.id, input.targetPositionId),
    eq(positions.organizationId, input.organizationId),
  )).limit(1);
  if (!position) {
    return {
      position: null,
      error: Response.json({ error: "Target position not found in this organization." }, { status: 404 }),
    };
  }

  const access = await getAccess(input.userId, input.organizationId);
  const scope = assertScope(access, position.orgUnitId);
  if (!scope.ok) {
    return {
      position: null,
      error: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }
  if (position.id === input.currentPositionId) {
    return {
      position: null,
      error: Response.json({ error: "Target position is already the employee's active position." }, { status: 409 }),
    };
  }
  if (position.status !== "approved") {
    return {
      position: null,
      error: Response.json({
        error: "Internal lifecycle moves require an approved vacant position.",
        positionStatus: position.status,
      }, { status: 409 }),
    };
  }

  const [occupied] = await db.select({ id: positionAssignments.id }).from(positionAssignments).where(and(
    eq(positionAssignments.positionId, position.id),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);
  if (occupied) {
    return {
      position: null,
      error: Response.json({ error: "Target position already has an active employee assignment." }, { status: 409 }),
    };
  }

  return { position, error: null };
}

async function validateTargetManager(input: {
  userId: number;
  organizationId: number;
  employeeId: number;
  targetManagerEmployeeId: number | null;
}) {
  if (input.targetManagerEmployeeId == null) {
    return { manager: null, error: null };
  }
  if (input.targetManagerEmployeeId === input.employeeId) {
    return {
      manager: null,
      error: Response.json({ error: "An employee cannot be their own manager." }, { status: 409 }),
    };
  }

  const [manager] = await db.select().from(employees).where(and(
    eq(employees.id, input.targetManagerEmployeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!manager || manager.status !== "Active") {
    return {
      manager: null,
      error: Response.json({ error: "Target manager must be an active employee in this organization." }, { status: 422 }),
    };
  }

  const access = await getAccess(input.userId, input.organizationId);
  const scope = assertScope(access, manager.orgUnitId);
  if (!scope.ok) {
    return {
      manager: null,
      error: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }
  return { manager, error: null };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view employee lifecycle transactions.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [allEmployees, allPositions, profiles, allAssignments] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.lastName), asc(employees.firstName)),
    db.select().from(positions)
      .where(eq(positions.organizationId, organizationId))
      .orderBy(asc(positions.code)),
    db.select().from(jobProfiles)
      .where(eq(jobProfiles.organizationId, organizationId))
      .orderBy(asc(jobProfiles.title)),
    db.select().from(positionAssignments)
      .where(and(
        eq(positionAssignments.organizationId, organizationId),
        isNull(positionAssignments.effectiveUntil),
      ))
      .orderBy(asc(positionAssignments.employeeId)),
  ]);

  const visibleEmployees = access.companyWide
    ? allEmployees
    : allEmployees.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = visibleEmployees.map((employee) => employee.id);
  const visiblePositions = access.companyWide
    ? allPositions
    : allPositions.filter((position) => position.orgUnitId === access.orgUnitId);
  const visiblePositionIds = new Set(visiblePositions.map((position) => position.id));

  const transactions = visibleEmployeeIds.length
    ? await db.select().from(employeeLifecycleTransactions).where(and(
        eq(employeeLifecycleTransactions.organizationId, organizationId),
        inArray(employeeLifecycleTransactions.employeeId, visibleEmployeeIds),
      )).orderBy(desc(employeeLifecycleTransactions.createdAt), desc(employeeLifecycleTransactions.id))
    : [];

  return Response.json({
    currentUserId: user.id,
    access,
    employees: visibleEmployees.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      firstName: employee.firstName,
      lastName: employee.lastName,
      title: employee.title,
      employmentType: employee.employmentType,
      orgUnitId: employee.orgUnitId,
      status: employee.status,
    })),
    positions: visiblePositions,
    profiles,
    assignments: allAssignments.filter((assignment) =>
      visibleEmployeeIds.includes(assignment.employeeId)
      || visiblePositionIds.has(assignment.positionId),
    ),
    transactions,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "create").trim();

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage employee lifecycle transactions.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `hcm-lifecycle-${action}`,
    resourceId: organizationId,
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create") {
    const employeeId = Number(body.employeeId);
    const changeType = String(body.changeType ?? "");
    const effectiveDate = String(body.effectiveDate ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 320);

    if (
      !Number.isInteger(employeeId)
      || !EMPLOYEE_LIFECYCLE_CHANGE_TYPES.includes(changeType as (typeof EMPLOYEE_LIFECYCLE_CHANGE_TYPES)[number])
      || !isoDate(effectiveDate)
      || !reason
    ) {
      return Response.json({
        error: "employeeId, valid changeType, effectiveDate (YYYY-MM-DD), and reason are required.",
      }, { status: 400 });
    }
    if (effectiveDate < manilaToday()) {
      return Response.json({
        error: "Backdated HCM lifecycle transactions are not allowed. Use today or a future effective date.",
      }, { status: 409 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;
    const employee = employeeCheck.employee!;
    if (!["Active", "On leave"].includes(employee.status)) {
      return Response.json({
        error: `Employee status ${employee.status} does not allow a lifecycle change.`,
      }, { status: 409 });
    }

    const unresolved = await db.select({ id: employeeLifecycleTransactions.id, status: employeeLifecycleTransactions.status })
      .from(employeeLifecycleTransactions)
      .where(and(
        eq(employeeLifecycleTransactions.organizationId, organizationId),
        eq(employeeLifecycleTransactions.employeeId, employeeId),
        inArray(employeeLifecycleTransactions.status, [...UNRESOLVED_STATUSES]),
      ))
      .limit(1);
    if (unresolved.length) {
      return Response.json({
        error: "This employee already has an unresolved lifecycle transaction.",
        transactionId: unresolved[0].id,
        status: unresolved[0].status,
      }, { status: 409 });
    }

    const beforeSnapshot = await loadEmployeeLifecycleSnapshot(organizationId, employeeId);
    if (!beforeSnapshot) return Response.json({ error: "Employee state could not be loaded." }, { status: 409 });

    let targetPositionId: number | null = null;
    let targetManagerEmployeeId: number | null = null;
    let targetEmploymentType: string | null = null;
    const requestedChanges: Record<string, unknown> = { changeType, effectiveDate };

    if (lifecycleChangeNeedsPosition(changeType)) {
      targetPositionId = Number(body.targetPositionId);
      if (!Number.isInteger(targetPositionId)) {
        return Response.json({ error: "targetPositionId is required for this change." }, { status: 400 });
      }
      const positionCheck = await validateTargetPosition({
        userId: user.id,
        organizationId,
        employeeId,
        targetPositionId,
        currentPositionId: beforeSnapshot.positionId,
      });
      if (positionCheck.error) return positionCheck.error;
      requestedChanges.targetPositionId = targetPositionId;
      requestedChanges.targetPositionCode = positionCheck.position!.code;
      requestedChanges.targetOrgUnitId = positionCheck.position!.orgUnitId;
    }

    if (lifecycleChangeNeedsManager(changeType)) {
      if (!Object.prototype.hasOwnProperty.call(body, "targetManagerEmployeeId")) {
        return Response.json({
          error: "targetManagerEmployeeId is required for a manager change; use null to clear the manager.",
        }, { status: 400 });
      }
      targetManagerEmployeeId = body.targetManagerEmployeeId == null
        ? null
        : Number(body.targetManagerEmployeeId);
      if (targetManagerEmployeeId != null && !Number.isInteger(targetManagerEmployeeId)) {
        return Response.json({ error: "targetManagerEmployeeId must be an employee ID or null." }, { status: 400 });
      }
      const managerCheck = await validateTargetManager({
        userId: user.id,
        organizationId,
        employeeId,
        targetManagerEmployeeId,
      });
      if (managerCheck.error) return managerCheck.error;
      requestedChanges.targetManagerEmployeeId = targetManagerEmployeeId;
      requestedChanges.targetManagerName = managerCheck.manager
        ? `${managerCheck.manager.firstName} ${managerCheck.manager.lastName}`
        : null;
    }

    if (lifecycleChangeNeedsEmploymentType(changeType)) {
      targetEmploymentType = String(body.targetEmploymentType ?? "").trim().slice(0, 32);
      if (targetEmploymentType.length < 2) {
        return Response.json({ error: "targetEmploymentType is required." }, { status: 400 });
      }
      if (targetEmploymentType === employee.employmentType) {
        return Response.json({ error: "Target employment type is already active." }, { status: 409 });
      }
      requestedChanges.targetEmploymentType = targetEmploymentType;
    }

    const [created] = await db.insert(employeeLifecycleTransactions).values({
      organizationId,
      employeeId,
      changeType,
      effectiveDate,
      targetPositionId,
      targetManagerEmployeeId,
      targetEmploymentType,
      reason,
      status: "pending",
      beforeSnapshot,
      requestedChanges,
      requestedByUserId: user.id,
      requestedByName: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee lifecycle transaction requested",
      resource: `${employee.employeeNo} · ${changeType}`,
      metadata: {
        transactionId: created.id,
        employeeId,
        changeType,
        effectiveDate,
        beforeSnapshot,
        requestedChanges,
        reason,
      },
    });

    return Response.json({ transaction: created }, { status: 201 });
  }

  const transactionId = Number(body.transactionId);
  if (!Number.isInteger(transactionId)) {
    return Response.json({ error: "transactionId is required." }, { status: 400 });
  }

  const [transaction] = await db.select().from(employeeLifecycleTransactions).where(and(
    eq(employeeLifecycleTransactions.id, transactionId),
    eq(employeeLifecycleTransactions.organizationId, organizationId),
  )).limit(1);
  if (!transaction) return Response.json({ error: "Lifecycle transaction not found." }, { status: 404 });

  const employeeCheck = await scopedEmployee(user.id, organizationId, transaction.employeeId);
  if (employeeCheck.denied) return employeeCheck.denied;

  if (action === "approve") {
    const approvalDenied = await assertOrganizationRole(
      user.id,
      organizationId,
      APPROVAL_ADMIN_ROLES,
      "Only authorized People approvers can approve lifecycle changes.",
    );
    if (approvalDenied) return approvalDenied;
    if (transaction.status !== "pending") {
      return Response.json({ error: "Only pending lifecycle transactions can be approved." }, { status: 409 });
    }
    if (transaction.requestedByUserId === user.id) {
      return Response.json({
        error: "The requester cannot approve their own employee lifecycle transaction.",
      }, { status: 403 });
    }

    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 320) || null;
    const now = new Date();
    await db.update(employeeLifecycleTransactions).set({
      status: "scheduled",
      decidedByUserId: user.id,
      decidedByName: user.name,
      decidedAt: now,
      decisionNote,
      applyError: null,
      updatedAt: now,
    }).where(and(
      eq(employeeLifecycleTransactions.id, transactionId),
      eq(employeeLifecycleTransactions.status, "pending"),
    ));

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee lifecycle transaction approved",
      resource: `Employee #${transaction.employeeId} · ${transaction.changeType}`,
      metadata: {
        transactionId,
        employeeId: transaction.employeeId,
        changeType: transaction.changeType,
        effectiveDate: String(transaction.effectiveDate),
        independentApproval: true,
        decisionNote,
      },
    });

    if (String(transaction.effectiveDate) <= manilaToday()) {
      const applied = await applyEmployeeLifecycleTransaction(transactionId, user.name);
      if (!applied.applied) {
        return Response.json({
          error: "Lifecycle transaction was approved but could not be applied.",
          transactionId,
          application: applied,
        }, { status: 409 });
      }
      return Response.json({ transactionId, status: "applied", application: applied });
    }

    return Response.json({ transactionId, status: "scheduled", effectiveDate: transaction.effectiveDate });
  }

  if (action === "reject") {
    const approvalDenied = await assertOrganizationRole(user.id, organizationId, APPROVAL_ADMIN_ROLES);
    if (approvalDenied) return approvalDenied;
    if (transaction.status !== "pending") {
      return Response.json({ error: "Only pending lifecycle transactions can be rejected." }, { status: 409 });
    }
    if (transaction.requestedByUserId === user.id) {
      return Response.json({ error: "The requester cannot reject their own lifecycle transaction." }, { status: 403 });
    }
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 320);
    if (decisionNote.length < 4) {
      return Response.json({ error: "A rejection reason is required." }, { status: 400 });
    }

    const [updated] = await db.update(employeeLifecycleTransactions).set({
      status: "rejected",
      decidedByUserId: user.id,
      decidedByName: user.name,
      decidedAt: new Date(),
      decisionNote,
      updatedAt: new Date(),
    }).where(and(
      eq(employeeLifecycleTransactions.id, transactionId),
      eq(employeeLifecycleTransactions.status, "pending"),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee lifecycle transaction rejected",
      resource: `Employee #${transaction.employeeId} · ${transaction.changeType}`,
      metadata: { transactionId, decisionNote },
    });
    return Response.json({ transaction: updated });
  }

  if (action === "cancel") {
    if (!["pending", "scheduled", "failed"].includes(transaction.status)) {
      return Response.json({ error: "Applied or rejected lifecycle transactions cannot be cancelled." }, { status: 409 });
    }
    const decisionNote = String(body.decisionNote ?? "Cancelled before application").trim().slice(0, 320);
    const [updated] = await db.update(employeeLifecycleTransactions).set({
      status: "cancelled",
      decisionNote,
      decidedByUserId: transaction.decidedByUserId ?? user.id,
      decidedByName: transaction.decidedByName ?? user.name,
      decidedAt: transaction.decidedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(employeeLifecycleTransactions.id, transactionId),
      eq(employeeLifecycleTransactions.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee lifecycle transaction cancelled",
      resource: `Employee #${transaction.employeeId} · ${transaction.changeType}`,
      metadata: { transactionId, priorStatus: transaction.status, decisionNote },
    });
    return Response.json({ transaction: updated });
  }

  if (action === "retry") {
    const approvalDenied = await assertOrganizationRole(user.id, organizationId, APPROVAL_ADMIN_ROLES);
    if (approvalDenied) return approvalDenied;
    if (transaction.status !== "failed") {
      return Response.json({ error: "Only failed lifecycle transactions can be retried." }, { status: 409 });
    }
    if (transaction.requestedByUserId === user.id) {
      return Response.json({ error: "The requester cannot retry their own approved lifecycle transaction." }, { status: 403 });
    }

    await db.update(employeeLifecycleTransactions).set({
      status: "scheduled",
      applyError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(employeeLifecycleTransactions.id, transactionId),
      eq(employeeLifecycleTransactions.status, "failed"),
    ));

    const applied = await applyEmployeeLifecycleTransaction(transactionId, user.name);
    if (!applied.applied) {
      return Response.json({
        error: "Lifecycle transaction still could not be applied.",
        transactionId,
        application: applied,
      }, { status: 409 });
    }
    return Response.json({ transactionId, status: "applied", application: applied });
  }

  return Response.json({
    error: "Unsupported action. Use create, approve, reject, cancel, or retry.",
  }, { status: 400 });
}
