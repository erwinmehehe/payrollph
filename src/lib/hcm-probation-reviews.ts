import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmProbationReviewAcknowledgments,
  hcmProbationReviewEvents,
  hcmProbationReviews,
} from "@/db/schema";

export const PROBATION_REVIEW_RECOMMENDATIONS = [
  "confirm_regular",
  "non_renew",
  "needs_hr_review",
] as const;

export type ProbationReviewRecommendation =
  (typeof PROBATION_REVIEW_RECOMMENDATIONS)[number];

const RATING_FIELDS = [
  "overallRating",
  "roleExpectationsRating",
  "workQualityRating",
  "reliabilityRating",
  "conductCollaborationRating",
] as const;

export type ProbationReviewInput = {
  recommendation: ProbationReviewRecommendation | null;
  overallRating: number | null;
  roleExpectationsRating: number | null;
  workQualityRating: number | null;
  reliabilityRating: number | null;
  conductCollaborationRating: number | null;
  summary: string | null;
  strengths: string | null;
  developmentAreas: string | null;
};

function optionalText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function optionalRating(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Probation review ratings must be whole numbers from 1 to 5.");
  }
  return rating;
}

export function parseProbationReviewInput(
  value: Record<string, unknown>,
  { requireComplete = false }: { requireComplete?: boolean } = {},
): ProbationReviewInput {
  const recommendationText = String(value.recommendation ?? "").trim().toLowerCase();
  const recommendation = recommendationText
    ? recommendationText as ProbationReviewRecommendation
    : null;
  if (recommendation && !PROBATION_REVIEW_RECOMMENDATIONS.includes(recommendation)) {
    throw new Error("Probation review recommendation is not supported.");
  }

  const parsed: ProbationReviewInput = {
    recommendation,
    overallRating: optionalRating(value.overallRating),
    roleExpectationsRating: optionalRating(value.roleExpectationsRating),
    workQualityRating: optionalRating(value.workQualityRating),
    reliabilityRating: optionalRating(value.reliabilityRating),
    conductCollaborationRating: optionalRating(value.conductCollaborationRating),
    summary: optionalText(value.summary, 8000),
    strengths: optionalText(value.strengths, 8000),
    developmentAreas: optionalText(value.developmentAreas, 8000),
  };

  if (requireComplete) {
    if (!parsed.recommendation) {
      throw new Error("A manager recommendation is required before submitting the probation review.");
    }
    for (const field of RATING_FIELDS) {
      if (parsed[field] == null) {
        throw new Error("All five probation review ratings are required before submission.");
      }
    }
    if (!parsed.summary || parsed.summary.length < 10) {
      throw new Error("A probation review summary of at least 10 characters is required before submission.");
    }
  }

  return parsed;
}

export function probationReviewSnapshot(review: typeof hcmProbationReviews.$inferSelect) {
  return {
    id: review.id,
    employmentTermId: review.employmentTermId,
    employeeId: review.employeeId,
    status: review.status,
    recommendation: review.recommendation,
    ratings: {
      overall: review.overallRating,
      roleExpectations: review.roleExpectationsRating,
      workQuality: review.workQualityRating,
      reliability: review.reliabilityRating,
      conductCollaboration: review.conductCollaborationRating,
    },
    summary: review.summary,
    strengths: review.strengths,
    developmentAreas: review.developmentAreas,
    reviewerUserId: review.reviewerUserId,
    reviewerEmployeeId: review.reviewerEmployeeId,
    reviewerName: review.reviewerName,
    submittedAt: review.submittedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

export async function recordProbationReviewEvent(input: {
  organizationId: number;
  reviewId: number;
  employeeId: number;
  eventType: string;
  actorUserId?: number | null;
  actorName: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  const [row] = await db.insert(hcmProbationReviewEvents).values({
    organizationId: input.organizationId,
    reviewId: input.reviewId,
    employeeId: input.employeeId,
    eventType: input.eventType.slice(0, 32),
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName.slice(0, 120),
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date(),
  }).returning();
  return row;
}

export async function loadProbationReviewPacket(input: {
  organizationId: number;
  employmentTermId: number;
}) {
  const [review] = await db.select().from(hcmProbationReviews)
    .where(and(
      eq(hcmProbationReviews.organizationId, input.organizationId),
      eq(hcmProbationReviews.employmentTermId, input.employmentTermId),
    ))
    .limit(1);
  if (!review) return null;

  const [acknowledgment, events] = await Promise.all([
    db.select().from(hcmProbationReviewAcknowledgments)
      .where(eq(hcmProbationReviewAcknowledgments.reviewId, review.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select().from(hcmProbationReviewEvents)
      .where(and(
        eq(hcmProbationReviewEvents.organizationId, input.organizationId),
        eq(hcmProbationReviewEvents.reviewId, review.id),
      ))
      .orderBy(asc(hcmProbationReviewEvents.createdAt), asc(hcmProbationReviewEvents.id)),
  ]);

  return {
    review,
    acknowledgment,
    events,
  };
}

export async function loadSubmittedProbationReview(input: {
  organizationId: number;
  employmentTermId: number;
}) {
  const [review] = await db.select().from(hcmProbationReviews)
    .where(and(
      eq(hcmProbationReviews.organizationId, input.organizationId),
      eq(hcmProbationReviews.employmentTermId, input.employmentTermId),
      eq(hcmProbationReviews.status, "submitted"),
    ))
    .orderBy(desc(hcmProbationReviews.submittedAt), desc(hcmProbationReviews.id))
    .limit(1);
  return review ?? null;
}

export async function listSubmittedProbationReviewsForEmployee(input: {
  organizationId: number;
  employeeId: number;
}) {
  const reviews = await db.select().from(hcmProbationReviews)
    .where(and(
      eq(hcmProbationReviews.organizationId, input.organizationId),
      eq(hcmProbationReviews.employeeId, input.employeeId),
      eq(hcmProbationReviews.status, "submitted"),
    ))
    .orderBy(desc(hcmProbationReviews.submittedAt), desc(hcmProbationReviews.id));

  if (reviews.length === 0) return [];

  const acknowledgments = await db.select().from(hcmProbationReviewAcknowledgments)
    .where(and(
      eq(hcmProbationReviewAcknowledgments.organizationId, input.organizationId),
      eq(hcmProbationReviewAcknowledgments.employeeId, input.employeeId),
    ));

  const ackByReview = new Map(acknowledgments.map((ack) => [ack.reviewId, ack]));
  return reviews.map((review) => ({
    review,
    acknowledgment: ackByReview.get(review.id) ?? null,
  }));
}
