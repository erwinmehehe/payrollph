import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobApplicants, jobRequisitions, organizations } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Careers portal not available." }, { status: 404 });
const listing = (organizationId: number) => and(
  eq(jobRequisitions.organizationId, organizationId),
  eq(jobRequisitions.careersPublished, true),
  ne(jobRequisitions.status, "filled"), ne(jobRequisitions.status, "cancelled"),
);
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney")) return unavailable();
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
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney")) return unavailable();
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
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
    !Number.isSafeInteger(requisitionId) || requisitionId <= 0 ||
    fullName.length < 4 || fullName.length > 160 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 ||
    body.consent !== true)
    return Response.json({ error: "Name, valid email and data-processing consent are required." }, { status: 422 });
  const rate = await rateLimitDistributed("careers-application:" + clientIp(request), { limit: 4, windowMs: 15*60_000 });
  if (!rate.allowed) return Response.json({ error: "Too many applications. Please retry later." }, { status: 429 });
  const [job] = await db.select({ id: jobRequisitions.id }).from(jobRequisitions).where(
    and(listing(organizationId), eq(jobRequisitions.id, requisitionId)),
  ).limit(1);
  if (!job) return unavailable();
  // Do not permit the public form to rewrite or bypass existing recruiting stages.
  const [same] = await db.select({ id: jobApplicants.id }).from(jobApplicants).where(and(
    eq(jobApplicants.organizationId, organizationId), eq(jobApplicants.requisitionId, requisitionId),
    sql`lower(${jobApplicants.email}) = ${email}`,
  )).limit(1);
  if (same) return Response.json({ received: true }); // Do not reveal a prior applicant's existence.
  const [created] = await db.insert(jobApplicants).values({
    organizationId, requisitionId, fullName, email, phone: phone || null,
    notes: notes || null, stage: "applied",
  }).returning({ id: jobApplicants.id });
  await recordAuditEvent({ organizationId, actor: "Public careers application",
    action: "Published careers application received", resource: String(requisitionId),
    metadata: { applicantId: created.id, noCredentialsGranted: true },
  });
  return Response.json({ received: true }, { status: 201 });
}
