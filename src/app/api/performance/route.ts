import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  performanceCycles,
  performanceGoals,
  performanceReviews,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PERFORMANCE_ROLES = WORKFORCE_MANAGER_ROLES;

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function score(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n.toFixed(2) : null;
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return { error: Response.json({ error: "Employee not found in this workspace." }, { status: 404 }) };
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return { error: Response.json({ error: scope.error }, { status: scope.status }) };
  return { access, employee };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PERFORMANCE_ROLES,
    "Your role is not allowed to view performance management.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const staff = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
      status: employees.status,
    })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));

  const visibleEmployees = access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));

  const [cycles, goals, reviews] = await Promise.all([
    db.select().from(performanceCycles)
      .where(eq(performanceCycles.organizationId, organizationId))
      .orderBy(desc(performanceCycles.startDate)),
    db.select().from(performanceGoals)
      .where(eq(performanceGoals.organizationId, organizationId))
      .orderBy(desc(performanceGoals.id)),
    db.select().from(performanceReviews)
      .where(eq(performanceReviews.organizationId, organizationId))
      .orderBy(desc(performanceReviews.id)),
  ]);

  return Response.json({
    cycles,
    employees: visibleEmployees,
    goals: goals.filter((row) => visibleIds.has(row.employeeId)),
    reviews: reviews.filter((row) => visibleIds.has(row.employeeId)),
    access,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PERFORMANCE_ROLES,
    "Your role is not allowed to manage performance.",
  );
  if (denied) return denied;

  if (entityType === "cycle") {
    const peopleDenied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can create review cycles.",
    );
    if (peopleDenied) return peopleDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Performance cycles are organization-wide and require company-wide access." }, { status: 403 });
    }

    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    if (!name || !validIsoDate(startDate) || !validIsoDate(endDate) || endDate < startDate) {
      return Response.json({ error: "name and a valid start/end date range are required." }, { status: 400 });
    }

    const [row] = await db.insert(performanceCycles).values({
      organizationId,
      name: name.slice(0, 160),
      startDate,
      endDate,
      status: "active",
      createdByUserId: user.id,
      createdBy: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance cycle created",
      resource: row.name,
      metadata: { cycleId: row.id, startDate, endDate },
    });

    return Response.json(row, { status: 201 });
  }

  if (entityType === "goal") {
    const employeeId = Number(body.employeeId);
    const title = String(body.title ?? "").trim();
    const cycleId = body.cycleId ? Number(body.cycleId) : null;
    const weight = Number(body.weight ?? 0);
    const dueDate = body.dueDate ? String(body.dueDate) : null;

    if (!Number.isInteger(employeeId) || !title || !Number.isFinite(weight) || weight < 0 || weight > 100) {
      return Response.json({ error: "employeeId, title, and weight from 0 to 100 are required." }, { status: 400 });
    }
    if (dueDate && !validIsoDate(dueDate)) {
      return Response.json({ error: "dueDate must be YYYY-MM-DD." }, { status: 400 });
    }

    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;

    if (cycleId) {
      const [cycle] = await db.select({ id: performanceCycles.id })
        .from(performanceCycles)
        .where(and(eq(performanceCycles.id, cycleId), eq(performanceCycles.organizationId, organizationId)))
        .limit(1);
      if (!cycle) return Response.json({ error: "Performance cycle not found in this workspace." }, { status: 404 });
    }

    const [row] = await db.insert(performanceGoals).values({
      organizationId,
      employeeId,
      cycleId,
      title: title.slice(0, 180),
      description: body.description ? String(body.description).slice(0, 4000) : null,
      weight: weight.toFixed(2),
      progress: 0,
      status: "active",
      dueDate,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance goal created",
      resource: row.title,
      metadata: { goalId: row.id, employeeId, cycleId, weight },
    });

    return Response.json(row, { status: 201 });
  }

  if (entityType === "review") {
    const employeeId = Number(body.employeeId);
    const cycleId = Number(body.cycleId);
    if (!Number.isInteger(employeeId) || !Number.isInteger(cycleId)) {
      return Response.json({ error: "employeeId and cycleId are required." }, { status: 400 });
    }

    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;

    const [cycle] = await db.select().from(performanceCycles)
      .where(and(eq(performanceCycles.id, cycleId), eq(performanceCycles.organizationId, organizationId)))
      .limit(1);
    if (!cycle) return Response.json({ error: "Performance cycle not found in this workspace." }, { status: 404 });

    try {
      const [row] = await db.insert(performanceReviews).values({
        organizationId,
        employeeId,
        cycleId,
        reviewerUserId: user.id,
        status: "in_progress",
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Performance review opened",
        resource: `Employee #${employeeId}`,
        metadata: { reviewId: row.id, cycleId, employeeId },
      });

      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A review already exists for this employee in this cycle." }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be cycle, goal, or review." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const entityType = String(body.entityType ?? "");

  if (entityType === "goal") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Goal id is required." }, { status: 400 });
    const [existing] = await db.select().from(performanceGoals).where(eq(performanceGoals.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Goal not found." }, { status: 404 });

    const denied = await assertOrganizationRole(user.id, existing.organizationId, PERFORMANCE_ROLES);
    if (denied) return denied;
    const scoped = await scopedEmployee(user.id, existing.organizationId, existing.employeeId);
    if ("error" in scoped) return scoped.error;

    const progress = body.progress === undefined ? existing.progress : Number(body.progress);
    const status = body.status === undefined ? existing.status : String(body.status);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      return Response.json({ error: "progress must be an integer from 0 to 100." }, { status: 400 });
    }
    if (!["active", "completed", "cancelled"].includes(status)) {
      return Response.json({ error: "Invalid goal status." }, { status: 400 });
    }

    const [row] = await db.update(performanceGoals)
      .set({
        progress,
        status: progress === 100 && status === "active" ? "completed" : status,
        updatedAt: new Date(),
      })
      .where(eq(performanceGoals.id, id))
      .returning();

    await recordAuditEvent({
      organizationId: existing.organizationId,
      actor: user.name,
      action: "Performance goal updated",
      resource: existing.title,
      metadata: { goalId: id, progress: row.progress, status: row.status },
    });

    return Response.json(row);
  }

  if (entityType === "review") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Review id is required." }, { status: 400 });
    const [existing] = await db.select().from(performanceReviews).where(eq(performanceReviews.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Review not found." }, { status: 404 });

    const denied = await assertOrganizationRole(user.id, existing.organizationId, PERFORMANCE_ROLES);
    if (denied) return denied;
    const scoped = await scopedEmployee(user.id, existing.organizationId, existing.employeeId);
    if ("error" in scoped) return scoped.error;

    const managerScore = score(body.managerScore);
    const finalScore = score(body.finalScore ?? body.managerScore);
    if ((body.managerScore !== undefined && managerScore === null) || (body.finalScore !== undefined && finalScore === null)) {
      return Response.json({ error: "Review scores must be from 1.00 to 5.00." }, { status: 400 });
    }
    const status = String(body.status ?? "completed");
    if (!["in_progress", "completed"].includes(status)) {
      return Response.json({ error: "Review status must be in_progress or completed." }, { status: 400 });
    }

    const [row] = await db.update(performanceReviews)
      .set({
        managerScore,
        finalScore,
        managerSummary: body.managerSummary ? String(body.managerSummary).slice(0, 8000) : existing.managerSummary,
        status,
        completedAt: status === "completed" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(performanceReviews.id, id))
      .returning();

    await recordAuditEvent({
      organizationId: existing.organizationId,
      actor: user.name,
      action: status === "completed" ? "Performance review completed" : "Performance review updated",
      resource: `Employee #${existing.employeeId}`,
      metadata: { reviewId: id, cycleId: existing.cycleId, finalScore: row.finalScore },
    });

    return Response.json(row);
  }

  return Response.json({ error: "entityType must be goal or review." }, { status: 400 });
}
