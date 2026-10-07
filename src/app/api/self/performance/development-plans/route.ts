import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmSkills,
  performanceSkillDevelopmentMilestones,
  performanceSkillDevelopmentPlans,
  performanceSkillDevelopmentProgress,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const context = await selfContext();
  if ("error" in context) return context.error;

  const plans = await db.select().from(performanceSkillDevelopmentPlans).where(and(
    eq(performanceSkillDevelopmentPlans.organizationId, context.employee.organizationId),
    eq(performanceSkillDevelopmentPlans.employeeId, context.employee.id),
    eq(performanceSkillDevelopmentPlans.employeeVisible, true),
  )).orderBy(asc(performanceSkillDevelopmentPlans.targetDate));

  const planIds = plans.map((plan) => plan.id);
  const skillIds = [...new Set(plans.map((plan) => plan.skillId))];
  const [milestones, progress, skills] = await Promise.all([
    planIds.length
      ? db.select().from(performanceSkillDevelopmentMilestones).where(inArray(performanceSkillDevelopmentMilestones.planId, planIds))
      : Promise.resolve([]),
    planIds.length
      ? db.select().from(performanceSkillDevelopmentProgress).where(inArray(performanceSkillDevelopmentProgress.planId, planIds))
      : Promise.resolve([]),
    skillIds.length
      ? db.select().from(hcmSkills).where(inArray(hcmSkills.id, skillIds))
      : Promise.resolve([]),
  ]);

  return Response.json({
    plans: plans.map((plan) => ({
      ...plan,
      skill: skills.find((skill) => skill.id === plan.skillId) ?? null,
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

  const context = await selfContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const planId = Number(body.planId);
  const content = String(body.content ?? "").trim().slice(0, 5000);
  const progressPercent = body.progressPercent == null || body.progressPercent === ""
    ? null
    : Number(body.progressPercent);
  if (!Number.isInteger(planId) || content.length < 5) {
    return Response.json({ error: "A valid planId and progress note of at least 5 characters are required." }, { status: 400 });
  }
  if (progressPercent != null && (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100)) {
    return Response.json({ error: "progressPercent must be an integer from 0 to 100." }, { status: 400 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: context.session.id,
    action: "self-performance-development-progress",
    resourceId: planId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [plan] = await db.select().from(performanceSkillDevelopmentPlans).where(and(
    eq(performanceSkillDevelopmentPlans.id, planId),
    eq(performanceSkillDevelopmentPlans.organizationId, context.employee.organizationId),
    eq(performanceSkillDevelopmentPlans.employeeId, context.employee.id),
    eq(performanceSkillDevelopmentPlans.employeeVisible, true),
  )).limit(1);
  if (!plan) return Response.json({ error: "Visible development plan not found." }, { status: 404 });
  if (plan.status === "completed" || plan.status === "cancelled") {
    return Response.json({ error: "Closed development plans do not accept new progress updates." }, { status: 409 });
  }

  const [row] = await db.insert(performanceSkillDevelopmentProgress).values({
    organizationId: context.employee.organizationId,
    planId,
    employeeId: context.employee.id,
    authorUserId: context.session.id,
    authorEmployeeId: context.employee.id,
    authorName: context.session.name,
    progressPercent,
    content,
  }).returning();

  await recordAuditEvent({
    organizationId: context.employee.organizationId,
    actor: context.session.name,
    action: "Employee added skill development progress",
    resource: plan.title,
    metadata: { developmentPlanId: planId, progressUpdateId: row.id, progressPercent },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await selfContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const milestoneId = Number(body.milestoneId);
  const status = String(body.status ?? "");
  if (!Number.isInteger(milestoneId) || !["in_progress", "completed"].includes(status)) {
    return Response.json({ error: "A valid milestoneId and status in_progress or completed are required." }, { status: 400 });
  }

  const [milestone] = await db.select().from(performanceSkillDevelopmentMilestones).where(and(
    eq(performanceSkillDevelopmentMilestones.id, milestoneId),
    eq(performanceSkillDevelopmentMilestones.organizationId, context.employee.organizationId),
  )).limit(1);
  if (!milestone) return Response.json({ error: "Development milestone not found." }, { status: 404 });

  const [plan] = await db.select().from(performanceSkillDevelopmentPlans).where(and(
    eq(performanceSkillDevelopmentPlans.id, milestone.planId),
    eq(performanceSkillDevelopmentPlans.employeeId, context.employee.id),
    eq(performanceSkillDevelopmentPlans.employeeVisible, true),
  )).limit(1);
  if (!plan) return Response.json({ error: "Visible development plan not found." }, { status: 404 });
  if (plan.status === "completed" || plan.status === "cancelled") {
    return Response.json({ error: "Closed development plans cannot be changed by employee self-service." }, { status: 409 });
  }
  if (milestone.status === "completed" || milestone.status === "cancelled") {
    return Response.json({ error: "Closed milestones can only be reopened by the manager or People administrator." }, { status: 409 });
  }

  const completed = status === "completed";
  const [row] = await db.update(performanceSkillDevelopmentMilestones).set({
    status,
    completedAt: completed ? new Date() : null,
    completedByUserId: completed ? context.session.id : null,
    completedByName: completed ? context.session.name : null,
    updatedAt: new Date(),
  }).where(eq(performanceSkillDevelopmentMilestones.id, milestoneId)).returning();

  await recordAuditEvent({
    organizationId: context.employee.organizationId,
    actor: context.session.name,
    action: completed ? "Employee completed development milestone" : "Employee progressed development milestone",
    resource: row.title,
    metadata: { developmentPlanId: plan.id, milestoneId: row.id, status: row.status },
  });

  return Response.json(row);
}
