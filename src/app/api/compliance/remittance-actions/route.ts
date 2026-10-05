import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  getAccess,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { syncStatutoryRemittanceActions } from "@/lib/statutory-remittance-actions";
import {
  escalationStage,
  queueStatutoryComplianceEscalations,
} from "@/lib/statutory-remittance-escalations";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const SOURCE_TYPE = "statutory_remittance";

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  if (!access.companyWide) {
    return Response.json({
      error: "Statutory compliance actions are company-wide and are not available to unit-scoped users.",
    }, { status: 403 });
  }
  if (!roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only authorized payroll operators can manage statutory compliance actions.",
      role: access.role,
    }, { status: 403 });
  }
  return null;
}

async function listQueue(organizationId: number, currentUserId: number) {
  const tasks = await db.select().from(complianceActionTasks)
    .where(and(
      eq(complianceActionTasks.organizationId, organizationId),
      eq(complianceActionTasks.sourceType, SOURCE_TYPE),
    ))
    .orderBy(asc(complianceActionTasks.status), asc(complianceActionTasks.dueDate), desc(complianceActionTasks.updatedAt));

  const memberships = await db.select({
    userId: userOrganizations.userId,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
    name: users.name,
  })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, organizationId));

  const assignees = memberships
    .filter((membership) =>
      membership.orgUnitId == null
      && roleAllowed(membership.role, PAYROLL_OPERATOR_ROLES),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const now = new Date();
  return {
    currentUserId,
    tasks: tasks.map((task) => ({
      ...task,
      ageHours: Math.max(
        0,
        Math.floor((now.getTime() - new Date(task.firstDetectedAt).getTime()) / (60 * 60 * 1000)),
      ),
      escalationStage: escalationStage(task, now),
    })),
    assignees,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  return Response.json(await listQueue(organizationId, user.id));
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

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `compliance-action-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 60,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "sync") {
    const sync = await syncStatutoryRemittanceActions(organizationId, user.name);
    return Response.json({
      ...(await listQueue(organizationId, user.id)),
      sync,
    });
  }

  const taskId = Number(body.taskId);
  if (!Number.isInteger(taskId)) {
    return Response.json({ error: "taskId is required." }, { status: 400 });
  }

  const [task] = await db.select().from(complianceActionTasks)
    .where(and(
      eq(complianceActionTasks.id, taskId),
      eq(complianceActionTasks.organizationId, organizationId),
      eq(complianceActionTasks.sourceType, SOURCE_TYPE),
    ))
    .limit(1);
  if (!task) return Response.json({ error: "Compliance action not found." }, { status: 404 });
  if (task.status === "resolved") {
    return Response.json({
      error: "Resolved compliance actions are read-only. They reopen automatically only if the underlying issue returns.",
    }, { status: 409 });
  }

  if (action === "assign") {
    const assignedToUserId = body.assignedToUserId == null ? null : Number(body.assignedToUserId);
    let assignedToName: string | null = null;

    if (assignedToUserId != null) {
      if (!Number.isInteger(assignedToUserId)) {
        return Response.json({ error: "assignedToUserId must be a user ID or null." }, { status: 400 });
      }
      const [membership] = await db.select({
        userId: userOrganizations.userId,
        role: userOrganizations.role,
        orgUnitId: userOrganizations.orgUnitId,
        name: users.name,
      })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(and(
          eq(userOrganizations.organizationId, organizationId),
          eq(userOrganizations.userId, assignedToUserId),
        ))
        .limit(1);

      if (
        !membership
        || membership.orgUnitId != null
        || !roleAllowed(membership.role, PAYROLL_OPERATOR_ROLES)
      ) {
        return Response.json({
          error: "Compliance actions may only be assigned to an authorized payroll operator in this organization.",
        }, { status: 422 });
      }
      assignedToName = membership.name;
    }

    const ownershipChanged = assignedToUserId !== task.assignedToUserId;
    const [updated] = await db.update(complianceActionTasks).set({
      assignedToUserId,
      assignedToName,
      ...(ownershipChanged && task.status === "in_progress"
        ? {
            status: "open",
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            acknowledgedByName: null,
          }
        : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(complianceActionTasks.id, taskId),
      eq(complianceActionTasks.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: assignedToUserId == null
        ? "Statutory compliance action unassigned"
        : "Statutory compliance action assigned",
      resource: task.title,
      metadata: {
        taskId,
        sourceKey: task.sourceKey,
        assignedToUserId,
        assignedToName,
      },
    });

    let escalation: Awaited<ReturnType<typeof queueStatutoryComplianceEscalations>> = [];
    try {
      escalation = await queueStatutoryComplianceEscalations({
        organizationId,
        taskIds: [taskId],
        actor: user.name,
      });
    } catch {
      // Assignment remains authoritative even if the outbox is temporarily unavailable.
    }

    return Response.json({ task: updated, escalation });
  }

  if (action === "acknowledge") {
    if (task.assignedToUserId != null && task.assignedToUserId !== user.id) {
      return Response.json({
        error: `This compliance action is assigned to ${task.assignedToName ?? "another payroll operator"}. Reassign it before acknowledging.`,
      }, { status: 409 });
    }

    const now = new Date();
    const [updated] = await db.update(complianceActionTasks).set({
      status: "in_progress",
      acknowledgedAt: now,
      acknowledgedByUserId: user.id,
      acknowledgedByName: user.name,
      assignedToUserId: task.assignedToUserId ?? user.id,
      assignedToName: task.assignedToName ?? user.name,
      updatedAt: now,
    }).where(and(
      eq(complianceActionTasks.id, taskId),
      eq(complianceActionTasks.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory compliance action acknowledged",
      resource: task.title,
      metadata: {
        taskId,
        sourceKey: task.sourceKey,
        assignedToUserId: updated.assignedToUserId,
      },
    });
    return Response.json({ task: updated });
  }

  return Response.json({
    error: "Unsupported action. Use sync, assign, or acknowledge. Compliance actions resolve only from underlying evidence.",
  }, { status: 400 });
}
