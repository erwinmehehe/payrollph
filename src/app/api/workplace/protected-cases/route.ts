import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { userOrganizations, users } from "@/db/schema";
import { workplaceCaseOfficers, workplaceProtectedCases } from "@/db/workplace-compliance-schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  workplaceFeatureEnabled, workplaceMember, linkedWorkplaceEmployee,
  workplacePrivateHeaders, workplaceNotFound,
} from "@/lib/ph-workplace-context";
import {
  PROTECTED_CASE_KINDS, PROTECTED_CASE_STATES, isOneOf, positiveId, phCivilDate,
  sha256Digest, mayReadProtectedCase, mayTransitionProtectedCase,
} from "@/lib/ph-workplace-compliance-policy";
import { sealWorkplaceStatement, openWorkplaceStatement } from "@/lib/ph-workplace-statement-crypto";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
const noAccess = () => Response.json({ error: "Not found." }, { status: 404 });
type CaseRow = typeof workplaceProtectedCases.$inferSelect;

async function appointedOfficer(userId: number, organizationId: number, legalEntityId: number) {
  const [row] = await db.select({ userId: workplaceCaseOfficers.userId }).from(workplaceCaseOfficers)
    .innerJoin(users, eq(users.id, workplaceCaseOfficers.userId))
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.userId, workplaceCaseOfficers.userId),
      eq(userOrganizations.organizationId, workplaceCaseOfficers.organizationId),
    ))
    .where(and(eq(workplaceCaseOfficers.organizationId, organizationId),
      eq(workplaceCaseOfficers.legalEntityId, legalEntityId),
      eq(workplaceCaseOfficers.userId, userId), eq(workplaceCaseOfficers.active, true),
      eq(users.active, true), eq(userOrganizations.active, true))).limit(1);
  return !!row;
}
function presentCase(row: CaseRow) {
  return {
    id: row.id, organizationId: row.organizationId, legalEntityId: row.legalEntityId,
    caseKind: row.caseKind, createdByUserId: row.createdByUserId,
    reporterEmployeeId: row.reporterEmployeeId, investigatorUserId: row.investigatorUserId,
    reviewerUserId: row.reviewerUserId, status: row.status, incidentOn: row.incidentOn,
    externalEvidenceSha256: row.externalEvidenceSha256, createdAt: row.createdAt, updatedAt: row.updatedAt,
    statement: openWorkplaceStatement(row.sealedStatement),
  };
}

