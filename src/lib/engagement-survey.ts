import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees, engagementSurveyParticipants, engagementSurveys,
} from "@/db/schema";
import { ENGAGEMENT_MIN_GROUP_SIZE } from "@/lib/engagement-survey-privacy";

export function closedSurveyDisclosure(input: {
  question: string;
  status: string;
  responseCount: number;
  scoreSum: number;
}) {
  const eligible = input.status === "closed"
    && input.responseCount >= ENGAGEMENT_MIN_GROUP_SIZE;
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

export async function closeEngagementSurvey(organizationId: number, surveyId: number) {
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
    return Boolean(survey);
  });
}
