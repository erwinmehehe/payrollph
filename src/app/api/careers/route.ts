import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicantPrivacyEvidence, auditEvents, jobApplicants, jobRequisitions, organizations, positions } from "@/db/schema";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { randomUUID, createHash } from "node:crypto";
import { enforceIntakeProof } from "@/lib/public-intake-proof-server";
import { requireApplicantConsent } from "@/lib/recruitment-applicant-privacy";
import { careersNoticeConfig, careersSchemaReady, publishedCareersPredicate } from "@/lib/careers-privacy-gates";
import { careersContactFields, readCareersApplicationBody } from "@/lib/careers-intake-body";

export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Careers portal not available." }, {
  status: 404, headers: { "Cache-Control": "no-store" },
});
const notReady = () => Response.json({ error: "Careers application is temporarily unavailable." }, {
  status: 503, headers: { "Cache-Control": "no-store" },
});
const validId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const retryAfter = (retryAfterMs: number) => Math.max(1, Math.ceil(retryAfterMs / 1000));

/** Public listing is deliberately employer-bound and exposes no applicant or
 * job budget/salary records. Requires BOTH #925 schema and approved careers DDL.
 */
export async function GET(request: Request) {
  // Reject unsupported legal-employer workflows before evaluating optional
  // privacy configuration; response stays 403 across disabled notice states.
  const hold = workflowEntityHold(); if (hold) return hold;
  const notice = careersNoticeConfig();
  if (!notice) return unavailable();
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!validId(organizationId)) return Response.json({ error: "Valid employer required." }, { status: 400 });
  if (!await careersSchemaReady()) return notReady();
  const [organization] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return unavailable();
  const jobs = await db.select({
    id: jobRequisitions.id, title: jobRequisitions.title,
    department: jobRequisitions.department, description: jobRequisitions.description,
    employmentType: jobRequisitions.employmentType,
  }).from(jobRequisitions).where(publishedCareersPredicate(organizationId)).limit(60);
  return Response.json({ organization: organization.name, jobs }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Anonymous applicant intake: no resume, bank data, government IDs or
 * employee-account creation. Every accepted application gets #925 evidence.
 */
export async function POST(request: Request) {
  // Reject unsupported legal-employer workflows before evaluating optional
  // privacy configuration; response stays 403 across disabled notice states.
  const hold = workflowEntityHold(); if (hold) return hold;
  const notice = careersNoticeConfig();
  if (!notice) return unavailable();
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const body = await readCareersApplicationBody(request);
  if (body instanceof Response) return body;
  // No bot-controlled application row is stored for the honeypot case.
  if (body.website) return Response.json({ received: true }, { status: 202 });
  const organizationId = Number(body.organizationId);
  const requisitionId = Number(body.requisitionId);
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validId(organizationId) || !validId(requisitionId) ||
    fullName.length < 4 || fullName.length > 160 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 ||
    body.consent !== true || body.privacyNoticeVersion !== notice.version) {
    return Response.json({ error: "Name, valid email and documented data-processing consent are required." }, { status: 422 });
  }
  const contact = careersContactFields(body);
  if (!contact) return Response.json({
    error: "Optional phone or message must be text within the allowed length.",
  }, { status: 422, headers: { "Cache-Control": "no-store" } });
  // Reuse #925's canonical consent validation. The server assigns the source
  // reference and capture time; a browser cannot invent or backdate them.
  const consent = requireApplicantConsent({
    privacyAccepted: body.consent,
    privacyNoticeVersion: body.privacyNoticeVersion,
    privacyEvidenceReference: "careers-web:" + randomUUID(),
  });
  const rate = await rateLimitDistributed("careers-application:" + clientIp(request), {
    limit: 4, windowMs: 15 * 60_000,
  });
  if (rate.mode !== "distributed-postgres") return notReady();
  if (!rate.allowed) return Response.json({ error: "Too many applications. Please retry later." }, {
    status: 429, headers: { "Retry-After": String(retryAfter(rate.retryAfterMs)) },
  });
  const proofDenied = await enforceIntakeProof(body, email);
  if (proofDenied) return proofDenied;
  const perAddress = await rateLimitDistributed("careers-email:" +
    createHash("sha256").update(organizationId + ":" + email).digest("hex"), {
    limit: 5, windowMs: 24 * 60 * 60_000,
  });
  if (perAddress.mode !== "distributed-postgres") return notReady();
  if (!perAddress.allowed) return Response.json({ error: "Too many applications." }, {
    status: 429, headers: { "Retry-After": String(retryAfter(perAddress.retryAfterMs)) },
  });
  if (!await careersSchemaReady()) return notReady();
  const [job] = await db.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(
    publishedCareersPredicate(organizationId), eq(jobRequisitions.id, requisitionId),
  )).limit(1);
  if (!job) return unavailable();

  // One DB transaction commits the candidate, #925 consent and redacted audit.
  // A concurrent withdraw/position close is rechecked under row locks.
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(4911, hashtext(${organizationId + ":" + requisitionId + ":" + email}))`);
    const [lockedJob] = await tx.select({
      id: jobRequisitions.id, positionId: jobRequisitions.positionId,
    }).from(jobRequisitions).where(and(
      eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.id, requisitionId),
    )).for("update").limit(1);
    if (!lockedJob?.positionId) return null;
    const [openPosition] = await tx.select({ id: positions.id }).from(positions).where(and(
      eq(positions.id, lockedJob.positionId),
      eq(positions.organizationId, organizationId), eq(positions.status, "open"),
    )).for("share").limit(1);
    if (!openPosition) return null;
    const [freshJob] = await tx.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(
      publishedCareersPredicate(organizationId), eq(jobRequisitions.id, requisitionId),
    )).limit(1);
    if (!freshJob) return null;
    const [existing] = await tx.select({ id: jobApplicants.id }).from(jobApplicants).where(and(
      eq(jobApplicants.organizationId, organizationId), eq(jobApplicants.requisitionId, requisitionId),
      sql`lower(${jobApplicants.email}) = ${email}`,
    )).limit(1);
    if (existing) return null;
    const [row] = await tx.insert(jobApplicants).values({
      organizationId, requisitionId, fullName, email, phone: contact.phone || null,
      notes: contact.notes || null, stage: "applied",
    }).returning({ id: jobApplicants.id });
    await tx.insert(applicantPrivacyEvidence).values({
      organizationId, applicantId: row.id, legalBasis: "consent",
      privacyNoticeVersion: consent.privacyNoticeVersion,
      sourceEvidenceReference: consent.sourceEvidenceReference,
      consentCapturedAt: new Date(),
    });
    await tx.insert(auditEvents).values({
      organizationId, actor: "Public careers application",
      action: "Published careers application received", resource: "Applicant #" + row.id,
      metadata: { applicantId: row.id, requisitionId, privacyNoticeVersion: consent.privacyNoticeVersion,
        noCredentialsGranted: true },
    });
    return row;
  });
  // Identical 202 for duplicate and new rows prevents public email enumeration.
  return Response.json({ received: true }, {
    status: 202, headers: { "Cache-Control": "no-store" },
  });
}
