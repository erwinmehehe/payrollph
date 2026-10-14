import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  engagementSurveyParticipants, legalEntities,
} from "@/db/schema";
import { assertMembership, getAccess, assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  closedSurveyDisclosure, closeEngagementSurvey, createEngagementSurveyWithAudit,
  listSurveysForTenant, submitAnonymousSurveyRating,
} from "@/lib/engagement-survey";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

// Preserve the existing one-open-survey conflict response without disguising
// an audit-storage failure as a duplicate survey. Drizzle may wrap PG errors.
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") return false;
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function guard(sessionId: number, organizationId: number) {
  const denied = await assertMembership(sessionId, organizationId);
  if (denied) return { denied };
  const access = await getAccess(sessionId, organizationId);
  if (!access) return { denied: Response.json({ error: "Forbidden." }, { status: 403 }) };
  const entities = await db.select({ id: legalEntities.id }).from(legalEntities)
    .where(eq(legalEntities.organizationId, organizationId)).limit(2);
  if (entities.length !== 1) return { denied: Response.json({
    error: "Surveys are limited to verified single-entity workspaces until entity-scoped privacy review.",
  }, { status: 409 }) };
  return { access };
}

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("engagementSurvey")) return Response.json({ error: "Not found." }, { status: 404 });
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const gate = await guard(session.id, organizationId);
  if (gate.denied) return gate.denied;
  const role = gate.access!.role;
  const canAdminister = ["owner", "admin", "hr"].includes(role) && gate.access!.companyWide;
  if (canAdminister) {
    const adminDenied = await assertOrganizationRole(
      session.id, organizationId, PEOPLE_ADMIN_ROLES, "People admin permission required.",
    );
    if (adminDenied) return adminDenied;
  }
  const canParticipate = role === "employee" && Number.isSafeInteger(session.employeeId) && Boolean(session.employeeId);
  if (!canAdminister && !canParticipate) return Response.json({ error: "Forbidden." }, { status: 403 });

  const surveys = await listSurveysForTenant(organizationId);
  const participated = canParticipate && surveys.length
    ? await db.select({ surveyId: engagementSurveyParticipants.surveyId })
        .from(engagementSurveyParticipants).where(and(
          eq(engagementSurveyParticipants.organizationId, organizationId),
          eq(engagementSurveyParticipants.employeeId, session.employeeId!),
          inArray(engagementSurveyParticipants.surveyId, surveys.map(s => s.id)),
        ))
    : [];
  const participatedIds = new Set(participated.map(row => row.surveyId));
  return Response.json({
    admin: canAdminister,
    surveys: surveys.map(survey => ({
      id: survey.id,
      ...closedSurveyDisclosure(survey),
      // An employee sees only their own participation flag, no other worker data.
      ...(canParticipate ? { submitted: participatedIds.has(survey.id) } : {}),
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("engagementSurvey")) return Response.json({ error: "Not found." }, { status: 404 });
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const gate = await guard(session.id, organizationId);
  if (gate.denied) return gate.denied;
  const action = String(body.action ?? "");
  if (!["answer", "create", "close"].includes(action)) {
    return Response.json({ error: "Unknown survey action." }, { status: 400 });
  }
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "engagement-survey-"+action,
    resourceId: organizationId, limit: 15, windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;
  if (action === "answer") {
    if (gate.access!.role !== "employee" || !session.employeeId) {
      return Response.json({ error: "Only linked employee accounts can submit a response." }, { status: 403 });
    }
    const surveyId = Number(body.surveyId);
    const score = Number(body.score);
    if (!Number.isSafeInteger(surveyId) || surveyId <= 0 || !Number.isInteger(score) || score < 1 || score > 5) {
      return Response.json({ error: "Valid survey and rating from 1 to 5 required." }, { status: 400 });
    }
    const result = await submitAnonymousSurveyRating({
      organizationId, surveyId, employeeId: session.employeeId, score,
    });
    if (!result.accepted) return Response.json({
      error: result.reason === "already_submitted" ? "You have already participated." : "Survey is not accepting answers.",
    }, { status: 409 });
    return Response.json({ submitted: true }, { status: 201 });
  }

  const deniedAdmin = await assertOrganizationRole(
    session.id, organizationId, PEOPLE_ADMIN_ROLES, "People admin role required.",
  );
  if (deniedAdmin) return deniedAdmin;
  if (!gate.access!.companyWide || !["owner", "admin", "hr"].includes(gate.access!.role)) {
    return Response.json({ error: "Company-wide People administration required." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;

  if (action === "create") {
    const question = String(body.question ?? "How would you rate your overall work experience?").trim();
    if (question.length < 10 || question.length > 240) {
      return Response.json({ error: "Question must be 10-240 characters." }, { status: 422 });
    }
    try {
      const survey = await createEngagementSurveyWithAudit({
        organizationId, question, createdByUserId: session.id, actor: session.name,
      });
      return Response.json({ id: survey.id, status: "open" }, { status: 201 });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return Response.json({ error: "Only one open survey is allowed for this workspace." }, { status: 409 });
      }
      return Response.json({ error: "Survey could not be safely created." }, { status: 503 });
    }
  }
  if (action === "close") {
    const surveyId = Number(body.surveyId);
    if (!Number.isSafeInteger(surveyId) || surveyId <= 0) return Response.json({ error: "Valid survey required." }, { status: 400 });
    let closed: boolean;
    try {
      closed = await closeEngagementSurvey(organizationId, surveyId, {
        actor: session.name, actorUserId: session.id,
      });
    } catch {
      return Response.json({ error: "Survey could not be safely closed." }, { status: 503 });
    }
    if (!closed) return Response.json({ error: "Survey not found or already closed." }, { status: 409 });
    return Response.json({ id: surveyId, status: "closed" });
  }
  return Response.json({ error: "Unknown survey action." }, { status: 400 });
}
