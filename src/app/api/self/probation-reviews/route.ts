import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmEmploymentTerms,
  hcmProbationReviewAcknowledgments,
  hcmProbationReviews,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  listSubmittedProbationReviewsForEmployee,
  probationReviewSnapshot,
  recordProbationReviewEvent,
} from "@/lib/hcm-probation-reviews";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function selfContext() {
  const session = await getSessionUser();
  if (!session) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (session.role !== "employee") {
    return { error: Response.json({ error: "This endpoint is for employee self-service accounts." }, { status: 403 }) };
  }
  if (!session.employeeId) {
    return { error: Response.json({ error: "This account is not linked to an employee record." }, { status: 403 }) };
  }

  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);
  if (!employee) return { error: Response.json({ error: "Employee record not found." }, { status: 404 }) };

  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return { error: membershipDenied };

  return { session, employee };
}

export async function GET() {
  const context = await selfContext();
  if ("error" in context) return context.error;

  const rows = await listSubmittedProbationReviewsForEmployee({
    organizationId: context.employee.organizationId,
    employeeId: context.employee.id,
  });
  const termIds = rows.map((row) => row.review.employmentTermId);
  const terms = termIds.length
    ? await db.select().from(hcmEmploymentTerms).where(and(
        eq(hcmEmploymentTerms.organizationId, context.employee.organizationId),
        inArray(hcmEmploymentTerms.id, termIds),
      ))
    : [];
  const termById = new Map(terms.map((term) => [term.id, term]));

  return Response.json({
    reviews: rows.map(({ review, acknowledgment }) => ({
      review: probationReviewSnapshot(review),
      term: termById.get(review.employmentTermId) ?? null,
      acknowledgment,
    })),
    acknowledgmentStatement:
      "Acknowledging confirms only that you received and viewed the probation review. It does not mean you agree with the review, waive any rights, or approve an employment decision.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await selfContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const reviewId = Number(body.reviewId);
  const employeeComment = String(body.employeeComment ?? "").trim().slice(0, 4000) || null;
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: "A valid reviewId is required." }, { status: 400 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: context.session.id,
    action: "self-probation-review-acknowledge",
    resourceId: reviewId,
    limit: 10,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [review] = await db.select().from(hcmProbationReviews).where(and(
    eq(hcmProbationReviews.id, reviewId),
    eq(hcmProbationReviews.organizationId, context.employee.organizationId),
    eq(hcmProbationReviews.employeeId, context.employee.id),
    eq(hcmProbationReviews.status, "submitted"),
  )).limit(1);
  if (!review) {
    return Response.json({ error: "Submitted probation review not found for this employee account." }, { status: 404 });
  }

  try {
    const now = new Date();
    const [acknowledgment] = await db.insert(hcmProbationReviewAcknowledgments).values({
      organizationId: context.employee.organizationId,
      reviewId,
      employeeId: context.employee.id,
      response: "acknowledged_receipt",
      employeeComment,
      statementVersion: "receipt-only-v1",
      acknowledgedByUserId: context.session.id,
      acknowledgedByName: context.session.name,
      createdAt: now,
    }).returning();

    await recordProbationReviewEvent({
      organizationId: context.employee.organizationId,
      reviewId,
      employeeId: context.employee.id,
      eventType: "employee_acknowledged",
      actorUserId: context.session.id,
      actorName: context.session.name,
      metadata: {
        statementVersion: acknowledgment.statementVersion,
        hasComment: Boolean(employeeComment),
      },
      createdAt: now,
    });
    await recordAuditEvent({
      organizationId: context.employee.organizationId,
      actor: context.session.name,
      action: "Employee acknowledged probation review receipt",
      resource: `Employee #${context.employee.id}`,
      metadata: {
        probationReviewId: reviewId,
        employmentTermId: review.employmentTermId,
        statementVersion: acknowledgment.statementVersion,
      },
    });

    return Response.json({
      acknowledgment,
      statement:
        "Receipt acknowledgment recorded. This does not indicate agreement and does not approve or change your employment status.",
    }, { status: 201 });
  } catch {
    return Response.json({
      error: "This probation review has already been acknowledged by the employee.",
    }, { status: 409 });
  }
}
