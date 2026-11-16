/**
 * QUARANTINED SOURCE-ONLY: NO src/app registration or tenant method credit.
 * Two different uninvolved company-wide owner/admin users must request and
 * authorize an active investigator/reviewer transfer; reporters and officers
 * never lose access merely because an admin makes a unilateral change.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { userOrganizations, users } from "@/db/schema";
import {
  workplaceCaseAuditTrail, workplaceCaseOfficers,
  workplaceCaseReassignmentRequests, workplaceProtectedCases,
} from "@/db/workplace-compliance-schema";
import { getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { workplaceAdmin, workplaceFeatureEnabled, workplacePrivateHeaders, workplaceNotFound } from "@/lib/ph-workplace-context";
import { isOneOf, positiveId } from "@/lib/ph-workplace-compliance-policy";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const OFFICER_ROLES = ["investigator", "reviewer"] as const;
const ALLOWED_DECISIONS = ["approve", "reject"] as const;
const denied = () => workplaceNotFound();
const conflict = () => Response.json({
  error: "Independent case reassignment denied. Verify both authorizers, current assignments and active officers.",
}, { status: 409, headers: workplacePrivateHeaders });

function independentCaseAdmin(
  actorId: number, creatorId: number, investigatorId: number, reviewerId: number | null,
  replacementId: number,
) {
  return ![creatorId, investigatorId, reviewerId, replacementId].includes(actorId);
}
function newOfficerCanServe(
  creatorId: number, investigatorId: number, reviewerId: number | null,
  priorId: number, replacementId: number,
) {
  return replacementId !== priorId && replacementId !== creatorId &&
    replacementId !== investigatorId && replacementId !== reviewerId;
}
async function independentOwnerAdmin(userId: number, organizationId: number) {
  const scope = await workplaceAdmin(userId, organizationId);
  if (scope.denied) return { denied: scope.denied, legalEntityId: null };
  const role = await getAccess(userId, organizationId);
  if (!role?.companyWide || !["owner", "admin"].includes(role.role)) {
    return { denied: Response.json({ error: "Separate company-wide owner/admin authorization required." },
      { status: 403, headers: workplacePrivateHeaders }), legalEntityId: null };
  }
  return { denied: null, legalEntityId: scope.legalEntityId };
}
async function verifiedReplacement(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number, legalEntityId: number, replacementId: number,
) {
  const [officer] = await tx.select({ userId: workplaceCaseOfficers.userId })
    .from(workplaceCaseOfficers)
    .innerJoin(users, eq(users.id, workplaceCaseOfficers.userId))
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.userId, workplaceCaseOfficers.userId),
      eq(userOrganizations.organizationId, workplaceCaseOfficers.organizationId),
    ))
    .where(and(
      eq(workplaceCaseOfficers.organizationId, organizationId),
      eq(workplaceCaseOfficers.legalEntityId, legalEntityId),
      eq(workplaceCaseOfficers.userId, replacementId), eq(workplaceCaseOfficers.active, true),
      eq(users.active, true), eq(userOrganizations.active, true),
    )).for("update").limit(1);
  return !!officer;
}

/** Owner/admin only; no allegation text, case type or reporter identity. */
export async function GET(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return denied();
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = positiveId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const scope = await independentOwnerAdmin(session.id, organizationId);
  if (scope.denied) return scope.denied;
  const mfa = requireSensitiveActionMfa(session);
  if (mfa) return mfa;
  const rows = await db.select({
    id: workplaceCaseReassignmentRequests.id, caseId: workplaceCaseReassignmentRequests.caseId,
    officerRole: workplaceCaseReassignmentRequests.officerRole,
    previousOfficerUserId: workplaceCaseReassignmentRequests.previousOfficerUserId,
    replacementOfficerUserId: workplaceCaseReassignmentRequests.replacementOfficerUserId,
    requestedByUserId: workplaceCaseReassignmentRequests.requestedByUserId,
    status: workplaceCaseReassignmentRequests.status,
    createdAt: workplaceCaseReassignmentRequests.createdAt,
  }).from(workplaceCaseReassignmentRequests).where(and(
    eq(workplaceCaseReassignmentRequests.organizationId, organizationId),
    eq(workplaceCaseReassignmentRequests.legalEntityId, scope.legalEntityId!),
    eq(workplaceCaseReassignmentRequests.status, "pending"),
  )).orderBy(desc(workplaceCaseReassignmentRequests.createdAt)).limit(50);
  return Response.json({ pending: rows, privateCaseStatementsIncluded: false },
    { headers: workplacePrivateHeaders });
}

