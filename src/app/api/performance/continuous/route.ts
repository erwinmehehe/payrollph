import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  performanceFeedback,
  performanceGoals,
  performanceOneOnOnes,
  performanceReminderTasks,
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

function parseScheduledFor(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function continuousAccess(userId: number, organizationId: number): Promise<{ access: AccessScope } | { error: Response }> {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to access continuous performance management.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  return { access };
}

async function employeeInScope(
  userId: number,
  organizationId: number,
  employeeId: number,
): Promise<{ access: AccessScope; employee: typeof employees.$inferSelect } | { error: Response }> {
  const gate = await continuousAccess(userId, organizationId);
  if ("error" in gate) return gate;
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.id, employeeId),
  )).limit(1);
  if (!employee) return { error: Response.json({ error: "Employee not found in this workspace." }, { status: 404 }) };
  const scoped = assertScope(gate.access, employee.orgUnitId);
  if (!scoped.ok) return { error: Response.json({ error: scoped.error }, { status: scoped.status }) };
  return { access: gate.access, employee };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await continuousAccess(user.id, organizationId);
  if ("error" in gate) return gate.error;
  const companyPeopleAdmin = gate.access.companyWide && roleAllowed(gate.access.role, PEOPLE_ADMIN_ROLES);

  const [staff, meetings, feedback, reminders, goals] = await Promise.all([
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(performanceOneOnOnes)
      .where(eq(performanceOneOnOnes.organizationId, organizationId))
      .orderBy(desc(performanceOneOnOnes.scheduledFor), desc(performanceOneOnOnes.id)),
    db.select().from(performanceFeedback)
      .where(eq(performanceFeedback.organizationId, organizationId))
      .orderBy(desc(performanceFeedback.occurredAt), desc(performanceFeedback.id)),
    db.select().from(performanceReminderTasks)
      .where(eq(performanceReminderTasks.organizationId, organizationId))
      .orderBy(desc(performanceReminderTasks.updatedAt), desc(performanceReminderTasks.id)),
    db.select().from(performanceGoals)
      .where(eq(performanceGoals.organizationId, organizationId))
      .orderBy(desc(performanceGoals.id)),
  ]);

  const visibleEmployees = gate.access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === gate.access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));

  return Response.json({
    employees: visibleEmployees,
    oneOnOnes: meetings
      .filter((meeting) => visibleIds.has(meeting.employeeId))
      .map((meeting) => ({
        ...meeting,
        privateManagerNotes:
          companyPeopleAdmin || meeting.managerUserId === user.id
            ? meeting.privateManagerNotes
            : null,
      })),
    feedback: feedback.filter((item) =>
      visibleIds.has(item.employeeId)
      && (
        item.visibility === "employee_shared"
        || companyPeopleAdmin
        || item.authorUserId === user.id
      ),
    ),
    reminders: reminders.filter((task) =>
      visibleIds.has(task.employeeId)
      && (companyPeopleAdmin || task.ownerUserId === user.id),
    ),
    goals: goals.filter((goal) =>
      goal.scope === "company"
      || (goal.scope === "team" && goal.orgUnitId === gate.access.orgUnitId)
      || (goal.employeeId != null && visibleIds.has(goal.employeeId)),
    ),
    access: {
      ...gate.access,
      companyPeopleAdmin,
      userId: user.id,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  const employeeId = Number(body.employeeId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }

  const scoped = await employeeInScope(user.id, organizationId, employeeId);
  if ("error" in scoped) return scoped.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-continuous-" + entityType,
    resourceId: employeeId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (entityType === "one_on_one") {
    const scheduledFor = parseScheduledFor(body.scheduledFor);
    const agenda = String(body.agenda ?? "").trim().slice(0, 8000) || null;
    if (!scheduledFor) {
      return Response.json({ error: "A valid scheduledFor date/time is required." }, { status: 400 });
    }

    const [row] = await db.insert(performanceOneOnOnes).values({
      organizationId,
      employeeId,
      managerUserId: user.id,
      managerEmployeeId: user.employeeId ?? null,
      scheduledFor,
      status: "scheduled",
      agenda,
      createdByUserId: user.id,
      createdByName: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance 1:1 scheduled",
      resource: "Employee #" + employeeId,
      metadata: {
        oneOnOneId: row.id,
        employeeId,
        managerUserId: user.id,
        scheduledFor: scheduledFor.toISOString(),
      },
    });

    return Response.json(row, { status: 201 });
  }

  if (entityType === "feedback") {
    const feedbackType = String(body.feedbackType ?? "");
    const visibility = String(body.visibility ?? "employee_shared");
    const content = String(body.content ?? "").trim().slice(0, 8000);
    const goalId = body.goalId ? Number(body.goalId) : null;
    if (!["praise", "coaching", "development", "general"].includes(feedbackType)) {
      return Response.json({ error: "feedbackType must be praise, coaching, development, or general." }, { status: 400 });
    }
    if (!["employee_shared", "manager_private"].includes(visibility)) {
      return Response.json({ error: "visibility must be employee_shared or manager_private." }, { status: 400 });
    }
    if (content.length < 5) {
      return Response.json({ error: "Feedback must contain at least 5 characters." }, { status: 400 });
    }

    if (goalId) {
      const [goal] = await db.select().from(performanceGoals).where(and(
        eq(performanceGoals.organizationId, organizationId),
        eq(performanceGoals.id, goalId),
      )).limit(1);
      if (!goal) return Response.json({ error: "Linked goal not found in this workspace." }, { status: 404 });
      if (goal.scope === "employee" && goal.employeeId !== employeeId) {
        return Response.json({ error: "Employee feedback cannot be linked to another employee's goal." }, { status: 400 });
      }
      if (goal.scope === "team" && goal.orgUnitId !== scoped.employee.orgUnitId) {
        return Response.json({ error: "Feedback can only link to a team goal for the employee's org unit." }, { status: 400 });
      }
    }

    const [row] = await db.insert(performanceFeedback).values({
      organizationId,
      employeeId,
      goalId,
      authorUserId: user.id,
      authorEmployeeId: user.employeeId ?? null,
      authorName: user.name,
      feedbackType,
      visibility,
      content,
      occurredAt: new Date(),
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance feedback recorded",
      resource: "Employee #" + employeeId,
      metadata: {
        feedbackId: row.id,
        employeeId,
        goalId,
        feedbackType,
        visibility,
      },
    });

    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "entityType must be one_on_one or feedback." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const oneOnOneId = Number(body.oneOnOneId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId) || !Number.isInteger(oneOnOneId)
      || !["complete", "cancel", "reschedule"].includes(action)) {
    return Response.json({ error: "Valid organizationId, oneOnOneId and action are required." }, { status: 400 });
  }

  const gate = await continuousAccess(user.id, organizationId);
  if ("error" in gate) return gate.error;
  const [meeting] = await db.select().from(performanceOneOnOnes).where(and(
    eq(performanceOneOnOnes.organizationId, organizationId),
    eq(performanceOneOnOnes.id, oneOnOneId),
  )).limit(1);
  if (!meeting) return Response.json({ error: "1:1 record not found." }, { status: 404 });

  const employeeScope = await employeeInScope(user.id, organizationId, meeting.employeeId);
  if ("error" in employeeScope) return employeeScope.error;
  const companyPeopleAdmin = gate.access.companyWide && roleAllowed(gate.access.role, PEOPLE_ADMIN_ROLES);
  if (!companyPeopleAdmin && meeting.managerUserId !== user.id) {
    return Response.json({ error: "Only the assigned 1:1 manager or a company-wide People administrator can update this meeting." }, { status: 403 });
  }
  if (meeting.status !== "scheduled") {
    return Response.json({ error: "Completed or cancelled 1:1 records are locked." }, { status: 409 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-one-on-one-" + action,
    resourceId: oneOnOneId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "reschedule") {
    const scheduledFor = parseScheduledFor(body.scheduledFor);
    if (!scheduledFor) return Response.json({ error: "A valid scheduledFor date/time is required." }, { status: 400 });
    const [row] = await db.update(performanceOneOnOnes).set({
      scheduledFor,
      agenda: body.agenda === undefined ? meeting.agenda : String(body.agenda ?? "").trim().slice(0, 8000) || null,
      updatedAt: new Date(),
    }).where(eq(performanceOneOnOnes.id, oneOnOneId)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance 1:1 rescheduled",
      resource: "Employee #" + meeting.employeeId,
      metadata: { oneOnOneId, scheduledFor: scheduledFor.toISOString() },
    });
    return Response.json(row);
  }

  if (action === "cancel") {
    const [row] = await db.update(performanceOneOnOnes).set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(performanceOneOnOnes.id, oneOnOneId)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance 1:1 cancelled",
      resource: "Employee #" + meeting.employeeId,
      metadata: { oneOnOneId },
    });
    return Response.json(row);
  }

  const sharedSummary = String(body.sharedSummary ?? "").trim().slice(0, 8000);
  const privateManagerNotes = String(body.privateManagerNotes ?? "").trim().slice(0, 8000) || null;
  if (sharedSummary.length < 10) {
    return Response.json({ error: "A shared 1:1 summary of at least 10 characters is required to complete the meeting." }, { status: 400 });
  }

  const [row] = await db.update(performanceOneOnOnes).set({
    status: "completed",
    sharedSummary,
    privateManagerNotes,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(performanceOneOnOnes.id, oneOnOneId)).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Performance 1:1 completed",
    resource: "Employee #" + meeting.employeeId,
    metadata: {
      oneOnOneId,
      sharedSummaryLength: sharedSummary.length,
      privateManagerNotesRecorded: Boolean(privateManagerNotes),
    },
  });
  return Response.json(row);
}
