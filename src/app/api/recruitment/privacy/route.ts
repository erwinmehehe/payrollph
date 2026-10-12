import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicantPrivacyEvidence, auditEvents, jobApplicants } from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  applicantPiiEraseValues, applicantErasureIndependentlyApproved, applicantPrivacyId, validApplicantPrivacyDecision,
} from "@/lib/recruitment-applicant-privacy";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" } as const;
const roles = ["owner", "admin"] as const;
const unavailable = () => Response.json({ error: "Applicant privacy actions are disabled." }, { status: 404 });

async function authorize(actorId: number, organizationId: number) {
  const denied = await assertOrganizationRole(actorId, organizationId, roles,
    "Only an authorized company privacy administrator can export or erase applicant data.");
  if (denied) return denied;
  const access = await getAccess(actorId, organizationId);
  return access?.companyWide ? null :
    Response.json({ error: "Company-wide privacy permission required." }, { status: 403 });
}

/** Staff-mediated candidate export after the DPO verifies the data subject's identity. */
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("applicantPrivacy")) return unavailable();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const organizationId = applicantPrivacyId(params.get("organizationId"));
  const applicantId = applicantPrivacyId(params.get("applicantId"));
  if (organizationId === null || applicantId === null) {
    return Response.json({ error: "Valid organizationId and applicantId required." }, { status: 400 });
  }
  const denied = await authorize(user.id, organizationId);
  if (denied) return denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "applicant-privacy-export", resourceId: applicantId,
    limit: 4, windowMs: 30 * 60_000,
  });
  if (rate) return rate;
  // Export and audit occur in one transaction: no unlogged PII disclosure.
  const payload = await db.transaction(async tx => {
    const [applicant] = await tx.select().from(jobApplicants).where(and(
      eq(jobApplicants.id, applicantId), eq(jobApplicants.organizationId, organizationId),
    )).limit(1);
    const [privacy] = await tx.select().from(applicantPrivacyEvidence).where(and(
      eq(applicantPrivacyEvidence.organizationId, organizationId),
      eq(applicantPrivacyEvidence.applicantId, applicantId),
    )).limit(1);
    if (!applicant || !privacy || privacy.purgedAt) return null;
    await tx.insert(auditEvents).values({
      organizationId, actor: user.name, action: "Candidate PII export generated",
      resource: "Applicant #" + applicantId,
      metadata: { applicantId, actorUserId: user.id, noticeVersion: privacy.privacyNoticeVersion },
    });
    // This is a protected operator export, not a public unauthenticated URL.
    return {
      applicant, privacy: {
        legalBasis: privacy.legalBasis,
        privacyNoticeVersion: privacy.privacyNoticeVersion,
        consentCapturedAt: privacy.consentCapturedAt,
        rejectedAt: privacy.rejectedAt,
        legalHold: privacy.legalHold,
      },
      retentionNotice: "Employment/payroll records of a hired worker are not deleted by a candidate request.",
    };
  });
  return payload ? Response.json(payload, { headers: noStore }) :
    Response.json({ error: "Applicant export unavailable or already erased." }, { status: 404, headers: noStore });
}

