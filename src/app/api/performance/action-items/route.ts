import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  performanceOneOnOneActionItemEvents,
  performanceOneOnOneActionItems,
  performanceOneOnOnes,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  type AccessScope,
  PEOPLE_ADMIN_ROLES,
  roleAllowed,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

type ActionItem = typeof performanceOneOnOneActionItems.$inferSelect;

function validDueDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(raw + "T00:00:00Z");
  return Number.isFinite(parsed) ? raw : null;
}

function actionItemSnapshot(row: ActionItem) {
  return {
    id: row.id,
    ownerKind: row.ownerKind,
    ownerUserId: row.ownerUserId,
    ownerEmployeeId: row.ownerEmployeeId,
    ownerName: row.ownerName,
    title: row.title,
    detail: row.detail,
    dueDate: row.dueDate,
    visibility: row.visibility,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByUserId: row.completedByUserId,
    completedByName: row.completedByName,
  };
}

async function managerAccess(
  userId: number,
  organizationId: number,
): Promise<{ access: AccessScope } | { error: Response }> {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to manage 1:1 action items.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  }
  return { access };
}

async function meetingGate(
  userId: number,
  organizationId: number,
  oneOnOneId: number,
) {
  const gate = await managerAccess(userId, organizationId);
  if ("error" in gate) return gate;

  const [meeting] = await db.select().from(performanceOneOnOnes).where(and(
    eq(performanceOneOnOnes.id, oneOnOneId),
    eq(performanceOneOnOnes.organizationId, organizationId),
  )).limit(1);
  if (!meeting) {
    return { error: Response.json({ error: "1:1 record not found in this workspace." }, { status: 404 }) };
  }

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, meeting.employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return { error: Response.json({ error: "Employee not found in this workspace." }, { status: 404 }) };
  }

  const scoped = assertScope(gate.access, employee.orgUnitId);
  if (!scoped.ok) {
    return { error: Response.json({ error: scoped.error }, { status: scoped.status }) };
  }

  const companyPeopleAdmin = gate.access.companyWide && roleAllowed(gate.access.role, PEOPLE_ADMIN_ROLES);
  if (!companyPeopleAdmin && meeting.managerUserId !== userId) {
    return {
      error: Response.json({
        error: "Only the assigned 1:1 manager or a company-wide People administrator can manage these action items.",
      }, { status: 403 }),
    };
  }

  return { access: gate.access, companyPeopleAdmin, meeting, employee };
}

async function ownerFor(
  organizationId: number,
  meeting: typeof performanceOneOnOnes.$inferSelect,
  employee: typeof employees.$inferSelect,
  ownerKind: string,
) {
  if (ownerKind === "employee") {
    return {
      ownerKind: "employee" as const,
      ownerUserId: null,
      ownerEmployeeId: employee.id,
      ownerName: employee.firstName + " " + employee.lastName,
    };
  }
  if (ownerKind === "manager") {
    const [manager] = await db.select({
      id: users.id,
      name: users.name,
    }).from(users).where(eq(users.id, meeting.managerUserId)).limit(1);
    if (!manager) return null;
    return {
      ownerKind: "manager" as const,
      ownerUserId: manager.id,
      ownerEmployeeId: meeting.managerEmployeeId,
      ownerName: manager.name,
    };
  }
  return null;
}

