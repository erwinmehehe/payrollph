import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  continuousFeedback,
  employees,
  engagementActionPlans,
  engagementAnswers,
  engagementQuestions,
  engagementResponses,
  engagementSurveys,
  orgUnits,
  recognitionEvents,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import {
  average,
  engagementAnonymityConfigured,
  enpsSummary,
  normalizedPrivacyThreshold,
  reportableCohort,
} from "@/lib/engagement-privacy";

export const dynamic = "force-dynamic";

const SURVEY_KINDS = ["pulse", "enps", "onboarding", "exit", "lifecycle", "custom"] as const;
const QUESTION_TYPES = ["rating_1_5", "enps_0_10", "text"] as const;
const ACTION_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
const FEEDBACK_KINDS = ["praise", "coaching", "check_in"] as const;

function validDate(value: string | null) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTimestamp(value: string | null) {
  if (!value) return true;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}

async function surveyForScope(userId: number, organizationId: number, surveyId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  const [survey] = await db.select().from(engagementSurveys).where(and(
    eq(engagementSurveys.id, surveyId),
    eq(engagementSurveys.organizationId, organizationId),
  )).limit(1);
  if (!survey) return { error: Response.json({ error: "Survey not found in this workspace." }, { status: 404 }) };
  if (!access.companyWide && survey.audienceOrgUnitId !== null && survey.audienceOrgUnitId !== access.orgUnitId) {
    return { error: Response.json({ error: "That survey is outside your assigned organization unit." }, { status: 403 }) };
  }
  return { access, survey };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to view employee-listening analytics.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [surveyRows, questionRows, responseRows, answerRows, plans, recognitionRows, feedbackRows, staff, units] = await Promise.all([
    db.select().from(engagementSurveys).where(eq(engagementSurveys.organizationId, organizationId)).orderBy(desc(engagementSurveys.id)),
    db.select().from(engagementQuestions).where(eq(engagementQuestions.organizationId, organizationId)).orderBy(engagementQuestions.sortOrder),
    db.select().from(engagementResponses).where(eq(engagementResponses.organizationId, organizationId)),
    db.select().from(engagementAnswers).where(eq(engagementAnswers.organizationId, organizationId)),
    db.select().from(engagementActionPlans).where(eq(engagementActionPlans.organizationId, organizationId)).orderBy(desc(engagementActionPlans.id)),
    db.select().from(recognitionEvents).where(eq(recognitionEvents.organizationId, organizationId)).orderBy(desc(recognitionEvents.id)).limit(100),
    db.select().from(continuousFeedback).where(eq(continuousFeedback.organizationId, organizationId)).orderBy(desc(continuousFeedback.id)).limit(100),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
  ]);

  const visibleStaff = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleStaff.map((employee) => employee.id));
  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));
  const visibleSurveys = surveyRows.filter((survey) => {
    if (access.companyWide) return true;
    return survey.audienceOrgUnitId === null || survey.audienceOrgUnitId === access.orgUnitId;
  });

  const surveyAnalytics = visibleSurveys.map((survey) => {
    const threshold = normalizedPrivacyThreshold(survey.privacyThreshold);
    const questions = questionRows.filter((question) => question.surveyId === survey.id);
    const scopeResponses = responseRows.filter((response) =>
      response.surveyId === survey.id
      && (access.companyWide || response.orgUnitIdSnapshot === access.orgUnitId)
    );
    const responseIds = new Set(scopeResponses.map((response) => response.id));
    const answers = answerRows.filter((answer) => responseIds.has(answer.responseId));
    const reportable = reportableCohort(scopeResponses.length, threshold);

    const questionAnalytics = questions.map((question) => {
      const questionAnswers = answers.filter((answer) => answer.questionId === question.id);
      const numeric = questionAnswers
        .map((answer) => answer.numericValue === null ? null : Number(answer.numericValue))
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const textCount = questionAnswers.filter((answer) => Boolean(answer.textValue?.trim())).length;
      if (!reportable) {
        return {
          id: question.id,
          prompt: question.prompt,
          type: question.type,
          required: question.required,
          responseCount: null,
          suppressed: true,
          average: null,
          enps: null,
          textResponseCount: null,
          comments: [],
        };
      }

      const canSeeIdentifiableComments =
        !survey.anonymous
        && access.companyWide
        && (PEOPLE_ADMIN_ROLES as readonly string[]).includes(access.role);
      const comments = canSeeIdentifiableComments && question.type === "text"
        ? questionAnswers
            .filter((answer) => Boolean(answer.textValue?.trim()))
            .slice(0, 50)
            .map((answer) => {
              const response = scopeResponses.find((candidate) => candidate.id === answer.responseId);
              const employee = response?.respondentEmployeeId ? employeeById.get(response.respondentEmployeeId) : null;
              return {
                employeeId: employee?.id ?? null,
                employeeName: employee ? employee.firstName + " " + employee.lastName : "Identified respondent",
                text: answer.textValue,
              };
            })
        : [];

      return {
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        required: question.required,
        responseCount: questionAnswers.length,
        suppressed: false,
        average: question.type === "rating_1_5" ? average(numeric) : null,
        enps: question.type === "enps_0_10" ? enpsSummary(numeric) : null,
        textResponseCount: textCount,
        comments,
      };
    });

    const eligible = staff.filter((employee) =>
      employee.status === "Active"
      && (survey.audienceOrgUnitId === null || employee.orgUnitId === survey.audienceOrgUnitId)
      && (access.companyWide || employee.orgUnitId === access.orgUnitId)
    ).length;

    const unitBreakdown = access.companyWide
      ? units.map((unit) => {
          const rows = scopeResponses.filter((response) => response.orgUnitIdSnapshot === unit.id);
          const unitReportable = reportableCohort(rows.length, threshold);
          return {
            orgUnitId: unit.id,
            orgUnitName: unit.name,
            responseCount: unitReportable ? rows.length : null,
            reportable: unitReportable,
          };
        }).filter((row) => row.reportable)
      : [];

    return {
      ...survey,
      responseCount: access.companyWide || reportable ? scopeResponses.length : null,
      eligibleCount: access.companyWide || reportable ? eligible : null,
      responseRate: access.companyWide || reportable
        ? (eligible > 0 ? Math.round((scopeResponses.length / eligible) * 100) : 0)
        : null,
      reportable,
      suppressionReason: reportable ? null : `At least ${threshold} responses are required before results are shown.`,
      questions: questionAnalytics,
      unitBreakdown,
    };
  });

  return Response.json({
    anonymityConfigured: engagementAnonymityConfigured(),
    access,
    surveys: surveyAnalytics,
    actionPlans: plans.filter((plan) => access.companyWide || plan.orgUnitId === null || plan.orgUnitId === access.orgUnitId),
    recognition: recognitionRows.filter((row) =>
      row.visibleToEveryone
      && (access.companyWide || visibleEmployeeIds.has(row.recipientEmployeeId))
    ).map((row) => ({
      ...row,
      senderName: row.senderEmployeeId ? (() => {
        const employee = employeeById.get(row.senderEmployeeId);
        return employee ? employee.firstName + " " + employee.lastName : "Former employee";
      })() : "Company",
      recipientName: (() => {
        const employee = employeeById.get(row.recipientEmployeeId);
        return employee ? employee.firstName + " " + employee.lastName : "Employee";
      })(),
    })),
    feedback: feedbackRows.filter((row) =>
      visibleEmployeeIds.has(row.recipientEmployeeId)
    ).map((row) => ({
      ...row,
      authorName: row.authorEmployeeId ? (() => {
        const employee = employeeById.get(row.authorEmployeeId);
        return employee ? employee.firstName + " " + employee.lastName : "Manager";
      })() : "Manager",
      recipientName: (() => {
        const employee = employeeById.get(row.recipientEmployeeId);
        return employee ? employee.firstName + " " + employee.lastName : "Employee";
      })(),
    })),
    employees: visibleStaff.map((employee) => ({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      title: employee.title,
      orgUnitId: employee.orgUnitId,
      status: employee.status,
    })),
    orgUnits: access.companyWide ? units : units.filter((unit) => unit.id === access.orgUnitId),
    privacy: {
      minimumThreshold: 5,
      anonymousTextPolicy: "Raw anonymous comments are never returned by the management analytics endpoint.",
    },
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
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to manage employee listening.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (entityType === "survey") {
    const name = String(body.name ?? "").trim();
    const kind = String(body.kind ?? "pulse");
    const anonymous = body.anonymous === undefined ? true : Boolean(body.anonymous);
    const threshold = normalizedPrivacyThreshold(body.privacyThreshold);
    const requestedUnitId = body.audienceOrgUnitId ? Number(body.audienceOrgUnitId) : null;
    const audienceOrgUnitId = access.companyWide ? requestedUnitId : access.orgUnitId;
    const closesAt = body.closesAt ? String(body.closesAt) : null;

    if (!name || !(SURVEY_KINDS as readonly string[]).includes(kind)) {
      return Response.json({ error: "Survey name and valid survey kind are required." }, { status: 400 });
    }
    if (!validTimestamp(closesAt)) return Response.json({ error: "closesAt must be a valid timestamp." }, { status: 400 });
    if (requestedUnitId && !access.companyWide && requestedUnitId !== access.orgUnitId) {
      return Response.json({ error: "You can create surveys only for your assigned organization unit." }, { status: 403 });
    }
    if (audienceOrgUnitId) {
      const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
        eq(orgUnits.id, audienceOrgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1);
      if (!unit) return Response.json({ error: "Survey audience organization unit not found." }, { status: 404 });
    }

    try {
      const [row] = await db.insert(engagementSurveys).values({
        organizationId,
        name: name.slice(0, 180),
        kind,
        status: "draft",
        anonymous,
        privacyThreshold: threshold,
        audienceOrgUnitId,
        closesAt: closesAt ? new Date(closesAt) : null,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Engagement survey drafted",
        resource: row.name,
        metadata: { surveyId: row.id, kind, anonymous, privacyThreshold: threshold, audienceOrgUnitId },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A survey with this name already exists." }, { status: 409 });
    }
  }

  if (entityType === "question") {
    const surveyId = Number(body.surveyId);
    const prompt = String(body.prompt ?? "").trim();
    const type = String(body.type ?? "rating_1_5");
    const sortOrder = Number(body.sortOrder ?? 0);
    if (!Number.isInteger(surveyId) || !prompt || !(QUESTION_TYPES as readonly string[]).includes(type) || !Number.isInteger(sortOrder)) {
      return Response.json({ error: "surveyId, prompt, valid question type, and integer sortOrder are required." }, { status: 400 });
    }
    const scoped = await surveyForScope(user.id, organizationId, surveyId);
    if ("error" in scoped) return scoped.error;
    if (!scoped.access.companyWide && scoped.survey.audienceOrgUnitId !== scoped.access.orgUnitId) {
      return Response.json({ error: "Unit-scoped managers cannot edit a company-wide survey." }, { status: 403 });
    }
    if (scoped.survey.status !== "draft") {
      return Response.json({ error: "Questions can only be changed while a survey is in draft." }, { status: 409 });
    }
    const [row] = await db.insert(engagementQuestions).values({
      organizationId,
      surveyId,
      prompt: prompt.slice(0, 500),
      type,
      required: body.required === undefined ? true : Boolean(body.required),
      sortOrder,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Engagement survey question added",
      resource: scoped.survey.name,
      metadata: { surveyId, questionId: row.id, type },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "action_plan") {
    const surveyId = Number(body.surveyId);
    const questionId = body.questionId ? Number(body.questionId) : null;
    const title = String(body.title ?? "").trim();
    const requestedUnitId = body.orgUnitId ? Number(body.orgUnitId) : null;
    const orgUnitId = access.companyWide ? requestedUnitId : access.orgUnitId;
    const ownerEmployeeId = body.ownerEmployeeId ? Number(body.ownerEmployeeId) : null;
    const dueDate = body.dueDate ? String(body.dueDate) : null;
    if (!Number.isInteger(surveyId) || !title || !validDate(dueDate)) {
      return Response.json({ error: "surveyId, title, and optional YYYY-MM-DD dueDate are required." }, { status: 400 });
    }
    const scoped = await surveyForScope(user.id, organizationId, surveyId);
    if ("error" in scoped) return scoped.error;
    if (questionId) {
      const [question] = await db.select({ id: engagementQuestions.id }).from(engagementQuestions).where(and(
        eq(engagementQuestions.id, questionId),
        eq(engagementQuestions.surveyId, surveyId),
        eq(engagementQuestions.organizationId, organizationId),
      )).limit(1);
      if (!question) return Response.json({ error: "Action-plan question is not part of this survey." }, { status: 409 });
    }
    if (ownerEmployeeId) {
      const [owner] = await db.select().from(employees).where(and(
        eq(employees.id, ownerEmployeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1);
      if (!owner) return Response.json({ error: "Action-plan owner not found." }, { status: 404 });
      const scope = assertScope(access, owner.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
      if (orgUnitId !== null && owner.orgUnitId !== orgUnitId) {
        return Response.json({ error: "Action-plan owner must belong to the selected organization unit." }, { status: 409 });
      }
    }

    const [row] = await db.insert(engagementActionPlans).values({
      organizationId,
      surveyId,
      questionId,
      orgUnitId,
      ownerEmployeeId,
      title: title.slice(0, 200),
      dueDate,
      status: "open",
      notes: body.notes ? String(body.notes).slice(0, 8000) : null,
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Engagement action plan created",
      resource: row.title,
      metadata: { actionPlanId: row.id, surveyId, questionId, orgUnitId, ownerEmployeeId },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "feedback") {
    const recipientEmployeeId = Number(body.recipientEmployeeId);
    const kind = String(body.kind ?? "coaching");
    const message = String(body.message ?? "").trim();
    if (!Number.isInteger(recipientEmployeeId) || !(FEEDBACK_KINDS as readonly string[]).includes(kind) || !message) {
      return Response.json({ error: "recipientEmployeeId, valid feedback kind, and message are required." }, { status: 400 });
    }
    const [recipient] = await db.select().from(employees).where(and(
      eq(employees.id, recipientEmployeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!recipient) return Response.json({ error: "Feedback recipient not found." }, { status: 404 });
    const scope = assertScope(access, recipient.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    let authorEmployeeId: number | null = null;
    if (user.employeeId) {
      const [author] = await db.select({ id: employees.id }).from(employees).where(and(
        eq(employees.id, user.employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1);
      authorEmployeeId = author?.id ?? null;
    }
    if (authorEmployeeId && authorEmployeeId === recipientEmployeeId) {
      return Response.json({ error: "Continuous feedback must be written for another employee." }, { status: 400 });
    }
    const [row] = await db.insert(continuousFeedback).values({
      organizationId,
      authorEmployeeId,
      recipientEmployeeId,
      kind,
      message: message.slice(0, 8000),
      visibility: "manager_and_recipient",
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Continuous feedback recorded",
      resource: recipient.firstName + " " + recipient.lastName,
      metadata: { feedbackId: row.id, recipientEmployeeId, kind },
    });
    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "entityType must be survey, question, action_plan, or feedback." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(user.id, organizationId, WORKFORCE_MANAGER_ROLES);
  if (denied) return denied;

  if (action === "open_survey" || action === "close_survey") {
    const surveyId = Number(body.surveyId);
    if (!Number.isInteger(surveyId)) return Response.json({ error: "surveyId is required." }, { status: 400 });
    const scoped = await surveyForScope(user.id, organizationId, surveyId);
    if ("error" in scoped) return scoped.error;
    const { access, survey } = scoped;
    if (!access.companyWide && survey.audienceOrgUnitId !== access.orgUnitId) {
      return Response.json({ error: "Unit-scoped managers cannot administer a company-wide survey." }, { status: 403 });
    }

    if (action === "close_survey") {
      if (survey.status !== "open") return Response.json({ error: "Only an open survey can be closed." }, { status: 409 });
      const [row] = await db.update(engagementSurveys).set({ status: "closed", closesAt: new Date(), updatedAt: new Date() })
        .where(eq(engagementSurveys.id, survey.id)).returning();
      await recordAuditEvent({ organizationId, actor: user.name, action: "Engagement survey closed", resource: survey.name, metadata: { surveyId } });
      return Response.json(row);
    }

    if (survey.status !== "draft") return Response.json({ error: "Only a draft survey can be opened." }, { status: 409 });
    if (survey.anonymous && !engagementAnonymityConfigured()) {
      return Response.json({ error: "Configure ENGAGEMENT_ANONYMITY_KEY with at least 32 bytes before opening an anonymous survey." }, { status: 503 });
    }
    const questions = await db.select().from(engagementQuestions).where(and(
      eq(engagementQuestions.organizationId, organizationId),
      eq(engagementQuestions.surveyId, surveyId),
    ));
    if (questions.length === 0) return Response.json({ error: "Add at least one survey question before opening the survey." }, { status: 409 });
    if (survey.kind === "enps" && !questions.some((question) => question.type === "enps_0_10")) {
      return Response.json({ error: "An eNPS survey must contain at least one eNPS 0-10 question." }, { status: 409 });
    }

    const threshold = normalizedPrivacyThreshold(survey.privacyThreshold);
    const eligible = survey.audienceOrgUnitId
      ? await db.select({ id: employees.id }).from(employees).where(and(
          eq(employees.organizationId, organizationId),
          eq(employees.status, "Active"),
          eq(employees.orgUnitId, survey.audienceOrgUnitId),
        ))
      : await db.select({ id: employees.id }).from(employees).where(and(
          eq(employees.organizationId, organizationId),
          eq(employees.status, "Active"),
        ));
    if (survey.anonymous && eligible.length < threshold) {
      return Response.json({
        error: `Anonymous survey cannot open because the eligible audience has ${eligible.length} employees; at least ${threshold} are required.`,
      }, { status: 409 });
    }
    if (!access.companyWide && survey.audienceOrgUnitId === null) {
      return Response.json({ error: "Unit-scoped managers cannot open a company-wide survey." }, { status: 403 });
    }
    if (survey.closesAt && new Date(survey.closesAt).getTime() <= Date.now()) {
      return Response.json({ error: "Survey close time must be in the future when the survey opens." }, { status: 409 });
    }

    const [row] = await db.update(engagementSurveys).set({
      status: "open",
      opensAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(engagementSurveys.id, survey.id)).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Engagement survey opened",
      resource: survey.name,
      metadata: { surveyId, anonymous: survey.anonymous, privacyThreshold: threshold, eligibleAudience: eligible.length },
    });
    return Response.json(row);
  }

  if (action === "action_plan_status") {
    const actionPlanId = Number(body.actionPlanId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(actionPlanId) || !(ACTION_STATUSES as readonly string[]).includes(status)) {
      return Response.json({ error: "actionPlanId and valid status are required." }, { status: 400 });
    }
    const access = await getAccess(user.id, organizationId);
    if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
    const [plan] = await db.select().from(engagementActionPlans).where(and(
      eq(engagementActionPlans.id, actionPlanId),
      eq(engagementActionPlans.organizationId, organizationId),
    )).limit(1);
    if (!plan) return Response.json({ error: "Action plan not found." }, { status: 404 });
    if (!access.companyWide && plan.orgUnitId !== access.orgUnitId) {
      return Response.json({ error: "That action plan is outside your assigned organization unit." }, { status: 403 });
    }
    const [row] = await db.update(engagementActionPlans).set({ status, updatedAt: new Date() })
      .where(eq(engagementActionPlans.id, actionPlanId)).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Engagement action plan status changed",
      resource: plan.title,
      metadata: { actionPlanId, status },
    });
    return Response.json(row);
  }

  return Response.json({ error: "action must be open_survey, close_survey, or action_plan_status." }, { status: 400 });
}
