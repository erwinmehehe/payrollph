import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmLifecycleNotificationEvents,
  hcmLifecycleNotificationTasks,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  roleAllowed,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { listLifecycleOwnerCandidates } from "@/lib/hcm-lifecycle-notifications";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function lifecycleAccess(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to access employment lifecycle notifications.",
  );
  if (denied) return { error: denied };

  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "No workspace access." }, { status: 403 }) };
  return { access };
}

async function writeTaskEvent(input: {
  task: typeof hcmLifecycleNotificationTasks.$inferSelect;
  eventType: string;
  actorUserId: number;
  actorName: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(hcmLifecycleNotificationEvents).values({
    organizationId: input.task.organizationId,
    taskId: input.task.id,
    employeeId: input.task.employeeId,
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    metadata: input.metadata ?? {},
  });
  await recordAuditEvent({
    organizationId: input.task.organizationId,
    actor: input.actorName,
    action: `HCM lifecycle notification ${input.eventType}`,
    resource: `Lifecycle task #${input.task.id}`,
    metadata: {
      lifecycleTaskId: input.task.id,
      employeeId: input.task.employeeId,
      stage: input.task.stage,
      ...(input.metadata ?? {}),
    },
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const includeResolved = url.searchParams.get("includeResolved") === "1";
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  }

  const gate = await lifecycleAccess(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const companyPeopleAdmin = gate.access.companyWide && roleAllowed(gate.access.role, PEOPLE_ADMIN_ROLES);
  const rows = await db.select({
    task: hcmLifecycleNotificationTasks,
    employeeNo: employees.employeeNo,
    employeeFirstName: employees.firstName,
    employeeLastName: employees.lastName,
  })
    .from(hcmLifecycleNotificationTasks)
    .innerJoin(employees, eq(hcmLifecycleNotificationTasks.employeeId, employees.id))
    .where(
      companyPeopleAdmin
        ? eq(hcmLifecycleNotificationTasks.organizationId, organizationId)
        : and(
            eq(hcmLifecycleNotificationTasks.organizationId, organizationId),
            eq(hcmLifecycleNotificationTasks.ownerUserId, user.id),
          ),
    )
    .orderBy(desc(hcmLifecycleNotificationTasks.updatedAt), desc(hcmLifecycleNotificationTasks.id));

  const visible = includeResolved ? rows : rows.filter((row) => row.task.status !== "resolved");
  const owners = companyPeopleAdmin
    ? await listLifecycleOwnerCandidates(organizationId)
    : [];

  return Response.json({
    tasks: visible.map((row) => ({
      ...row.task,
      employeeNo: row.employeeNo,
      employeeName: `${row.employeeFirstName} ${row.employeeLastName}`,
    })),
    owners,
    canAssign: companyPeopleAdmin,
  });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const taskId = Number(body.taskId);
  const action = String(body.action ?? "").trim().toLowerCase();
  if (!Number.isInteger(organizationId) || !Number.isInteger(taskId)
      || !["assign", "acknowledge", "dismiss", "snooze"].includes(action)) {
    return Response.json({ error: "Valid organizationId, taskId, and supported action are required." }, { status: 400 });
  }

  const gate = await lifecycleAccess(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `hcm-lifecycle-notification-${action}`,
    resourceId: taskId,
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [task] = await db.select().from(hcmLifecycleNotificationTasks).where(and(
    eq(hcmLifecycleNotificationTasks.id, taskId),
    eq(hcmLifecycleNotificationTasks.organizationId, organizationId),
  )).limit(1);
  if (!task) return Response.json({ error: "Lifecycle notification task not found." }, { status: 404 });
  if (task.status === "resolved") {
    return Response.json({ error: "Resolved lifecycle tasks cannot be manually changed." }, { status: 409 });
  }

  const companyPeopleAdmin = gate.access.companyWide && roleAllowed(gate.access.role, PEOPLE_ADMIN_ROLES);
  const isOwner = task.ownerUserId === user.id;
  if (!companyPeopleAdmin && !isOwner) {
    return Response.json({ error: "Only the assigned owner or a company-wide People administrator can update this task." }, { status: 403 });
  }

  if (action === "assign") {
    if (!companyPeopleAdmin) {
      return Response.json({ error: "Only company-wide People administrators can assign lifecycle ownership." }, { status: 403 });
    }
    const ownerUserId = Number(body.ownerUserId);
    if (!Number.isInteger(ownerUserId)) {
      return Response.json({ error: "A valid ownerUserId is required." }, { status: 400 });
    }
    const [owner] = await db.select({
      userId: users.id,
      name: users.name,
      role: userOrganizations.role,
      active: userOrganizations.active,
      userActive: users.active,
    })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.userId, ownerUserId),
        eq(userOrganizations.active, true),
        eq(users.active, true),
      ))
      .limit(1);
    if (!owner || !roleAllowed(owner.role, WORKFORCE_MANAGER_ROLES)) {
      return Response.json({ error: "The selected owner must be an active People administrator or manager in this workspace." }, { status: 400 });
    }

    const [updated] = await db.update(hcmLifecycleNotificationTasks).set({
      ownerUserId: owner.userId,
      ownerName: owner.name,
      notificationEpisode: task.notificationEpisode + 1,
      updatedAt: new Date(),
    }).where(eq(hcmLifecycleNotificationTasks.id, task.id)).returning();

    await writeTaskEvent({
      task: updated,
      eventType: "assigned",
      actorUserId: user.id,
      actorName: user.name,
      metadata: {
        previousOwnerUserId: task.ownerUserId,
        ownerUserId: owner.userId,
        ownerName: owner.name,
      },
    });
    return Response.json({ task: updated });
  }

  if (action === "snooze") {
    const days = Number(body.days);
    if (![1, 3, 7].includes(days)) {
      return Response.json({ error: "Snooze must be 1, 3, or 7 days." }, { status: 400 });
    }
    const snoozeUntil = new Date(Date.now() + days * 86_400_000);
    const [updated] = await db.update(hcmLifecycleNotificationTasks).set({
      status: "snoozed",
      snoozeUntil,
      updatedAt: new Date(),
    }).where(eq(hcmLifecycleNotificationTasks.id, task.id)).returning();
    await writeTaskEvent({
      task: updated,
      eventType: "snoozed",
      actorUserId: user.id,
      actorName: user.name,
      metadata: { days, snoozeUntil: snoozeUntil.toISOString() },
    });
    return Response.json({ task: updated });
  }

  const eventType = action === "dismiss" ? "dismissed" : "acknowledged";
  const [updated] = await db.update(hcmLifecycleNotificationTasks).set({
    status: "acknowledged",
    acknowledgedAt: new Date(),
    acknowledgedByUserId: user.id,
    acknowledgedByName: user.name,
    snoozeUntil: null,
    updatedAt: new Date(),
  }).where(eq(hcmLifecycleNotificationTasks.id, task.id)).returning();
  await writeTaskEvent({
    task: updated,
    eventType,
    actorUserId: user.id,
    actorName: user.name,
    metadata: {
      note: String(body.note ?? "").trim().slice(0, 240) || null,
    },
  });
  return Response.json({ task: updated });
}
