import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicantPrivacyEvidence, auditEvents, jobApplicants, userOrganizations } from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  applicantPiiEraseValues, validApplicantPrivacyDecision,
} from "@/lib/recruitment-applicant-privacy";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" } as const;
const roles = ["owner", "admin"] as const;
const unavailable = () => Response.json({ error: "Applicant privacy actions are disabled." }, { status: 404 });
const positiveId = (v: number) => Number.isSafeInteger(v) && v > 0;

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
  const organizationId = Number(params.get("organizationId"));
  const applicantId = Number(params.get("applicantId"));
  if (!positiveId(organizationId) || !positiveId(applicantId)) {
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

/** Approved DPO-mediated PII erasure. Preserves a non-identifying audit row. */
export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("applicantPrivacy")) return unavailable();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const applicantId = Number(body.applicantId);
  const reviewerUserId = Number(body.reviewerUserId);
  if (!positiveId(organizationId) || !positiveId(applicantId) || !positiveId(reviewerUserId)) {
    return Response.json({ error: "Valid organization, candidate and independent reviewer required." }, { status: 400 });
  }
  const denied = await authorize(user.id, organizationId);
  if (denied) return denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "applicant-privacy-erase", resourceId: applicantId,
    limit: 3, windowMs: 60 * 60_000,
  });
  if (rate) return rate;
  if (reviewerUserId === user.id || !validApplicantPrivacyDecision(body.reason, body.reviewEvidenceReference)) {
    return Response.json({ error: "A separate authorized reviewer, documented reason and evidence reference are required." }, { status: 422 });
  }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM job_applicants WHERE id = ${applicantId}
      AND organization_id = ${organizationId} FOR UPDATE`);
    const [reviewer] = await tx.select({ userId: userOrganizations.userId })
      .from(userOrganizations).where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.userId, reviewerUserId),
        eq(userOrganizations.active, true),
        inArray(userOrganizations.role, ["owner", "admin"]),
      )).limit(1);
    if (!reviewer) return "reviewer_not_authorized";
    const [applicant] = await tx.select().from(jobApplicants).where(and(
      eq(jobApplicants.id, applicantId), eq(jobApplicants.organizationId, organizationId),
    )).limit(1);
    const [privacy] = await tx.select().from(applicantPrivacyEvidence).where(and(
      eq(applicantPrivacyEvidence.organizationId, organizationId),
      eq(applicantPrivacyEvidence.applicantId, applicantId),
    )).limit(1);
    if (!applicant || !privacy) return "not_found";
    if (privacy.purgedAt) return "already_erased";
    if (applicant.hiredEmployeeId != null || privacy.legalHold) return "retention_hold";
    if (applicant.resumeUrl) return "resume_storage_pending";
    const now = new Date();
    await tx.update(jobApplicants).set({ ...applicantPiiEraseValues(applicantId), stage: "rejected" })
      .where(and(eq(jobApplicants.id, applicantId), eq(jobApplicants.organizationId, organizationId)));
    await tx.update(applicantPrivacyEvidence).set({
      purgedAt: now, purgedByUserId: user.id, rejectedAt: privacy.rejectedAt ?? now,
    }).where(and(eq(applicantPrivacyEvidence.organizationId, organizationId),
      eq(applicantPrivacyEvidence.applicantId, applicantId)));
    await tx.insert(auditEvents).values({
      organizationId, actor: user.name, action: "Candidate PII erasure approved and applied",
      resource: "Applicant #" + applicantId,
      metadata: {
        applicantId, actorUserId: user.id, independentReviewerUserId: reviewerUserId,
        reviewEvidenceReference: String(body.reviewEvidenceReference).trim(),
        reason: String(body.reason).trim(), retainedAnonymousRecord: true,
      },
    });
    return "erased";
  });
  if (result !== "erased") return Response.json({
    error: result === "resume_storage_pending" ?
      "Private resume object must be securely deleted and verified before candidate erasure." :
      result === "retention_hold" ?
      "Hired worker records or a legal hold require separate retention review." :
      "Candidate erasure cannot proceed: " + result,
  }, { status: result === "not_found" ? 404 : 409, headers: noStore });
  return Response.json({ status: "erased", applicantId, preservedAnonymousAudit: true }, { headers: noStore });
}
