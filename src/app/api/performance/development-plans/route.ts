import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmSkills,
  performanceCycles,
  performanceReviewItems,
  performanceReviews,
  performanceSkillDevelopmentMilestones,
  performanceSkillDevelopmentPlanEvents,
  performanceSkillDevelopmentPlans,
  performanceSkillDevelopmentProgress,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
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

type Plan = typeof performanceSkillDevelopmentPlans.$inferSelect;

function proficiency(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n * 100) / 100 : null;
}

function dateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw + "T00:00:00Z"))
    ? raw
    : null;
}

function planSnapshot(row: Plan) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    skillId: row.skillId,
    sourceCycleId: row.sourceCycleId,
    sourceReviewItemId: row.sourceReviewItemId,
    title: row.title,
    objective: row.objective,
    currentProficiency: row.currentProficiency,
    targetProficiency: row.targetProficiency,
    status: row.status,
    targetDate: row.targetDate,
    managerUserId: row.managerUserId,
    employeeVisible: row.employeeVisible,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

async function event(
  row: Plan,
  eventType: string,
  actorUserId: number,
  actorName: string,
  note: string | null,
  beforeSnapshot: Record<string, unknown> | null,
  afterSnapshot: Record<string, unknown> | null,
) {
  await db.insert(performanceSkillDevelopmentPlanEvents).values({
    organizationId: row.organizationId,
    planId: row.id,
    eventType,
    actorUserId,
    actorName,
    note,
    beforeSnapshot,
    afterSnapshot,
  });
}

async function managerGate(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to manage skill development plans.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  }
  return { access, companyPeopleAdmin: access.companyWide && roleAllowed(access.role, PEOPLE_ADMIN_ROLES) };
}

