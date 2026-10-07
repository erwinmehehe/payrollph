import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  performanceCycleTemplates,
  performanceCycles,
  performanceFeedback,
  performanceGoals,
  performanceOneOnOneAgendaContributions,
  performanceOneOnOnes,
  performanceReviewItems,
  performanceReviews,
  performanceTemplates,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function score(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n.toFixed(2) : null;
}

async function selfContext() {
  const session = await getSessionUser();
  if (!session) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (session.role !== "employee") {
    return { error: Response.json({ error: "This endpoint is for employee self-service accounts." }, { status: 403 }) };
  }
  if (!session.employeeId) {
    return { error: Response.json({ error: "This account is not linked to an employee record." }, { status: 403 }) };
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return { error: Response.json({ error: "Employee record not found." }, { status: 404 }) };

  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return { error: membershipDenied };

  return { session, employee };
}

export async function GET() {
  const context = await selfContext();
  if ("error" in context) return context.error;

  const [reviews, goals, cycles, allItems, templates, cycleTemplates, oneOnOnes, agendaContributions, feedback] = await Promise.all([
    db.select().from(performanceReviews)
      .where(and(
        eq(performanceReviews.organizationId, context.employee.organizationId),
        eq(performanceReviews.employeeId, context.employee.id),
      ))
      .orderBy(desc(performanceReviews.id)),
    db.select().from(performanceGoals)
      .where(and(
        eq(performanceGoals.organizationId, context.employee.organizationId),
        eq(performanceGoals.employeeId, context.employee.id),
      ))
      .orderBy(desc(performanceGoals.id)),
    db.select().from(performanceCycles)
      .where(eq(performanceCycles.organizationId, context.employee.organizationId))
      .orderBy(desc(performanceCycles.startDate)),
    db.select().from(performanceReviewItems)
      .where(eq(performanceReviewItems.organizationId, context.employee.organizationId)),
    db.select().from(performanceTemplates)
      .where(eq(performanceTemplates.organizationId, context.employee.organizationId)),
    db.select().from(performanceCycleTemplates)
      .where(eq(performanceCycleTemplates.organizationId, context.employee.organizationId)),
    db.select({
      id: performanceOneOnOnes.id,
      scheduledFor: performanceOneOnOnes.scheduledFor,
      status: performanceOneOnOnes.status,
      agenda: performanceOneOnOnes.agenda,
      sharedSummary: performanceOneOnOnes.sharedSummary,
      completedAt: performanceOneOnOnes.completedAt,
      cancelledAt: performanceOneOnOnes.cancelledAt,
      createdByName: performanceOneOnOnes.createdByName,
    }).from(performanceOneOnOnes)
      .where(and(
        eq(performanceOneOnOnes.organizationId, context.employee.organizationId),
        eq(performanceOneOnOnes.employeeId, context.employee.id),
      ))
      .orderBy(desc(performanceOneOnOnes.scheduledFor)),
    db.select({
      id: performanceOneOnOneAgendaContributions.id,
      oneOnOneId: performanceOneOnOneAgendaContributions.oneOnOneId,
      authorName: performanceOneOnOneAgendaContributions.authorName,
      content: performanceOneOnOneAgendaContributions.content,
      createdAt: performanceOneOnOneAgendaContributions.createdAt,
    }).from(performanceOneOnOneAgendaContributions)
      .where(and(
        eq(performanceOneOnOneAgendaContributions.organizationId, context.employee.organizationId),
        eq(performanceOneOnOneAgendaContributions.employeeId, context.employee.id),
      ))
      .orderBy(desc(performanceOneOnOneAgendaContributions.createdAt)),
    db.select({
      id: performanceFeedback.id,
      goalId: performanceFeedback.goalId,
      authorName: performanceFeedback.authorName,
      feedbackType: performanceFeedback.feedbackType,
      content: performanceFeedback.content,
      occurredAt: performanceFeedback.occurredAt,
    }).from(performanceFeedback)
      .where(and(
        eq(performanceFeedback.organizationId, context.employee.organizationId),
        eq(performanceFeedback.employeeId, context.employee.id),
        eq(performanceFeedback.visibility, "employee_shared"),
      ))
      .orderBy(desc(performanceFeedback.occurredAt)),
  ]);

  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const linkByKey = new Map(cycleTemplates.map((link) => [`${link.cycleId}:${link.templateId}`, link]));

  return Response.json({
    reviews: reviews.map((review) => ({
      ...review,
      cycle: cycleById.get(review.cycleId) ?? null,
      items: allItems
        .filter((item) => item.reviewId === review.id)
        .map((item) => ({
          ...item,
          template: templateById.get(item.templateId) ?? null,
          cycleTemplate: linkByKey.get(`${review.cycleId}:${item.templateId}`) ?? null,
        })),
    })),
    goals,
    oneOnOnes: oneOnOnes.map((meeting) => ({
      ...meeting,
      agendaContributions: agendaContributions
        .filter((item) => item.oneOnOneId === meeting.id)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    })),
    feedback,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await selfContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const oneOnOneId = Number(body.oneOnOneId);
  const content = String(body.content ?? "").trim().slice(0, 2000);
  if (!Number.isInteger(oneOnOneId) || content.length < 5) {
    return Response.json({ error: "A valid oneOnOneId and an agenda contribution of at least 5 characters are required." }, { status: 400 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: context.session.id,
    action: "performance-one-on-one-agenda-contribution",
    resourceId: oneOnOneId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [meeting] = await db.select().from(performanceOneOnOnes).where(and(
    eq(performanceOneOnOnes.id, oneOnOneId),
    eq(performanceOneOnOnes.organizationId, context.employee.organizationId),
    eq(performanceOneOnOnes.employeeId, context.employee.id),
  )).limit(1);
  if (!meeting) return Response.json({ error: "Upcoming 1:1 not found for this employee account." }, { status: 404 });
  if (meeting.status !== "scheduled") {
    return Response.json({ error: "Agenda contributions are locked after a 1:1 is completed or cancelled." }, { status: 409 });
  }

  const [row] = await db.insert(performanceOneOnOneAgendaContributions).values({
    organizationId: context.employee.organizationId,
    oneOnOneId,
    employeeId: context.employee.id,
    authorUserId: context.session.id,
    authorEmployeeId: context.employee.id,
    authorName: context.session.name,
    content,
  }).returning();

  await recordAuditEvent({
    organizationId: context.employee.organizationId,
    actor: context.session.name,
    action: "Employee contributed 1:1 agenda item",
    resource: "1:1 #" + oneOnOneId,
    metadata: {
      oneOnOneId,
      agendaContributionId: row.id,
      employeeId: context.employee.id,
      contentLength: content.length,
    },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await selfContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const reviewId = Number(body.reviewId);
  const selfScore = score(body.selfScore);
  const employeeReflection = String(body.employeeReflection ?? "").trim().slice(0, 8000);
  const submittedItems = Array.isArray(body.items) ? body.items : [];

  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: "A valid reviewId is required." }, { status: 400 });
  }
  if (selfScore === null) {
    return Response.json({ error: "Self-assessment score must be from 1.00 to 5.00." }, { status: 400 });
  }
  if (!employeeReflection) {
    return Response.json({ error: "A reflection is required before submitting a self-assessment." }, { status: 400 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: context.session.id,
    action: "performance-self-assessment",
    resourceId: reviewId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [existing] = await db.select().from(performanceReviews).where(and(
    eq(performanceReviews.id, reviewId),
    eq(performanceReviews.organizationId, context.employee.organizationId),
    eq(performanceReviews.employeeId, context.employee.id),
  )).limit(1);

  if (!existing) {
    return Response.json({ error: "Performance review not found for this employee account." }, { status: 404 });
  }
  if (existing.status === "completed") {
    return Response.json({ error: "This review is already completed and the self-assessment is locked." }, { status: 409 });
  }

  const [cycle] = await db.select().from(performanceCycles).where(and(
    eq(performanceCycles.id, existing.cycleId),
    eq(performanceCycles.organizationId, context.employee.organizationId),
  )).limit(1);
  if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });
  if (cycle.status === "completed") {
    return Response.json({ error: "This performance cycle is completed and locked." }, { status: 409 });
  }

  const items = await db.select().from(performanceReviewItems).where(and(
    eq(performanceReviewItems.organizationId, context.employee.organizationId),
    eq(performanceReviewItems.reviewId, reviewId),
  ));
  const itemIds = new Set(items.map((item) => item.id));
  const normalizedItems: Array<{ id: number; selfScore: string; employeeComment: string | null }> = [];

  for (const raw of submittedItems) {
    const candidate = raw as Record<string, unknown>;
    const id = Number(candidate.id);
    const itemScore = score(candidate.selfScore);
    if (!Number.isInteger(id) || !itemIds.has(id)) {
      return Response.json({ error: "A submitted competency/KRA item does not belong to this review." }, { status: 400 });
    }
    if (itemScore === null) {
      return Response.json({ error: "Competency/KRA self-ratings must be from 1.00 to 5.00." }, { status: 400 });
    }
    normalizedItems.push({
      id,
      selfScore: itemScore,
      employeeComment: String(candidate.employeeComment ?? "").trim().slice(0, 4000) || null,
    });
  }

  if (cycle.requireSelfAssessment && items.length) {
    for (const item of items.filter((row) => row.required)) {
      const submitted = normalizedItems.find((candidate) => candidate.id === item.id);
      if (!submitted && !item.selfScore) {
        return Response.json({ error: "Rate every required competency/KRA item before submitting this self-assessment." }, { status: 409 });
      }
    }
  }

  const [row] = await db.update(performanceReviews)
    .set({
      selfScore,
      employeeReflection,
      updatedAt: new Date(),
    })
    .where(eq(performanceReviews.id, reviewId))
    .returning();

  if (normalizedItems.length) {
    for (const item of normalizedItems) {
      await db.update(performanceReviewItems).set({
        selfScore: item.selfScore,
        employeeComment: item.employeeComment,
        updatedAt: new Date(),
      }).where(and(
        eq(performanceReviewItems.id, item.id),
        eq(performanceReviewItems.reviewId, reviewId),
      ));
    }
  }

  const updatedItems = itemIds.size
    ? await db.select().from(performanceReviewItems).where(inArray(performanceReviewItems.id, [...itemIds]))
    : [];

  await recordAuditEvent({
    organizationId: context.employee.organizationId,
    actor: context.session.name,
    action: existing.selfScore ? "Performance self-assessment updated" : "Performance self-assessment submitted",
    resource: `Employee #${context.employee.id}`,
    metadata: {
      reviewId,
      cycleId: existing.cycleId,
      selfScore,
      reflectionLength: employeeReflection.length,
      structuredItemCount: normalizedItems.length,
    },
  });

  return Response.json({ ...row, items: updatedItems });
}
