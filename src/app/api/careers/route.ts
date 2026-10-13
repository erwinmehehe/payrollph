import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicantPrivacyEvidence, auditEvents, jobApplicants, jobRequisitions, organizations, positions } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { randomUUID, createHash } from "node:crypto";
import { applicantPrivacyControlsEnabled } from "@/lib/recruitment-applicant-privacy";
import { enforceIntakeProof } from "@/lib/public-intake-proof-server";

const applicationReady = () => criticalReleaseFlagEnabled("recruitmentJourney") && applicantPrivacyControlsEnabled() && criticalReleaseFlagEnabled("publicIntakeProof") &&
  /^[A-Za-z0-9._-]{2,64}$/.test(process.env.CAREERS_PRIVACY_NOTICE_VERSION ?? "") &&
  /^https:\/\/[^\s]+$/.test(process.env.CAREERS_PRIVACY_NOTICE_URL ?? "");


export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Careers portal not available." }, { status: 404 });
const listing = (organizationId: number) => and(
  eq(jobRequisitions.organizationId, organizationId),
  eq(jobRequisitions.careersPublished, true),
  sql`${jobRequisitions.status} in ('open', 'interviewing')`,
  sql`${jobRequisitions.positionId} is not null`,
);
export async function GET(request: Request) {
  if (!applicationReady()) return unavailable();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return Response.json({ error: "Valid employer required." }, { status: 400 });
  const [organization] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return unavailable();
  const jobs = await db.select({
    id: jobRequisitions.id, title: jobRequisitions.title,
    department: jobRequisitions.department, description: jobRequisitions.description,
    employmentType: jobRequisitions.employmentType, status: jobRequisitions.status,
  }).from(jobRequisitions).where(listing(organizationId)).limit(60);
  return Response.json({ organization: organization.name, jobs }, {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  if (!applicationReady()) return unavailable();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  // Honeypot field must remain empty. No resume or biometric uploads.
  if (body.website) return Response.json({ received: true });
  const organizationId = Number(body.organizationId);
  const requisitionId = Number(body.requisitionId);
  const fullName = String(body.fullName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim().slice(0,32);
  const notes = String(body.notes ?? "").trim().slice(0,1000);
  const noticeVersion = process.env.CAREERS_PRIVACY_NOTICE_VERSION ?? "";
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
    !Number.isSafeInteger(requisitionId) || requisitionId <= 0 ||
    fullName.length < 4 || fullName.length > 160 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 ||
    body.consent !== true || body.privacyNoticeVersion !== noticeVersion)
    return Response.json({ error: "Name, valid email and data-processing consent are required." }, { status: 422 });
  const rate = await rateLimitDistributed("careers-application:" + clientIp(request), { limit: 4, windowMs: 15*60_000 });
  if (rate.mode !== "distributed-postgres") return Response.json({ error: "Security check unavailable." }, { status: 503 });
  if (!rate.allowed) return Response.json({ error: "Too many applications. Please retry later." }, { status: 429 });
  const proofDenied = await enforceIntakeProof(body, email);
  if (proofDenied) return proofDenied;
  const byEmail = await rateLimitDistributed("careers-email:" + createHash("sha256").update(organizationId + ":" + email).digest("hex"), { limit: 5, windowMs: 24*60*60_000 });
  if (byEmail.mode !== "distributed-postgres") return Response.json({ error: "Security check unavailable." }, { status: 503 });
  if (!byEmail.allowed) return Response.json({ error: "Too many applications." }, { status: 429 });
  const [job] = await db.select({ id: jobRequisitions.id }).from(jobRequisitions).where(
    and(listing(organizationId), eq(jobRequisitions.id, requisitionId)),
  ).limit(1);
  if (!job) return unavailable();
  // Do not permit the public form to rewrite or bypass existing recruiting stages.
  const created = await db.transaction(async tx => {
    // Serialize one applicant email per requisition even across app instances.
    await tx.execute(sql`select pg_advisory_xact_lock(4911, hashtext(${organizationId + ":" + requisitionId + ":" + email}))`);
    await tx.execute(sql`select id from job_requisitions where id = ${requisitionId} and organization_id = ${organizationId} for update`);
    const [freshJob] = await tx.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(listing(organizationId), eq(jobRequisitions.id, requisitionId))).limit(1);
    if (!freshJob) return null;
    const [existing] = await tx.select({ id: jobApplicants.id }).from(jobApplicants).where(and(
      eq(jobApplicants.organizationId, organizationId), eq(jobApplicants.requisitionId, requisitionId),
      sql`lower(${jobApplicants.email}) = ${email}`,
    )).limit(1);
    if (existing) return null;
    const [row] = await tx.insert(jobApplicants).values({
      organizationId, requisitionId, fullName, email, phone: phone || null,
      notes: notes || null, stage: "applied",
    }).returning({ id: jobApplicants.id });
    await tx.insert(applicantPrivacyEvidence).values({
      organizationId, applicantId: row.id, legalBasis: "consent",
      privacyNoticeVersion: noticeVersion,
      sourceEvidenceReference: "careers-web:" + randomUUID(), consentCapturedAt: new Date(),
    });
    await tx.insert(auditEvents).values({ organizationId, actor: "Public careers application",
      action: "Published careers application received", resource: "Applicant #" + row.id,
      metadata: { applicantId: row.id, requisitionId, noCredentialsGranted: true, privacyNoticeVersion: noticeVersion },
    });
    return row;
  });
  return Response.json({ received: true }, { status: created ? 201 : 200 });
}