/** Three controlled actions: request -> independent review -> erase. */
export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("applicantPrivacy")) return unavailable();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Object request required." }, { status: 400, headers: noStore });
  }
  const organizationId = applicantPrivacyId(body.organizationId);
  const applicantId = applicantPrivacyId(body.applicantId);
  const action = String(body.action ?? "");
  if (organizationId === null || applicantId === null ||
      !["request_delete", "approve_delete", "erase"].includes(action)) {
    return Response.json({ error: "Valid organization, candidate and action required." }, { status: 400 });
  }
  const denied = await authorize(user.id, organizationId);
  if (denied) return denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "applicant-privacy-" + action, resourceId: applicantId,
    limit: 3, windowMs: 60 * 60_000,
  });
  if (rate) return rate;
  const reason = String(body.reason ?? "").trim();
  const evidence = String(body.reviewEvidenceReference ?? "").trim();
  if (action === "request_delete" &&
      (reason.length < 20 || reason.length > 500)) {
    return Response.json({ error: "Documented candidate request reason (20-500 characters) is required." }, { status: 422 });
  }
  if (action === "approve_delete" && !validApplicantPrivacyDecision(
    String(body.approvalReason ?? ""), evidence,
  )) {
    return Response.json({ error: "Reviewer decision and evidence reference are required." }, { status: 422 });
  }

  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM job_applicants WHERE id = ${applicantId}
      AND organization_id = ${organizationId} FOR UPDATE`);
    const [applicant] = await tx.select().from(jobApplicants).where(and(
      eq(jobApplicants.id, applicantId), eq(jobApplicants.organizationId, organizationId),
    )).limit(1);
    const [privacy] = await tx.select().from(applicantPrivacyEvidence).where(and(
      eq(applicantPrivacyEvidence.organizationId, organizationId),
      eq(applicantPrivacyEvidence.applicantId, applicantId),
    )).limit(1);
    if (!applicant || !privacy) return "not_found";
    if (privacy.purgedAt) return "already_erased";
    if (applicant.hiredEmployeeId !== null || privacy.legalHold) return "retention_hold";
    const now = new Date();
    if (action === "request_delete") {
      // A new maker request invalidates any older review.
      await tx.update(applicantPrivacyEvidence).set({
        deletionRequestedByUserId: user.id,
        deletionRequestedAt: now, deletionReason: reason,
        deletionReviewedByUserId: null, deletionReviewedAt: null,
        deletionReviewEvidenceReference: null,
      }).where(and(eq(applicantPrivacyEvidence.organizationId, organizationId),
        eq(applicantPrivacyEvidence.applicantId, applicantId)));
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Candidate PII deletion requested",
        resource: "Applicant #" + applicantId,
        metadata: { applicantId, requesterUserId: user.id, reason },
      });
      return "requested";
    }
    if (action === "approve_delete") {
      if (!privacy.deletionRequestedByUserId || !privacy.deletionRequestedAt) return "no_request";
      if (privacy.deletionRequestedByUserId === user.id) return "self_review_forbidden";
      await tx.update(applicantPrivacyEvidence).set({
        deletionReviewedByUserId: user.id,
        deletionReviewedAt: now, deletionReviewEvidenceReference: evidence,
      }).where(and(eq(applicantPrivacyEvidence.organizationId, organizationId),
        eq(applicantPrivacyEvidence.applicantId, applicantId)));
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Candidate PII deletion independently reviewed",
        resource: "Applicant #" + applicantId,
        metadata: {
          applicantId, requesterUserId: privacy.deletionRequestedByUserId,
          reviewerUserId: user.id, reviewEvidenceReference: evidence,
          approvalReason: String(body.approvalReason).trim(),
        },
      });
      return "reviewed";
    }
    // No caller-supplied reviewer identity is trusted for actual deletion:
    // the database row must contain a prior action by a different signed-in
    // company-wide owner/admin, tied to this current request and recent enough.
    if (!applicantErasureIndependentlyApproved(privacy, now)) return "review_required";
    if (applicant.resumeUrl) return "resume_storage_pending";
    await tx.update(jobApplicants)
      .set({ ...applicantPiiEraseValues(applicantId), stage: "rejected" })
      .where(and(eq(jobApplicants.id, applicantId), eq(jobApplicants.organizationId, organizationId)));
    await tx.update(applicantPrivacyEvidence).set({
      purgedAt: now, purgedByUserId: user.id, rejectedAt: privacy.rejectedAt ?? now,
    }).where(and(eq(applicantPrivacyEvidence.organizationId, organizationId),
      eq(applicantPrivacyEvidence.applicantId, applicantId)));
    await tx.insert(auditEvents).values({
      organizationId, actor: user.name, action: "Candidate PII erasure applied after independent review",
      resource: "Applicant #" + applicantId,
      metadata: {
        applicantId, erasedByUserId: user.id,
        requesterUserId: privacy.deletionRequestedByUserId,
        independentReviewerUserId: privacy.deletionReviewedByUserId,
        reviewEvidenceReference: privacy.deletionReviewEvidenceReference,
        retainedAnonymousRecord: true,
      },
    });
    return "erased";
  });
  if (!["requested", "reviewed", "erased"].includes(result)) return Response.json({
    error: result === "resume_storage_pending" ?
      "Private resume object must be securely deleted and verified before candidate erasure." :
      result === "retention_hold" ?
      "Hired worker records or a legal hold require separate retention review." :
      "Candidate privacy action cannot proceed: " + result,
  }, { status: result === "not_found" ? 404 : 409, headers: noStore });
  return Response.json({ status: result, applicantId }, { headers: noStore });
}
