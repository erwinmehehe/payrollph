import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { loadStatutoryRemittanceState } from "@/lib/statutory-remittance-state";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const SOURCE_TYPE = "statutory_remittance";

async function requirePayrollOperator(userId: number, organizationId: number) {
  return assertOrganizationRole(
    userId,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only authorized payroll operators can manage statutory compliance actions.",
  );
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
    name: users.name,
    email: users.email,
  })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, organizationId));

  const assignees = memberships
    .filter((membership) => roleAllowed(membership.role, PAYROLL_OPERATOR_ROLES))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    currentUserId,
    tasks,
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
    const state = await loadStatutoryRemittanceState(organizationId);
    if (!state) return Response.json({ error: "Organization not found." }, { status: 404 });

    const existing = await db.select().from(complianceActionTasks)
      .where(and(
        eq(complianceActionTasks.organizationId, organizationId),
        eq(complianceActionTasks.sourceType, SOURCE_TYPE),
      ));

    const existingByKey = new Map(existing.map((task) => [task.sourceKey, task]));
    const activeKeys = new Set(state.alerts.map((alert) => alert.id));
    const now = new Date();
    let created = 0;
    let reopened = 0;
    let resolved = 0;

    await db.transaction(async (tx) => {
      for (const alert of state.alerts) {
        const current = existingByKey.get(alert.id);
        if (!current) {
          await tx.insert(complianceActionTasks).values({
            organizationId,
            sourceType: SOURCE_TYPE,
            sourceKey: alert.id,
            agency: alert.agency,
            applicableMonth: alert.applicableMonth,
            severity: alert.tone,
            title: alert.title,
            detail: alert.detail,
            dueDate: alert.dueDate,
            status: "open",
            firstDetectedAt: now,
            lastDetectedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          created += 1;
          continue;
        }

        const wasResolved = current.status === "resolved";
        await tx.update(complianceActionTasks).set({
          agency: alert.agency,
          applicableMonth: alert.applicableMonth,
          severity: alert.tone,
          title: alert.title,
          detail: alert.detail,
          dueDate: alert.dueDate,
          status: wasResolved ? "open" : current.status,
          acknowledgedAt: wasResolved ? null : current.acknowledgedAt,
          acknowledgedByUserId: wasResolved ? null : current.acknowledgedByUserId,
          acknowledgedByName: wasResolved ? null : current.acknowledgedByName,
          resolvedAt: wasResolved ? null : current.resolvedAt,
          lastDetectedAt: now,
          updatedAt: now,
        }).where(and(
          eq(complianceActionTasks.id, current.id),
          eq(complianceActionTasks.organizationId, organizationId),
        ));
        if (wasResolved) reopened += 1;
      }

      for (const task of existing) {
        if (task.status === "resolved" || activeKeys.has(task.sourceKey)) continue;
        await tx.update(complianceActionTasks).set({
          status: "resolved",
          resolvedAt: now,
          updatedAt: now,
        }).where(and(
          eq(complianceActionTasks.id, task.id),
          eq(complianceActionTasks.organizationId, organizationId),
        ));
        resolved += 1;
      }
    });

    if (created || reopened || resolved) {
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Statutory compliance action queue synchronized",
        resource: "SSS · PhilHealth · Pag-IBIG",
        metadata: {
          created,
          reopened,
          resolved,
          activeAlerts: state.alerts.length,
        },
      });
    }

    return Response.json({
      ...(await listQueue(organizationId, user.id)),
      sync: { created, reopened, resolved, activeAlerts: state.alerts.length },
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
        name: users.name,
      })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(and(
          eq(userOrganizations.organizationId, organizationId),
          eq(userOrganizations.userId, assignedToUserId),
        ))
        .limit(1);

      if (!membership || !roleAllowed(membership.role, PAYROLL_OPERATOR_ROLES)) {
        return Response.json({
          error: "Compliance actions may only be assigned to an authorized payroll operator in this organization.",
        }, { status: 422 });
      }
      assignedToName = membership.name;
    }

    const [updated] = await db.update(complianceActionTasks).set({
      assignedToUserId,
      assignedToName,
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
    return Response.json({ task: updated });
  }

  if (action === "acknowledge") {
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