/** First of two distinct owner/admin signatures, stored for independent approval. */
export async function POST(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return denied();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(session.email, "Requesting restricted case officer transfer");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const caseId = positiveId(body.caseId);
  const replacementId = positiveId(body.replacementOfficerUserId);
  if (!organizationId || !caseId || !replacementId || !isOneOf(body.officerRole, OFFICER_ROLES)) {
    return Response.json({ error: "Valid employer, case, officer role and proposed replacement required." },
      { status: 400, headers: workplacePrivateHeaders });
  }
  const scope = await independentOwnerAdmin(session.id, organizationId);
  if (scope.denied) return scope.denied;
  const mfa = requireSensitiveActionMfa(session);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "ph-case-transfer-request", resourceId: caseId, limit: 5, windowMs: 300_000,
  });
  if (rate) return rate;
  try {
    const row = await db.transaction(async tx => {
      const [caseRow] = await tx.select().from(workplaceProtectedCases).where(and(
        eq(workplaceProtectedCases.id, caseId), eq(workplaceProtectedCases.organizationId, organizationId),
        eq(workplaceProtectedCases.legalEntityId, scope.legalEntityId!),
      )).for("update").limit(1);
      if (!caseRow || caseRow.status === "closed") throw new Error("CASE_NOT_ELIGIBLE");
      if (body.officerRole === "investigator" && caseRow.status === "review_pending") {
        throw new Error("CASE_STAGE_LOCKED");
      }
      const previousId = body.officerRole === "investigator"
        ? caseRow.investigatorUserId : caseRow.reviewerUserId;
      if (!previousId || !independentCaseAdmin(
        session.id, caseRow.createdByUserId, caseRow.investigatorUserId,
        caseRow.reviewerUserId, replacementId,
      ) || !newOfficerCanServe(
        caseRow.createdByUserId, caseRow.investigatorUserId,
        caseRow.reviewerUserId, previousId, replacementId,
      )) throw new Error("CASE_CONFLICT");
      if (!await verifiedReplacement(tx, organizationId, scope.legalEntityId!, replacementId)) {
        throw new Error("OFFICER_INACTIVE");
      }
      const [created] = await tx.insert(workplaceCaseReassignmentRequests).values({
        organizationId, legalEntityId: scope.legalEntityId!, caseId,
        officerRole: body.officerRole as string, previousOfficerUserId: previousId,
        replacementOfficerUserId: replacementId, requestedByUserId: session.id,
        status: "pending",
      }).returning();
      await tx.insert(workplaceCaseAuditTrail).values({
        organizationId, legalEntityId: scope.legalEntityId!, caseId,
        actorUserId: session.id, action: "reassignment_requested",
        previousOfficerUserId: previousId, replacementOfficerUserId: replacementId,
      });
      await recordAuditEvent({
        organizationId, actor: "confidential-case-administration",
        action: "Protected case officer transfer requested", resource: String(caseId),
        metadata: { caseId, requestId: created.id, private: true },
      }, tx);
      return { id: created.id, status: created.status };
    });
    return Response.json({ request: row, applied: false, requiresSecondOwnerAdmin: true },
      { status: 201, headers: workplacePrivateHeaders });
  } catch { return conflict(); }
}

