import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobApplicants, jobRequisitions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const requisitionId = Number(url.searchParams.get("requisitionId") ?? 0);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const reqs = await db.select().from(jobRequisitions)
    .where(eq(jobRequisitions.organizationId, organizationId))
    .orderBy(desc(jobRequisitions.id));

  const reqIds = reqs.map((r) => r.id);

  const applicantsFilter = requisitionId > 0
    ? and(eq(jobApplicants.organizationId, organizationId), eq(jobApplicants.requisitionId, requisitionId))
    : reqIds.length > 0
      ? and(eq(jobApplicants.organizationId, organizationId), inArray(jobApplicants.requisitionId, reqIds))
      : eq(jobApplicants.organizationId, organizationId);

  const applicants = await db.select().from(jobApplicants)
    .where(applicantsFilter)
    .orderBy(desc(jobApplicants.id));

  const applicantsByReq = new Map<number, typeof applicants>();
  for (const a of applicants) {
    applicantsByReq.set(a.requisitionId, [...(applicantsByReq.get(a.requisitionId) ?? []), a]);
  }

  return Response.json({
    requisitions: reqs.map((r) => ({
      ...r,
      applicantCount: (applicantsByReq.get(r.id) ?? []).length,
      interviewCount: (applicantsByReq.get(r.id) ?? []).filter((a) => a.stage === "interview").length,
      offerCount: (applicantsByReq.get(r.id) ?? []).filter((a) => a.stage === "offer").length,
    })),
    applicants,
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const entityType = String(body.entityType ?? "requisition"); // "requisition" | "applicant"
  const organizationId = Number(body.organizationId ?? 1);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  if (entityType === "requisition") {
    const title = String(body.title ?? "").trim();
    const department = String(body.department ?? "General").trim();
    const headcount = Number(body.headcount ?? 1);
    const salaryMin = Number(body.salaryMin ?? 0);
    const salaryMax = Number(body.salaryMax ?? 0);
    const employmentType = String(body.employmentType ?? "Full-time");
    const description = String(body.description ?? "");

    if (!title) return Response.json({ error: "Job title is required." }, { status: 400 });

    const [created] = await db.insert(jobRequisitions).values({
      organizationId,
      title,
      department,
      headcount,
      salaryMin: salaryMin ? salaryMin.toFixed(2) : null,
      salaryMax: salaryMax ? salaryMax.toFixed(2) : null,
      employmentType,
      status: "open",
      description,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Job requisition created",
      resource: title,
      metadata: { requisitionId: created.id, department, headcount },
    });

    return Response.json(created, { status: 201 });
  }

  if (entityType === "applicant") {
    const requisitionId = Number(body.requisitionId);
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const notes = String(body.notes ?? "");

    if (!requisitionId || !fullName || !email) {
      return Response.json({ error: "Requisition, applicant name, and email are required." }, { status: 400 });
    }

    const [req] = await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, requisitionId)).limit(1);
    if (!req || req.organizationId !== organizationId) {
      return Response.json({ error: "Requisition not found in this organization." }, { status: 404 });
    }

    const [created] = await db.insert(jobApplicants).values({
      requisitionId,
      organizationId,
      fullName,
      email,
      phone,
      stage: "applied",
      rating: 3,
      notes,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Candidate application received",
      resource: `${fullName} -> ${req.title}`,
      metadata: { applicantId: created.id, email },
    });

    return Response.json(created, { status: 201 });
  }

  return Response.json({ error: "Invalid entityType." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const applicantId = Number(body.applicantId);
  const stage = String(body.stage ?? "");
  const offeredSalary = Number(body.offeredSalary ?? 0);
  const notes = body.notes ? String(body.notes) : undefined;
  const rating = Number(body.rating);

  if (!Number.isInteger(applicantId)) return Response.json({ error: "applicantId is required." }, { status: 400 });

  const [applicant] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, applicantId)).limit(1);
  if (!applicant) return Response.json({ error: "Applicant not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    applicant.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage recruitment.",
  );
  if (denied) return denied;

  const updateData: Record<string, unknown> = {};
  if (stage) updateData.stage = stage;
  if (offeredSalary > 0) updateData.offeredSalary = offeredSalary.toFixed(2);
  if (notes !== undefined) updateData.notes = notes;
  if (rating > 0 && rating <= 5) updateData.rating = rating;

  const [updated] = await db.update(jobApplicants).set(updateData).where(eq(jobApplicants.id, applicantId)).returning();

  await recordAuditEvent({
    organizationId: applicant.organizationId,
    actor: user.name,
    action: `Candidate moved to stage: ${stage || applicant.stage}`,
    resource: applicant.fullName,
    metadata: { applicantId, stage, offeredSalary },
  });

  return Response.json(updated);
}
