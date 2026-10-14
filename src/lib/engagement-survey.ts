import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employees, engagementSurveyParticipants, engagementSurveys,
} from "@/db/schema";
import { ENGAGEMENT_MIN_GROUP_SIZE } from "@/lib/engagement-survey-privacy";

export function closedSurveyDisclosure(input: {
  question: string;
  status: string;
  responseCount: number;
  scoreSum: number;
}) {
  // Fail closed if a corrupted or incomplete aggregate reaches disclosure.
  // A count alone does not prove that a score sum represents valid ratings.
  const eligible = input.status === "closed"
    && Number.isSafeInteger(input.responseCount)
    && Number.isSafeInteger(input.scoreSum)
    && input.responseCount >= ENGAGEMENT_MIN_GROUP_SIZE
    && input.scoreSum >= input.responseCount
    && input.scoreSum <= input.responseCount * 5;
  return {
    question: input.question,
    status: input.status,
    disclosure: eligible ? "available" : "suppressed",
    // Never return counts for an open or undersized survey; revealing daily
    // count changes would allow sensitive response inference.
    ...(eligible ? {
      responses: input.responseCount,
      average: Math.round((input.scoreSum / input.responseCount) * 100) / 100,
    } : {}),
  };
}

/**
 * Creation and its audit receipt are one transaction. If the append-only audit
 * table rejects the event, do not leave an unaudited survey behind.
 */
export async function createEngagementSurveyWithAudit(input: {
  organizationId: number;
  question: string;
  createdByUserId: number | null;
  actor: string;
}) {
  return db.transaction(async tx => {
    const [survey] = await tx.insert(engagementSurveys).values({
      organizationId: input.organizationId,
      question: input.question,
      createdByUserId: input.createdByUserId,
    }).returning({ id: engagementSurveys.id });
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.actor,
      action: "Engagement survey opened",
      resource: "engagement_survey",
      metadata: { surveyId: survey.id, actorUserId: input.createdByUserId },
    });
    return survey;
  });
}

/** Only a duplicate of the one-open-survey index is an expected 409 conflict.
 * Drizzle may wrap Postgres errors in nested causes. A duplicate in an audit
 * or other unrelated table must not be misreported as a survey conflict.
 */
export function isOpenSurveyConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth++) {
    if (current === null || typeof current !== "object") return false;
    if ("code" in current && current.code === "23505" &&
        "constraint" in current && current.constraint === "engagement_surveys_one_open_per_org") {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function listSurveysForTenant(organizationId: number) {
  return db.select({
    id: engagementSurveys.id,
    question: engagementSurveys.question,
    status: engagementSurveys.status,
    responseCount: engagementSurveys.responseCount,
    scoreSum: engagementSurveys.scoreSum,
  }).from(engagementSurveys).where(eq(engagementSurveys.organizationId, organizationId))
    .orderBy(desc(engagementSurveys.id)).limit(25);
}

export async function submitAnonymousSurveyRating(input: {
  organizationId: number;
  surveyId: number;
  employeeId: number;
  score: number;
}) {
  if (![input.organizationId, input.surveyId, input.employeeId].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error("Invalid survey scope.");
  }
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    throw new Error("Rating must be a whole number from 1 to 5.");
  }
  return db.transaction(async tx => {
    // Lock the survey first, serializing submissions with the close action.
    await tx.execute(sql`select id from ${engagementSurveys}
      where id = ${input.surveyId} and organization_id = ${input.organizationId} for update`);
    const [[survey], [employee]] = await Promise.all([
      tx.select({ id: engagementSurveys.id, status: engagementSurveys.status })
        .from(engagementSurveys).where(and(
          eq(engagementSurveys.id, input.surveyId),
          eq(engagementSurveys.organizationId, input.organizationId),
        )).limit(1),
      tx.select({ id: employees.id }).from(employees).where(and(
        eq(employees.id, input.employeeId),
        eq(employees.organizationId, input.organizationId),
      )).limit(1),
    ]);
    if (!survey || !employee || survey.status !== "open") return { accepted: false as const, reason: "unavailable" as const };
    const [first] = await tx.insert(engagementSurveyParticipants).values({
      organizationId: input.organizationId,
      surveyId: input.surveyId,
      employeeId: input.employeeId,
    }).onConflictDoNothing({
      target: [engagementSurveyParticipants.surveyId, engagementSurveyParticipants.employeeId],
    }).returning({ id: engagementSurveyParticipants.id });
    if (!first) return { accepted: false as const, reason: "already_submitted" as const };
    await tx.update(engagementSurveys).set({
      responseCount: sql`${engagementSurveys.responseCount} + 1`,
      scoreSum: sql`${engagementSurveys.scoreSum} + ${input.score}`,
    }).where(and(
      eq(engagementSurveys.id, input.surveyId),
      eq(engagementSurveys.organizationId, input.organizationId),
      eq(engagementSurveys.status, "open"),
    ));
    // The rating is NOT written to a participant row, audit log, or response
    // table. Only a tenant aggregate changes.
    return { accepted: true as const, reason: null };
  });
}

export async function closeEngagementSurvey(
  organizationId: number, surveyId: number,
  audit?: { actor: string; actorUserId: number | null },
) {
  return db.transaction(async tx => {
    await tx.execute(sql`select id from ${engagementSurveys}
      where id = ${surveyId} and organization_id = ${organizationId} for update`);
    const [survey] = await tx.update(engagementSurveys).set({
      status: "closed",
      closedAt: new Date(),
    }).where(and(
      eq(engagementSurveys.organizationId, organizationId),
      eq(engagementSurveys.id, surveyId),
      eq(engagementSurveys.status, "open"),
    )).returning({ id: engagementSurveys.id });
    if (!survey) return false;
    // Callers that supply human approval evidence must commit the audit row
    // before the close becomes visible. The transaction rolls back on failure.
    if (audit) {
      await tx.insert(auditEvents).values({
        organizationId,
        actor: audit.actor,
        action: "Engagement survey closed",
        resource: "engagement_survey",
        metadata: { surveyId, actorUserId: audit.actorUserId },
      });
    }
    return true;
  });
}