async function persistentGapEvidence(
  organizationId: number,
  employeeId: number,
  skillId: number,
) {
  const [cycles, reviews, items] = await Promise.all([
    db.select().from(performanceCycles).where(and(
      eq(performanceCycles.organizationId, organizationId),
      eq(performanceCycles.status, "completed"),
    )).orderBy(asc(performanceCycles.endDate)),
    db.select().from(performanceReviews).where(and(
      eq(performanceReviews.organizationId, organizationId),
      eq(performanceReviews.employeeId, employeeId),
      eq(performanceReviews.status, "completed"),
    )),
    db.select().from(performanceReviewItems).where(and(
      eq(performanceReviewItems.organizationId, organizationId),
      eq(performanceReviewItems.skillId, skillId),
    )),
  ]);

  const reviewById = new Map(reviews.map((review) => [review.id, review]));
  const points = cycles.flatMap((cycle) => {
    const cycleReviewIds = new Set(
      reviews.filter((review) => review.cycleId === cycle.id).map((review) => review.id),
    );
    const cycleItems = items.filter((item) =>
      cycleReviewIds.has(item.reviewId)
      && item.finalScore != null
      && item.expectedProficiency != null
    );
    if (!cycleItems.length) return [];
    const average = (values: number[]) =>
      Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
    const finalScores = cycleItems.map((item) => Number(item.finalScore));
    const expected = cycleItems.map((item) => Number(item.expectedProficiency));
    return [{
      cycleId: cycle.id,
      cycleName: cycle.name,
      endDate: cycle.endDate,
      averageFinalScore: average(finalScores),
      averageExpectedProficiency: average(expected),
      reviewItemIds: cycleItems.map((item) => item.id),
      reviewIds: [...new Set(cycleItems.map((item) => reviewById.get(item.reviewId)?.id).filter((id): id is number => id != null))],
    }];
  });

  let consecutiveGapCycles = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.averageFinalScore >= point.averageExpectedProficiency) break;
    consecutiveGapCycles += 1;
  }

  const latest = points.at(-1) ?? null;
  return {
    persistentGap: consecutiveGapCycles >= 2,
    consecutiveGapCycles,
    points,
    latest,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await managerGate(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const [staff, plans, skills] = await Promise.all([
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(performanceSkillDevelopmentPlans)
      .where(eq(performanceSkillDevelopmentPlans.organizationId, organizationId))
      .orderBy(desc(performanceSkillDevelopmentPlans.updatedAt)),
    db.select().from(hcmSkills)
      .where(eq(hcmSkills.organizationId, organizationId))
      .orderBy(asc(hcmSkills.category), asc(hcmSkills.name)),
  ]);

  const visibleStaff = staff.filter((employee) => assertScope(gate.access, employee.orgUnitId).ok);
  const visibleEmployeeIds = new Set(visibleStaff.map((employee) => employee.id));
  const visiblePlans = plans.filter((plan) => visibleEmployeeIds.has(plan.employeeId));
  const planIds = visiblePlans.map((plan) => plan.id);
  const [milestones, progress] = await Promise.all([
    planIds.length
      ? db.select().from(performanceSkillDevelopmentMilestones).where(inArray(performanceSkillDevelopmentMilestones.planId, planIds))
      : Promise.resolve([]),
    planIds.length
      ? db.select().from(performanceSkillDevelopmentProgress).where(inArray(performanceSkillDevelopmentProgress.planId, planIds))
      : Promise.resolve([]),
  ]);

  return Response.json({
    employees: visibleStaff,
    skills,
    plans: visiblePlans.map((plan) => ({
      ...plan,
      milestones: milestones
        .filter((item) => item.planId === plan.id)
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
      progress: progress
        .filter((item) => item.planId === plan.id)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "plan");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await managerGate(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-development-" + entityType,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (entityType === "plan") {
    const employeeId = Number(body.employeeId);
    const skillId = Number(body.skillId);
    const title = String(body.title ?? "").trim().slice(0, 220);
    const objective = String(body.objective ?? "").trim().slice(0, 8000);
    const targetDate = dateOnly(body.targetDate);
    const targetProficiency = proficiency(body.targetProficiency);
    if (!Number.isInteger(employeeId) || !Number.isInteger(skillId)
        || title.length < 3 || objective.length < 10 || !targetDate || targetProficiency == null) {
      return Response.json({
        error: "employeeId, skillId, title, objective, targetDate, and targetProficiency from 1 to 5 are required.",
      }, { status: 400 });
    }

    const [[employee], [skill]] = await Promise.all([
      db.select().from(employees).where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
      db.select().from(hcmSkills).where(and(
        eq(hcmSkills.id, skillId),
        eq(hcmSkills.organizationId, organizationId),
        eq(hcmSkills.active, true),
      )).limit(1),
    ]);
    if (!employee || !skill) {
      return Response.json({ error: "Employee or active skill not found in this workspace." }, { status: 404 });
    }
    const scoped = assertScope(gate.access, employee.orgUnitId);
    if (!scoped.ok) return Response.json({ error: scoped.error }, { status: scoped.status });

    const evidence = await persistentGapEvidence(organizationId, employeeId, skillId);
    if (!evidence.persistentGap || !evidence.latest) {
      return Response.json({
        error: "A development plan requires a verified persistent skill gap across at least two consecutive completed cycles.",
        evidence,
      }, { status: 409 });
    }
    if (targetProficiency < evidence.latest.averageExpectedProficiency) {
      return Response.json({
        error: "Target proficiency cannot be below the latest frozen role expectation.",
        expectedProficiency: evidence.latest.averageExpectedProficiency,
      }, { status: 400 });
    }

    try {
      const [row] = await db.insert(performanceSkillDevelopmentPlans).values({
        organizationId,
        employeeId,
        skillId,
        sourceCycleId: evidence.latest.cycleId,
        sourceReviewItemId: evidence.latest.reviewItemIds.at(-1) ?? null,
        sourceSnapshot: {
          trigger: "persistent_competency_gap",
          consecutiveGapCycles: evidence.consecutiveGapCycles,
          points: evidence.points,
        },
        title,
        objective,
        currentProficiency: evidence.latest.averageFinalScore.toFixed(2),
        targetProficiency: targetProficiency.toFixed(2),
        status: "planned",
        targetDate,
        managerUserId: user.id,
        employeeVisible: body.employeeVisible !== false,
        createdByUserId: user.id,
        createdByName: user.name,
      }).returning();

      await event(row, "created", user.id, user.name, null, null, planSnapshot(row));
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Skill development plan created",
        resource: row.title,
        metadata: {
          developmentPlanId: row.id,
          employeeId,
          skillId,
          sourceCycleId: row.sourceCycleId,
          consecutiveGapCycles: evidence.consecutiveGapCycles,
        },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({
        error: "An open development plan already exists for this employee and skill.",
      }, { status: 409 });
    }
  }

  if (entityType === "milestone") {
    const planId = Number(body.planId);
    const title = String(body.title ?? "").trim().slice(0, 220);
    const detail = String(body.detail ?? "").trim().slice(0, 8000) || null;
    const dueDate = dateOnly(body.dueDate);
    if (!Number.isInteger(planId) || title.length < 3 || !dueDate) {
      return Response.json({ error: "planId, milestone title, and dueDate are required." }, { status: 400 });
    }

    const [plan] = await db.select().from(performanceSkillDevelopmentPlans).where(and(
      eq(performanceSkillDevelopmentPlans.id, planId),
      eq(performanceSkillDevelopmentPlans.organizationId, organizationId),
    )).limit(1);
    if (!plan) return Response.json({ error: "Development plan not found." }, { status: 404 });
    const [employee] = await db.select().from(employees).where(eq(employees.id, plan.employeeId)).limit(1);
    const scoped = employee ? assertScope(gate.access, employee.orgUnitId) : { ok: false as const, error: "Employee not found.", status: 404 };
    if (!scoped.ok) return Response.json({ error: scoped.error }, { status: scoped.status });
    if (plan.status === "completed" || plan.status === "cancelled") {
      return Response.json({ error: "Closed development plans cannot receive new milestones." }, { status: 409 });
    }

    const [row] = await db.insert(performanceSkillDevelopmentMilestones).values({
      organizationId,
      planId,
      title,
      detail,
      dueDate,
      status: "open",
    }).returning();

    await event(plan, "milestone_created", user.id, user.name, null, null, {
      milestoneId: row.id,
      title: row.title,
      dueDate: row.dueDate,
    });
    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "entityType must be plan or milestone." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "plan");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await managerGate(user.id, organizationId);
  if ("error" in gate) return gate.error;

  if (entityType === "plan") {
    const id = Number(body.id);
    const status = String(body.status ?? "");
    const note = String(body.note ?? "").trim().slice(0, 4000) || null;
    if (!Number.isInteger(id) || !["planned", "in_progress", "completed", "cancelled"].includes(status)) {
      return Response.json({ error: "Valid plan id and status are required." }, { status: 400 });
    }

    const [existing] = await db.select().from(performanceSkillDevelopmentPlans).where(and(
      eq(performanceSkillDevelopmentPlans.id, id),
      eq(performanceSkillDevelopmentPlans.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Development plan not found." }, { status: 404 });
    if (existing.status === "completed" || existing.status === "cancelled") {
      return Response.json({ error: "Closed development plans are locked." }, { status: 409 });
    }
    const allowedPlanTransitions: Record<string, string[]> = {
      planned: ["in_progress", "cancelled"],
      in_progress: ["completed", "cancelled"],
    };
    if (!allowedPlanTransitions[existing.status]?.includes(status)) {
      return Response.json({ error: "That development plan status transition is not allowed." }, { status: 409 });
    }
    const [employee] = await db.select().from(employees).where(eq(employees.id, existing.employeeId)).limit(1);
    const scoped = employee ? assertScope(gate.access, employee.orgUnitId) : { ok: false as const, error: "Employee not found.", status: 404 };
    if (!scoped.ok) return Response.json({ error: scoped.error }, { status: scoped.status });

    if (status === "cancelled" && (!note || note.length < 10)) {
      return Response.json({ error: "A cancellation reason of at least 10 characters is required." }, { status: 400 });
    }
    if (status === "completed") {
      const milestones = await db.select().from(performanceSkillDevelopmentMilestones).where(and(
        eq(performanceSkillDevelopmentMilestones.organizationId, organizationId),
        eq(performanceSkillDevelopmentMilestones.planId, id),
      ));
      const unfinished = milestones.filter((item) => !["completed", "cancelled"].includes(item.status));
      if (unfinished.length) {
        return Response.json({
          error: "Complete or cancel every development milestone before completing the plan.",
          unfinishedMilestoneIds: unfinished.map((item) => item.id),
        }, { status: 409 });
      }
    }

    const before = planSnapshot(existing);
    const now = new Date();
    const [row] = await db.update(performanceSkillDevelopmentPlans).set({
      status,
      startedAt: status === "in_progress" && !existing.startedAt ? now : existing.startedAt,
      completedAt: status === "completed" ? now : null,
      cancelledAt: status === "cancelled" ? now : null,
      updatedAt: now,
    }).where(eq(performanceSkillDevelopmentPlans.id, id)).returning();

    await event(row, "status_changed", user.id, user.name, note, before, planSnapshot(row));
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Skill development plan status changed",
      resource: row.title,
      metadata: { developmentPlanId: id, fromStatus: existing.status, toStatus: status, note },
    });
    return Response.json(row);
  }

  if (entityType === "milestone") {
    const id = Number(body.id);
    const status = String(body.status ?? "");
    if (!Number.isInteger(id) || !["open", "in_progress", "completed", "cancelled"].includes(status)) {
      return Response.json({ error: "Valid milestone id and status are required." }, { status: 400 });
    }
    const [existing] = await db.select().from(performanceSkillDevelopmentMilestones).where(and(
      eq(performanceSkillDevelopmentMilestones.id, id),
      eq(performanceSkillDevelopmentMilestones.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Development milestone not found." }, { status: 404 });
    if (existing.status === "completed" || existing.status === "cancelled") {
      return Response.json({ error: "Closed development milestones are locked." }, { status: 409 });
    }
    const [plan] = await db.select().from(performanceSkillDevelopmentPlans).where(eq(performanceSkillDevelopmentPlans.id, existing.planId)).limit(1);
    if (!plan) return Response.json({ error: "Development plan not found." }, { status: 404 });
    if (plan.status === "completed" || plan.status === "cancelled") {
      return Response.json({ error: "Closed development plans cannot change milestones." }, { status: 409 });
    }
    const [employee] = await db.select().from(employees).where(eq(employees.id, plan.employeeId)).limit(1);
    const scoped = employee ? assertScope(gate.access, employee.orgUnitId) : { ok: false as const, error: "Employee not found.", status: 404 };
    if (!scoped.ok) return Response.json({ error: scoped.error }, { status: scoped.status });

    const completed = status === "completed";
    const [row] = await db.update(performanceSkillDevelopmentMilestones).set({
      status,
      completedAt: completed ? new Date() : null,
      completedByUserId: completed ? user.id : null,
      completedByName: completed ? user.name : null,
      updatedAt: new Date(),
    }).where(eq(performanceSkillDevelopmentMilestones.id, id)).returning();

    await event(plan, "milestone_status_changed", user.id, user.name, null, {
      milestoneId: existing.id,
      status: existing.status,
    }, {
      milestoneId: row.id,
      status: row.status,
    });
    return Response.json(row);
  }

  return Response.json({ error: "entityType must be plan or milestone." }, { status: 400 });
}
