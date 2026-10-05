import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  engagementAnswers,
  engagementQuestions,
  engagementResponses,
  engagementSurveys,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import {
  anonymousRespondentKey,
  engagementAnonymityConfigured,
  identifiableRespondentKey,
} from "@/lib/engagement-privacy";

export const dynamic = "force-dynamic";

type SubmittedAnswer = {
  questionId?: unknown;
  numericValue?: unknown;
  textValue?: unknown;
};

async function eligibleEmployee(userId: number, employeeId: number | null, organizationId: number) {
  if (!employeeId) return null;
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee || employee.status !== "Active") return null;
  return employee;
}

function respondentKey(survey: typeof engagementSurveys.$inferSelect, userId: number) {
  return survey.anonymous
    ? anonymousRespondentKey({ surveyId: survey.id, organizationId: survey.organizationId, userId })
    : identifiableRespondentKey({ surveyId: survey.id, userId });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const employee = await eligibleEmployee(user.id, user.employeeId, organizationId);
  if (!employee) {
    return Response.json({
      employee: null,
      surveys: [],
      message: "A linked active employee record is required to respond to engagement surveys.",
    });
  }

  const now = new Date();
  const surveys = await db.select().from(engagementSurveys).where(and(
    eq(engagementSurveys.organizationId, organizationId),
    eq(engagementSurveys.status, "open"),
  ));

  const eligibleSurveys = surveys.filter((survey) => {
    if (survey.audienceOrgUnitId !== null && survey.audienceOrgUnitId !== employee.orgUnitId) return false;
    if (survey.opensAt && new Date(survey.opensAt).getTime() > now.getTime()) return false;
    if (survey.closesAt && new Date(survey.closesAt).getTime() <= now.getTime()) return false;
    return true;
  });

  const result = [];
  for (const survey of eligibleSurveys) {
    let key: string | null = null;
    let anonymityReady = true;
    try {
      key = respondentKey(survey, user.id);
    } catch {
      anonymityReady = false;
    }
    const existing = key
      ? (await db.select({ id: engagementResponses.id }).from(engagementResponses).where(and(
          eq(engagementResponses.surveyId, survey.id),
          eq(engagementResponses.respondentKey, key),
        )).limit(1))[0]
      : null;
    const questions = await db.select().from(engagementQuestions).where(and(
      eq(engagementQuestions.organizationId, organizationId),
      eq(engagementQuestions.surveyId, survey.id),
    )).orderBy(engagementQuestions.sortOrder, engagementQuestions.id);

    result.push({
      id: survey.id,
      name: survey.name,
      kind: survey.kind,
      anonymous: survey.anonymous,
      privacyThreshold: survey.privacyThreshold,
      closesAt: survey.closesAt,
      alreadyResponded: Boolean(existing),
      respondable: anonymityReady && !existing,
      anonymityReady,
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        required: question.required,
      })),
    });
  }

  return Response.json({
    employee: {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      orgUnitId: employee.orgUnitId,
    },
    anonymityConfigured: engagementAnonymityConfigured(),
    surveys: result,
    privacyNotice: "Anonymous responses are stored without your user or employee ID. Managers receive results only after the survey privacy threshold is met.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const surveyId = Number(body.surveyId);
  const submitted = Array.isArray(body.answers) ? body.answers as SubmittedAnswer[] : [];
  if (!Number.isInteger(organizationId) || !Number.isInteger(surveyId)) {
    return Response.json({ error: "organizationId and surveyId are required." }, { status: 400 });
  }

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const employee = await eligibleEmployee(user.id, user.employeeId, organizationId);
  if (!employee) return Response.json({ error: "A linked active employee record is required to respond." }, { status: 403 });

  const [survey] = await db.select().from(engagementSurveys).where(and(
    eq(engagementSurveys.id, surveyId),
    eq(engagementSurveys.organizationId, organizationId),
  )).limit(1);
  if (!survey || survey.status !== "open") return Response.json({ error: "Survey is not open." }, { status: 409 });
  if (survey.audienceOrgUnitId !== null && survey.audienceOrgUnitId !== employee.orgUnitId) {
    return Response.json({ error: "This survey is not assigned to your organization unit." }, { status: 403 });
  }
  const now = new Date();
  if (survey.opensAt && new Date(survey.opensAt).getTime() > now.getTime()) {
    return Response.json({ error: "Survey has not opened yet." }, { status: 409 });
  }
  if (survey.closesAt && new Date(survey.closesAt).getTime() <= now.getTime()) {
    return Response.json({ error: "Survey is closed." }, { status: 409 });
  }

  let key: string;
  try {
    key = respondentKey(survey, user.id);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Anonymous survey security is not configured." }, { status: 503 });
  }

  const [existing] = await db.select({ id: engagementResponses.id }).from(engagementResponses).where(and(
    eq(engagementResponses.surveyId, survey.id),
    eq(engagementResponses.respondentKey, key),
  )).limit(1);
  if (existing) return Response.json({ error: "You already responded to this survey." }, { status: 409 });

  const questions = await db.select().from(engagementQuestions).where(and(
    eq(engagementQuestions.organizationId, organizationId),
    eq(engagementQuestions.surveyId, survey.id),
  )).orderBy(engagementQuestions.sortOrder, engagementQuestions.id);
  if (questions.length === 0) return Response.json({ error: "Survey has no questions." }, { status: 409 });

  const answerByQuestion = new Map<number, SubmittedAnswer>();
  for (const raw of submitted) {
    const questionId = Number(raw?.questionId);
    if (!Number.isInteger(questionId) || answerByQuestion.has(questionId)) {
      return Response.json({ error: "Each answer must reference one survey question exactly once." }, { status: 400 });
    }
    answerByQuestion.set(questionId, raw);
  }
  if ([...answerByQuestion.keys()].some((questionId) => !questions.some((question) => question.id === questionId))) {
    return Response.json({ error: "An answer references a question outside this survey." }, { status: 400 });
  }

  const values: Array<{ organizationId: number; responseId: number; questionId: number; numericValue: string | null; textValue: string | null }> = [];
  const normalized = [];
  for (const question of questions) {
    const raw = answerByQuestion.get(question.id);
    if (!raw) {
      if (question.required) return Response.json({ error: "Please answer every required survey question." }, { status: 400 });
      continue;
    }

    if (question.type === "rating_1_5") {
      const value = Number(raw.numericValue);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        return Response.json({ error: "Rating answers must be whole numbers from 1 to 5." }, { status: 400 });
      }
      normalized.push({ questionId: question.id, numericValue: value.toFixed(2), textValue: null });
      continue;
    }

    if (question.type === "enps_0_10") {
      const value = Number(raw.numericValue);
      if (!Number.isInteger(value) || value < 0 || value > 10) {
        return Response.json({ error: "eNPS answers must be whole numbers from 0 to 10." }, { status: 400 });
      }
      normalized.push({ questionId: question.id, numericValue: value.toFixed(2), textValue: null });
      continue;
    }

    if (question.type === "text") {
      const value = String(raw.textValue ?? "").trim();
      if (question.required && !value) return Response.json({ error: "Please answer every required survey question." }, { status: 400 });
      if (value.length > 2000) return Response.json({ error: "Text survey answers are limited to 2,000 characters." }, { status: 400 });
      if (value) normalized.push({ questionId: question.id, numericValue: null, textValue: value });
      continue;
    }

    return Response.json({ error: "Survey contains an unsupported question type." }, { status: 409 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [response] = await tx.insert(engagementResponses).values({
        organizationId,
        surveyId: survey.id,
        respondentKey: key,
        respondentUserId: survey.anonymous ? null : user.id,
        respondentEmployeeId: survey.anonymous ? null : employee.id,
        orgUnitIdSnapshot: employee.orgUnitId,
      }).returning();

      if (normalized.length > 0) {
        for (const answer of normalized) {
          values.push({ organizationId, responseId: response.id, ...answer });
        }
        await tx.insert(engagementAnswers).values(values);
      }
      return response;
    });

    // Deliberately no per-respondent audit event here. An audit record containing
    // actor + timestamp next to an anonymous submission would create a side
    // channel that weakens the privacy promise.
    return Response.json({
      ok: true,
      responseId: survey.anonymous ? null : result.id,
      anonymous: survey.anonymous,
      message: survey.anonymous
        ? "Anonymous response recorded. Your identity is not stored with the response."
        : "Response recorded.",
    }, { status: 201 });
  } catch {
    return Response.json({ error: "Response could not be recorded or was already submitted." }, { status: 409 });
  }
}