/** A distinct uninvolved owner/admin approves or rejects without reading the allegation. */
export async function PATCH(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return denied();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(session.email, "Approving restricted case officer transfer");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const requestId = positiveId(body.id);
  if (!organizationId || !requestId || !isOneOf(body.action, ALLOWED_DECISIONS)) {
    return Response.json({ error: "Valid employer, pending request and approve/reject decision required." },
      { status: 400, headers: workplacePrivateHeaders });
  }
  const scope = await independentOwnerAdmin(session.id, organizationId);
  if (scope.denied) return scope.denied;
  const mfa = requireSensitiveActionMfa(session);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "ph-case-transfer-review", resourceId: requestId, limit: 5, windowMs: 300_000,
  });
  if (rate) return rate;
  try {
    const result = await db.transaction(async tx => {
      const [record] = await tx.select().from(workplaceCaseReassignmentRequests).where(and(
        eq(workplaceCaseReassignmentRequests.id, requestId),
        eq(workplaceCaseReassignmentRequests.organizationId, organizationId),
        eq(workplaceCaseReassignmentRequests.legalEntityId, scope.legalEntityId!),
      )).for("update").limit(1);
      if (!record || record.status !== "pending" || session.id === record.requestedByUserId) {
        throw new Error("INVALID_SECOND_SIGNER");
      }
      const [caseRow] = await tx.select().from(workplaceProtectedCases).where(and(
        eq(workplaceProtectedCases.id, record.caseId),
        eq(workplaceProtectedCases.organizationId, organizationId),
        eq(workplaceProtectedCases.legalEntityId, scope.legalEntityId!),
      )).for("update").limit(1);
      if (!caseRow || caseRow.status === "closed" || !independentCaseAdmin(
        session.id, caseRow.createdByUserId, caseRow.investigatorUserId,
        caseRow.reviewerUserId, record.replacementOfficerUserId,
      )) throw new Error("CASE_CONFLICT");
      if (body.action === "approve") {
        if (record.officerRole === "investigator" && caseRow.status === "review_pending") {
          throw new Error("STAGE_NOT_ELIGIBLE");
        }
        const current = record.officerRole === "investigator"
          ? caseRow.investigatorUserId : caseRow.reviewerUserId;
        if (current !== record.previousOfficerUserId ||
          !newOfficerCanServe(
            caseRow.createdByUserId, caseRow.investigatorUserId, caseRow.reviewerUserId,
            record.previousOfficerUserId, record.replacementOfficerUserId,
          ) || !await verifiedReplacement(
            tx, organizationId, scope.legalEntityId!, record.replacementOfficerUserId,
          )) throw new Error("STALE_OR_REVOKED");
        const update = record.officerRole === "investigator"
          ? { investigatorUserId: record.replacementOfficerUserId, updatedAt: new Date() }
          : { reviewerUserId: record.replacementOfficerUserId, updatedAt: new Date() };
        await tx.update(workplaceProtectedCases).set(update).where(and(
          eq(workplaceProtectedCases.id, record.caseId),
          eq(workplaceProtectedCases.organizationId, organizationId),
          eq(workplaceProtectedCases.legalEntityId, scope.legalEntityId!),
        ));
      }
      const [decided] = await tx.update(workplaceCaseReassignmentRequests).set({
        status: body.action === "approve" ? "approved" : "rejected",
        approvedByUserId: session.id, approvedAt: new Date(),
      }).where(eq(workplaceCaseReassignmentRequests.id, record.id)).returning();
      await tx.insert(workplaceCaseAuditTrail).values({
        organizationId, legalEntityId: scope.legalEntityId!, caseId: record.caseId,
        actorUserId: session.id,
        action: body.action === "approve" ? "reassignment_approved" : "reassignment_rejected",
        previousOfficerUserId: record.previousOfficerUserId,
        replacementOfficerUserId: record.replacementOfficerUserId,
      });
      await recordAuditEvent({
        organizationId, actor: "confidential-case-administration",
        action: "Protected case officer transfer decision recorded", resource: String(record.caseId),
        metadata: { caseId: record.caseId, requestId: record.id, decision: decided.status, private: true },
      }, tx);
      return { id: decided.id, status: decided.status, applied: decided.status === "approved" };
    });
    return Response.json({ request: result, independentSecondSigner: true },
      { headers: workplacePrivateHeaders });
  } catch { return conflict(); }
}
