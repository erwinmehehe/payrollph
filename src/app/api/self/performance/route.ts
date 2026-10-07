import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, performanceCycles, performanceGoals, performanceReviews } from "@/db/schema";
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

  const [reviews, goals, cycles] = await Promise.all([
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
  ]);

  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  return Response.json({
    reviews: reviews.map((review) => ({ ...review, cycle: cycleById.get(review.cycleId) ?? null })),
    goals,
  });
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

  const [row] = await db.update(performanceReviews)
    .set({
      selfScore,
      employeeReflection,
      updatedAt: new Date(),
    })
    .where(eq(performanceReviews.id, reviewId))
    .returning();

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
    },
  });

  return Response.json(row);
}
