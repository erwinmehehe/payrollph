import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  performanceOneOnOneActionItemEvents,
  performanceOneOnOneActionItems,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function snapshot(row: typeof performanceOneOnOneActionItems.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    dueDate: row.dueDate,
    ownerKind: row.ownerKind,
    ownerEmployeeId: row.ownerEmployeeId,
    visibility: row.visibility,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByUserId: row.completedByUserId,
    completedByName: row.completedByName,
  };
}

async function selfContext() {
  const session = await getSessionUser();
  if (!session) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (session.role !== "employee" || !session.employeeId) {
    return { error: Response.json({ error: "This endpoint is for linked employee self-service accounts." }, { status: 403 }) };
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return { error: Response.json({ error: "Employee record not found." }, { status: 404 }) };

  const denied = await assertMembership(session.id, employee.organizationId);
  if (denied) return { error: denied };

  return { session, employee };
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await selfContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!Number.isInteger(id) || !["in_progress", "completed"].includes(status)) {
    return Response.json({ error: "A valid action item id and status in_progress or completed are required." }, { status: 400 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: context.session.id,
    action: "self-performance-action-item-status",
    resourceId: id,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [existing] = await db.select().from(performanceOneOnOneActionItems).where(and(
    eq(performanceOneOnOneActionItems.id, id),
    eq(performanceOneOnOneActionItems.organizationId, context.employee.organizationId),
    eq(performanceOneOnOneActionItems.employeeId, context.employee.id),
  )).limit(1);
  if (!existing) return Response.json({ error: "1:1 action item not found." }, { status: 404 });

  if (existing.visibility !== "employee_shared"
      || existing.ownerKind !== "employee"
      || existing.ownerEmployeeId !== context.employee.id) {
    return Response.json({
      error: "Employees can only update their own employee-visible 1:1 action items.",
    }, { status: 403 });
  }
  if (existing.status === "completed" || existing.status === "cancelled") {
    return Response.json({ error: "Closed action items can only be reopened by the manager or People administrator." }, { status: 409 });
  }

  const before = snapshot(existing);
  const completed = status === "completed";
  const [row] = await db.update(performanceOneOnOneActionItems).set({
    status,
    completedAt: completed ? new Date() : null,
    completedByUserId: completed ? context.session.id : null,
    completedByName: completed ? context.session.name : null,
    updatedAt: new Date(),
  }).where(eq(performanceOneOnOneActionItems.id, id)).returning();

  await db.insert(performanceOneOnOneActionItemEvents).values({
    organizationId: row.organizationId,
    actionItemId: row.id,
    oneOnOneId: row.oneOnOneId,
    employeeId: row.employeeId,
    eventType: "status_changed",
    actorUserId: context.session.id,
    actorName: context.session.name,
    beforeSnapshot: before,
    afterSnapshot: snapshot(row),
  });

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: context.session.name,
    action: completed ? "Employee completed 1:1 action item" : "Employee progressed 1:1 action item",
    resource: row.title,
    metadata: {
      actionItemId: row.id,
      oneOnOneId: row.oneOnOneId,
      employeeId: row.employeeId,
      fromStatus: existing.status,
      toStatus: row.status,
    },
  });

  return Response.json(row);
}
