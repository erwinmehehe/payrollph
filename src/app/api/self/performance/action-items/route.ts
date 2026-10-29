import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  employees,
  performanceOneOnOneActionItemEvents,
  performanceOneOnOneActionItems,
  userOrganizations,
  users,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
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

  // Re-check active employee identity and employer membership under a single
  // transaction. SHARE locks serialize with account/membership revocation.
  // Lock the action item before deciding whether it is still employee-owned.
  // A concurrent manager reassignment, privacy change or completion may never
  // turn a stale preflight lookup into an unscoped update or orphan audit.
  const result = await db.transaction(async (tx) => {
    const [principal] = await tx.select({ id: users.id }).from(users).where(and(
      eq(users.id, context.session.id),
      eq(users.employeeId, context.employee.id),
      eq(users.role, "employee"),
      eq(users.active, true),
    )).for("share").limit(1);
    const [membership] = await tx.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, context.session.id),
      eq(userOrganizations.organizationId, context.employee.organizationId),
      eq(userOrganizations.active, true),
    )).for("share").limit(1);
    const [worker] = await tx.select({ id: employees.id }).from(employees).where(and(
      eq(employees.id, context.employee.id),
      eq(employees.organizationId, context.employee.organizationId),
    )).for("share").limit(1);
    if (!principal || !membership || !worker) return { kind: "denied" } as const;

    const [existing] = await tx.select().from(performanceOneOnOneActionItems).where(and(
      eq(performanceOneOnOneActionItems.id, id),
      eq(performanceOneOnOneActionItems.organizationId, context.employee.organizationId),
      eq(performanceOneOnOneActionItems.employeeId, context.employee.id),
    )).for("update").limit(1);
    if (!existing) return { kind: "not_found" } as const;

    if (existing.visibility !== "employee_shared" ||
        existing.ownerKind !== "employee" ||
        existing.ownerEmployeeId !== context.employee.id) {
      return { kind: "forbidden" } as const;
    }
    if (existing.status !== "open" && existing.status !== "in_progress") {
      return { kind: "closed" } as const;
    }

    const before = snapshot(existing);
    const completed = status === "completed";
    const [row] = await tx.update(performanceOneOnOneActionItems).set({
      status,
      completedAt: completed ? new Date() : null,
      completedByUserId: completed ? context.session.id : null,
      completedByName: completed ? context.session.name : null,
      updatedAt: new Date(),
    }).where(and(
      eq(performanceOneOnOneActionItems.id, id),
      eq(performanceOneOnOneActionItems.organizationId, context.employee.organizationId),
      eq(performanceOneOnOneActionItems.employeeId, context.employee.id),
      eq(performanceOneOnOneActionItems.visibility, "employee_shared"),
      eq(performanceOneOnOneActionItems.ownerKind, "employee"),
      eq(performanceOneOnOneActionItems.ownerEmployeeId, context.employee.id),
      inArray(performanceOneOnOneActionItems.status, ["open", "in_progress"]),
    )).returning();
    if (!row) return { kind: "closed" } as const;

    await tx.insert(performanceOneOnOneActionItemEvents).values({
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
    // The status, event and audit must commit or roll back together.
    await tx.insert(auditEvents).values({
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
    return { kind: "ok", row } as const;
  });

  if (result.kind === "denied") {
    return Response.json({ error: "Employee identity or workspace membership changed. Sign in again." }, { status: 403 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "1:1 action item not found." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return Response.json({
      error: "Employees can only update their own employee-visible 1:1 action items.",
    }, { status: 403 });
  }
  if (result.kind === "closed") {
    return Response.json({ error: "Closed action items can only be reopened by the manager or People administrator." }, { status: 409 });
  }
  return Response.json(result.row);
}