async function event(
  row: ActionItem,
  eventType: string,
  actorUserId: number,
  actorName: string,
  note: string | null,
  beforeSnapshot: Record<string, unknown> | null,
  afterSnapshot: Record<string, unknown> | null,
) {
  await db.insert(performanceOneOnOneActionItemEvents).values({
    organizationId: row.organizationId,
    actionItemId: row.id,
    oneOnOneId: row.oneOnOneId,
    employeeId: row.employeeId,
    eventType,
    actorUserId,
    actorName,
    note,
    beforeSnapshot,
    afterSnapshot,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const oneOnOneId = Number(body.oneOnOneId);
  const ownerKind = String(body.ownerKind ?? "employee");
  const title = String(body.title ?? "").trim().slice(0, 220);
  const detail = String(body.detail ?? "").trim().slice(0, 8000) || null;
  const dueDate = validDueDate(body.dueDate);
  const visibility = String(body.visibility ?? "employee_shared");

  if (!Number.isInteger(organizationId) || !Number.isInteger(oneOnOneId)) {
    return Response.json({ error: "organizationId and oneOnOneId are required." }, { status: 400 });
  }
  if (title.length < 3 || !dueDate) {
    return Response.json({ error: "Action item title and a valid due date are required." }, { status: 400 });
  }
  if (!["employee", "manager"].includes(ownerKind)) {
    return Response.json({ error: "ownerKind must be employee or manager." }, { status: 400 });
  }
  if (!["employee_shared", "manager_private"].includes(visibility)) {
    return Response.json({ error: "visibility must be employee_shared or manager_private." }, { status: 400 });
  }
  if (ownerKind === "employee" && visibility !== "employee_shared") {
    return Response.json({ error: "Employee-owned action items must be visible to the employee." }, { status: 400 });
  }

  const gate = await meetingGate(user.id, organizationId, oneOnOneId);
  if ("error" in gate) return gate.error;
  if (gate.meeting.status === "cancelled") {
    return Response.json({ error: "Cancelled 1:1s cannot receive new action items." }, { status: 409 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-one-on-one-action-create",
    resourceId: oneOnOneId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const owner = await ownerFor(organizationId, gate.meeting, gate.employee, ownerKind);
  if (!owner) return Response.json({ error: "Action item owner could not be resolved." }, { status: 409 });

  const [row] = await db.insert(performanceOneOnOneActionItems).values({
    organizationId,
    oneOnOneId,
    employeeId: gate.employee.id,
    ...owner,
    title,
    detail,
    dueDate,
    visibility,
    status: "open",
    createdByUserId: user.id,
    createdByName: user.name,
  }).returning();

  await event(row, "created", user.id, user.name, null, null, actionItemSnapshot(row));
  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Performance 1:1 action item created",
    resource: title,
    metadata: {
      actionItemId: row.id,
      oneOnOneId,
      employeeId: row.employeeId,
      ownerKind: row.ownerKind,
      dueDate,
      visibility,
    },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const id = Number(body.id);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId) || !Number.isInteger(id)) {
    return Response.json({ error: "organizationId and action item id are required." }, { status: 400 });
  }

  const [existing] = await db.select().from(performanceOneOnOneActionItems).where(and(
    eq(performanceOneOnOneActionItems.id, id),
    eq(performanceOneOnOneActionItems.organizationId, organizationId),
  )).limit(1);
  if (!existing) return Response.json({ error: "1:1 action item not found." }, { status: 404 });

  const gate = await meetingGate(user.id, organizationId, existing.oneOnOneId);
  if ("error" in gate) return gate.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-one-on-one-action-" + action,
    resourceId: id,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const before = actionItemSnapshot(existing);

  if (action === "update") {
    if (existing.status === "completed" || existing.status === "cancelled") {
      return Response.json({ error: "Closed action items must be reopened before editing." }, { status: 409 });
    }

    const title = String(body.title ?? existing.title).trim().slice(0, 220);
    const detail = body.detail === undefined
      ? existing.detail
      : String(body.detail ?? "").trim().slice(0, 8000) || null;
    const dueDate = body.dueDate === undefined ? existing.dueDate : validDueDate(body.dueDate);
    const ownerKind = String(body.ownerKind ?? existing.ownerKind);
    const visibility = String(body.visibility ?? existing.visibility);
    if (title.length < 3 || !dueDate) {
      return Response.json({ error: "Action item title and a valid due date are required." }, { status: 400 });
    }
    if (!["employee", "manager"].includes(ownerKind)
        || !["employee_shared", "manager_private"].includes(visibility)) {
      return Response.json({ error: "Invalid owner or visibility." }, { status: 400 });
    }
    if (ownerKind === "employee" && visibility !== "employee_shared") {
      return Response.json({ error: "Employee-owned action items must be visible to the employee." }, { status: 400 });
    }

    const owner = await ownerFor(organizationId, gate.meeting, gate.employee, ownerKind);
    if (!owner) return Response.json({ error: "Action item owner could not be resolved." }, { status: 409 });

    const [row] = await db.update(performanceOneOnOneActionItems).set({
      ...owner,
      title,
      detail,
      dueDate,
      visibility,
      updatedAt: new Date(),
    }).where(eq(performanceOneOnOneActionItems.id, id)).returning();

    const after = actionItemSnapshot(row);
    const eventType =
      before.ownerKind !== after.ownerKind ? "reassigned"
        : before.dueDate !== after.dueDate ? "due_date_changed"
          : before.visibility !== after.visibility ? "visibility_changed"
            : "updated";
    await event(row, eventType, user.id, user.name, null, before, after);
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance 1:1 action item updated",
      resource: row.title,
      metadata: { actionItemId: id, oneOnOneId: row.oneOnOneId, eventType },
    });
    return Response.json(row);
  }

  if (action === "status") {
    const status = String(body.status ?? "");
    if (!["open", "in_progress", "completed"].includes(status)) {
      return Response.json({ error: "status must be open, in_progress, or completed." }, { status: 400 });
    }
    if (existing.status === "completed" || existing.status === "cancelled") {
      return Response.json({ error: "Closed action items must be reopened before changing status." }, { status: 409 });
    }

    const completed = status === "completed";
    const [row] = await db.update(performanceOneOnOneActionItems).set({
      status,
      completedAt: completed ? new Date() : null,
      completedByUserId: completed ? user.id : null,
      completedByName: completed ? user.name : null,
      updatedAt: new Date(),
    }).where(eq(performanceOneOnOneActionItems.id, id)).returning();
    const after = actionItemSnapshot(row);
    await event(row, "status_changed", user.id, user.name, null, before, after);
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: completed ? "Performance 1:1 action item completed" : "Performance 1:1 action item status changed",
      resource: row.title,
      metadata: { actionItemId: id, fromStatus: existing.status, toStatus: row.status },
    });
    return Response.json(row);
  }

  if (action === "cancel") {
    if (existing.status === "cancelled") {
      return Response.json({ error: "Action item is already cancelled." }, { status: 409 });
    }
    const note = String(body.note ?? "").trim().slice(0, 4000);
    if (note.length < 10) {
      return Response.json({ error: "A cancellation reason of at least 10 characters is required." }, { status: 400 });
    }
    const [row] = await db.update(performanceOneOnOneActionItems).set({
      status: "cancelled",
      completedAt: null,
      completedByUserId: null,
      completedByName: null,
      updatedAt: new Date(),
    }).where(eq(performanceOneOnOneActionItems.id, id)).returning();
    const after = actionItemSnapshot(row);
    await event(row, "cancelled", user.id, user.name, note, before, after);
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance 1:1 action item cancelled",
      resource: row.title,
      metadata: { actionItemId: id, note },
    });
    return Response.json(row);
  }

  if (action === "reopen") {
    if (!["completed", "cancelled"].includes(existing.status)) {
      return Response.json({ error: "Only completed or cancelled action items can be reopened." }, { status: 409 });
    }
    const note = String(body.note ?? "").trim().slice(0, 4000);
    if (note.length < 10) {
      return Response.json({ error: "A reopening reason of at least 10 characters is required." }, { status: 400 });
    }
    const [row] = await db.update(performanceOneOnOneActionItems).set({
      status: "open",
      completedAt: null,
      completedByUserId: null,
      completedByName: null,
      updatedAt: new Date(),
    }).where(eq(performanceOneOnOneActionItems.id, id)).returning();
    const after = actionItemSnapshot(row);
    await event(row, "reopened", user.id, user.name, note, before, after);
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance 1:1 action item reopened",
      resource: row.title,
      metadata: { actionItemId: id, note },
    });
    return Response.json(row);
  }

  return Response.json({ error: "action must be update, status, cancel, or reopen." }, { status: 400 });
}