export async function GET(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return noAccess();
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = positiveId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const scope = await workplaceMember(session.id, organizationId);
  if (scope.denied) return scope.denied;
  if (session.role === "employee" &&
    !await linkedWorkplaceEmployee(session.id, session.employeeId, organizationId)) return workplaceNotFound();
  const legalEntityId = scope.legalEntityId!;
  const officer = await appointedOfficer(session.id, organizationId, legalEntityId);
  const rolePredicate = officer
    ? or(eq(workplaceProtectedCases.createdByUserId, session.id),
      eq(workplaceProtectedCases.investigatorUserId, session.id),
      eq(workplaceProtectedCases.reviewerUserId, session.id))
    : eq(workplaceProtectedCases.createdByUserId, session.id);
  const params = new URL(request.url).searchParams;
  const caseSelectors = params.getAll("caseId");
  if (caseSelectors.length > 1 || (caseSelectors.length === 1 && !positiveId(caseSelectors[0]))) {
    return Response.json({ error: "One valid caseId required." }, { status: 400, headers: workplacePrivateHeaders });
  }
  const requestedCaseId = caseSelectors.length ? positiveId(caseSelectors[0]) : null;
  // List views are metadata-only. Decrypt a single statement ONLY on a
  // deliberate authenticated case-detail request; never bulk-prefetch allegations.
  if (requestedCaseId) {
    if (session.role !== "employee") {
      const mfa = requireSensitiveActionMfa(session);
      if (mfa) return mfa;
    }
    const limit = await enforceSensitiveActionRateLimit(request, {
      userId: session.id, action: "ph-protected-case-private-read",
      resourceId: requestedCaseId, limit: 20, windowMs: 300_000,
    });
    if (limit) return limit;
  }
  const records = await db.select().from(workplaceProtectedCases).where(and(
    eq(workplaceProtectedCases.organizationId, organizationId),
    eq(workplaceProtectedCases.legalEntityId, legalEntityId), rolePredicate,
    requestedCaseId ? eq(workplaceProtectedCases.id, requestedCaseId) : undefined,
  )).orderBy(desc(workplaceProtectedCases.createdAt)).limit(requestedCaseId ? 1 : 50);
  const authorized = records.filter(row => mayReadProtectedCase({
    viewerId: session.id, creatorId: row.createdByUserId,
    investigatorId: officer ? row.investigatorUserId : -1,
    reviewerId: officer ? row.reviewerUserId : null,
  }));
  if (requestedCaseId && authorized.length !== 1) return workplaceNotFound();
  try {
    return Response.json({
      cases: requestedCaseId
        ? authorized.map(presentCase)
        : authorized.map(row => ({
          id: row.id, organizationId: row.organizationId, legalEntityId: row.legalEntityId,
          caseKind: row.caseKind, createdByUserId: row.createdByUserId,
          reporterEmployeeId: row.reporterEmployeeId,
          investigatorUserId: row.investigatorUserId, reviewerUserId: row.reviewerUserId,
          status: row.status, incidentOn: row.incidentOn, createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      note: "Private case intake and process record only. Neither an automated CODI determination nor a legal outcome.",
    }, { headers: workplacePrivateHeaders });
  } catch {
    return Response.json({ error: "Confidential case records could not be decrypted safely." },
      { status: 503, headers: workplacePrivateHeaders });
  }
}

export async function POST(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(session.email, "Submitting a protected workplace complaint");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const investigatorUserId = positiveId(body.investigatorUserId);
  const incidentOn = body.incidentOn == null || body.incidentOn === "" ? null : phCivilDate(body.incidentOn);
  const statement = typeof body.statement === "string" ? body.statement : "";
  if (!organizationId || !investigatorUserId ||
    !isOneOf(body.caseKind, PROTECTED_CASE_KINDS) ||
    statement.trim().length < 20 || statement.length > 4000 ||
    (body.incidentOn != null && body.incidentOn !== "" && !incidentOn)) {
    return Response.json({ error: "A valid employer, case type, appointed investigator and 20–4000 character statement are required." },
      { status: 400 });
  }
  const scope = await workplaceMember(session.id, organizationId);
  if (scope.denied) return scope.denied;
  const worker = session.role === "employee"
    ? await linkedWorkplaceEmployee(session.id, session.employeeId, organizationId) : null;
  if (session.role === "employee" && !worker) return workplaceNotFound();
  if (worker && worker.legalEntityId !== scope.legalEntityId) return workplaceNotFound();
  if (session.id === investigatorUserId ||
    !await appointedOfficer(investigatorUserId, organizationId, scope.legalEntityId!)) {
    return Response.json({ error: "Select an active, separately appointed intake officer." }, { status: 403 });
  }
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "ph-confidential-complaint-intake", resourceId: organizationId,
    limit: 5, windowMs: 60 * 60_000,
  });
  if (rate) return rate;
  let sealedStatement: string;
  try { sealedStatement = sealWorkplaceStatement(statement); }
  catch { return Response.json({ error: "Private case encryption unavailable. No statement was stored." },
    { status: 503, headers: workplacePrivateHeaders }); }
  let row: { id: number; status: string };
  try {
    row = await db.transaction(async tx => {
    // Serialize complaint intake with officer revocation. A revoked officer
    // must never become the only intake destination through a race.
    const [intakeOfficer] = await tx.select({ userId: workplaceCaseOfficers.userId })
      .from(workplaceCaseOfficers)
      .innerJoin(users, eq(users.id, workplaceCaseOfficers.userId))
      .innerJoin(userOrganizations, and(
        eq(userOrganizations.userId, workplaceCaseOfficers.userId),
        eq(userOrganizations.organizationId, workplaceCaseOfficers.organizationId),
      ))
      .where(and(
        eq(workplaceCaseOfficers.organizationId, organizationId),
        eq(workplaceCaseOfficers.legalEntityId, scope.legalEntityId!),
        eq(workplaceCaseOfficers.userId, investigatorUserId),
        eq(workplaceCaseOfficers.active, true),
        eq(users.active, true), eq(userOrganizations.active, true),
      )).for("update").limit(1);
    if (!intakeOfficer) throw new Error("INTAKE_OFFICER_UNAVAILABLE");
    const [record] = await tx.insert(workplaceProtectedCases).values({
      organizationId, legalEntityId: scope.legalEntityId!,
      caseKind: body.caseKind as string, createdByUserId: session.id,
      reporterEmployeeId: worker?.id ?? null, investigatorUserId, sealedStatement, incidentOn,
    }).returning();
    // Never audit allegation text, the protected category or identity details.
    await recordAuditEvent({
      organizationId, actor: "confidential-case-intake",
      action: "Confidential workplace case received",
      resource: String(record.id),
      metadata: { caseId: record.id, legalEntityId: record.legalEntityId, private: true, status: "intake" },
    }, tx);
    return { id: record.id, status: record.status };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INTAKE_OFFICER_UNAVAILABLE") {
      return Response.json({ error: "Selected independent intake officer is no longer available. Choose another approved officer." },
        { status: 409, headers: workplacePrivateHeaders });
    }
    return Response.json({ error: "Protected intake could not be committed safely. No complaint was stored." },
      { status: 503, headers: workplacePrivateHeaders });
  }
  return Response.json({ caseId: row.id, status: row.status, intakeRecorded: true,
    guidance: "Contact the employer's designated independent complaint channel for urgent safety and legal assistance.",
  }, { status: 201, headers: workplacePrivateHeaders });
}

export async function PATCH(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(session.email, "Managing protected workplace case review");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const id = positiveId(body.id);
  if (!organizationId || !id || !["assign_reviewer", "transition"].includes(String(body.action))) {
    return Response.json({ error: "Valid employer, case and action required." }, { status: 400 });
  }
  if (body.action === "transition" &&
    (!isOneOf(body.status, PROTECTED_CASE_STATES) || body.status === "intake")) {
    return Response.json({ error: "Valid next case status required." }, { status: 400 });
  }
  const scope = await workplaceMember(session.id, organizationId);
  if (scope.denied) return scope.denied;
  if (!await appointedOfficer(session.id, organizationId, scope.legalEntityId!)) return workplaceNotFound();
  const mfa = requireSensitiveActionMfa(session);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "ph-protected-case-decision", resourceId: id, limit: 15, windowMs: 300_000,
  });
  if (rate) return rate;
  const newReviewerId = body.action === "assign_reviewer" ? positiveId(body.reviewerUserId) : null;
  if (body.action === "assign_reviewer" && (!newReviewerId ||
    !await appointedOfficer(newReviewerId, organizationId, scope.legalEntityId!))) {
    return Response.json({ error: "A separately appointed independent reviewer is required." }, { status: 400 });
  }
  const sha = body.evidenceSha256 == null || body.evidenceSha256 === "" ? null : sha256Digest(body.evidenceSha256);
  if (body.evidenceSha256 != null && body.evidenceSha256 !== "" && !sha) {
    return Response.json({ error: "Invalid SHA-256 evidence digest." }, { status: 400 });
  }
  try {
    const record = await db.transaction(async tx => {
      const [old] = await tx.select().from(workplaceProtectedCases).where(and(
        eq(workplaceProtectedCases.id, id), eq(workplaceProtectedCases.organizationId, organizationId),
        eq(workplaceProtectedCases.legalEntityId, scope.legalEntityId!),
      )).for("update").limit(1);
      if (!old) throw new Error("NOT_FOUND");
      let values: Partial<typeof workplaceProtectedCases.$inferInsert>;
      if (body.action === "assign_reviewer") {
        if (session.id !== old.investigatorUserId ||
          !["intake", "investigating"].includes(old.status) ||
          newReviewerId === old.createdByUserId || newReviewerId === old.investigatorUserId) {
          throw new Error("CONFLICT_OR_UNAUTHORIZED");
        }
        const [reviewer] = await tx.select({ userId: workplaceCaseOfficers.userId })
          .from(workplaceCaseOfficers)
          .innerJoin(users, eq(users.id, workplaceCaseOfficers.userId))
          .innerJoin(userOrganizations, and(
            eq(userOrganizations.userId, workplaceCaseOfficers.userId),
            eq(userOrganizations.organizationId, workplaceCaseOfficers.organizationId),
          ))
          .where(and(
            eq(workplaceCaseOfficers.organizationId, organizationId),
            eq(workplaceCaseOfficers.legalEntityId, scope.legalEntityId!),
            eq(workplaceCaseOfficers.userId, newReviewerId!),
            eq(workplaceCaseOfficers.active, true),
            eq(users.active, true), eq(userOrganizations.active, true),
          )).for("update").limit(1);
        if (!reviewer) throw new Error("REVIEWER_UNAVAILABLE");
        values = { reviewerUserId: newReviewerId!, updatedAt: new Date() };
      } else {
        const next = body.status as typeof PROTECTED_CASE_STATES[number];
        if (!mayTransitionProtectedCase({
          current: old.status as typeof PROTECTED_CASE_STATES[number], next, actorId: session.id,
          creatorId: old.createdByUserId, investigatorId: old.investigatorUserId,
          reviewerId: old.reviewerUserId,
        })) throw new Error("INVALID_TRANSITION");
        if (next === "closed" && !(sha || old.externalEvidenceSha256)) throw new Error("PROOF_REQUIRED");
        values = { status: next, externalEvidenceSha256: sha || old.externalEvidenceSha256,
          updatedAt: new Date() };
      }
      const [updated] = await tx.update(workplaceProtectedCases).set(values).where(and(
        eq(workplaceProtectedCases.id, id), eq(workplaceProtectedCases.organizationId, organizationId),
      )).returning();
      await recordAuditEvent({
        organizationId, actor: "confidential-case-review",
        action: "Protected workplace case state recorded",
        resource: String(id), metadata: { caseId: id, action: body.action, status: updated.status,
          independentReview: body.action === "transition" && body.status === "closed" },
      }, tx);
      return { id: updated.id, status: updated.status, reviewerUserId: updated.reviewerUserId };
    });
    return Response.json({ case: record, legalOutcomeCertified: false }, { headers: workplacePrivateHeaders });
  } catch (e) {
    return e instanceof Error && e.message === "NOT_FOUND" ? workplaceNotFound() :
      Response.json({ error: "Case action denied. Check case assignment, independent reviewer, status and protected evidence." },
        { status: 409, headers: workplacePrivateHeaders });
  }
}
