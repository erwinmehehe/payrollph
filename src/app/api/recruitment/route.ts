import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  jobApplicants,
  jobProfiles,
  jobRequisitions,
  orgUnits,
  positions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "rejected"] as const;

function positionEmploymentType(value: string) {
  return value === "Regular" ? "Full-time" : value;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const requisitionId = Number(url.searchParams.get("requisitionId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [allReqs, allPositions] = await Promise.all([
    db.select().from(jobRequisitions)
      .where(eq(jobRequisitions.organizationId, organizationId))
      .orderBy(desc(jobRequisitions.id)),
    db.select().from(positions)
      .where(eq(positions.organizationId, organizationId)),
  ]);

  const visiblePositions = access.companyWide
    ? allPositions
    : allPositions.filter((position) => position.orgUnitId === access.orgUnitId);
  const positionByRequisition = new Map(
    visiblePositions
      .filter((position) => position.requisitionId != null)
      .map((position) => [Number(position.requisitionId), position]),
  );

  // Legacy requisitions predate explicit org-unit ownership. Company-wide People
  // admins retain access to them; scoped HR users see only requisitions attached
  // to a position in their own unit.
  let reqs = access.companyWide
    ? allReqs
    : allReqs.filter((row) => positionByRequisition.has(row.id));

  if (requisitionId > 0) {
    reqs = reqs.filter((row) => row.id === requisitionId);
    if (reqs.length === 0) {
      return Response.json({ error: "Requisition not found in your assigned scope." }, { status: 404 });
    }
  }

  const reqIds = reqs.map((row) => row.id);
  const applicants = reqIds.length
    ? await db.select().from(jobApplicants)
        .where(and(
          eq(jobApplicants.organizationId, organizationId),
          inArray(jobApplicants.requisitionId, reqIds),
        ))
        .orderBy(desc(jobApplicants.id))
    : [];

  const applicantsByReq = new Map<number, typeof applicants>();
  for (const applicant of applicants) {
    applicantsByReq.set(
      applicant.requisitionId,
      [...(applicantsByReq.get(applicant.requisitionId) ?? []), applicant],
    );
  }

  return Response.json({
    requisitions: reqs.map((row) => {
      const linked = positionByRequisition.get(row.id);
      const reqApplicants = applicantsByReq.get(row.id) ?? [];
      return {
        ...row,
        applicantCount: reqApplicants.length,
        interviewCount: reqApplicants.filter((applicant) => applicant.stage === "interview").length,
        offerCount: reqApplicants.filter((applicant) => applicant.stage === "offer").length,
        hiredCount: reqApplicants.filter((applicant) => applicant.stage === "hired").length,
        positionId: linked?.id ?? null,
        positionCode: linked?.code ?? null,
        orgUnitId: linked?.orgUnitId ?? null,
        annualPositionBudget: linked?.annualBudget ?? null,
      };
    }),
    applicants,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const entityType = String(body.entityType ?? "requisition");
  const organizationId = Number(body.organizationId);

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (entityType === "requisition") {
    const positionId = body.positionId ? Number(body.positionId) : null;

    if (positionId) {
      const [position] = await db.select().from(positions)
        .where(and(
          eq(positions.id, positionId),
          eq(positions.organizationId, organizationId),
        ))
        .limit(1);
      if (!position) return Response.json({ error: "Position not found in this workspace." }, { status: 404 });

      const scope = assertScope(access, position.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
      if (position.requisitionId) {
        return Response.json({ error: "This position already has a linked requisition." }, { status: 409 });
      }
      if (position.status !== "approved") {
        return Response.json({
          error: "Only an approved position can be opened for recruitment.",
          positionStatus: position.status,
        }, { status: 409 });
      }

      const [[profile], [unit]] = await Promise.all([
        db.select().from(jobProfiles)
          .where(and(
            eq(jobProfiles.id, position.jobProfileId),
            eq(jobProfiles.organizationId, organizationId),
          ))
          .limit(1),
        position.orgUnitId
          ? db.select().from(orgUnits)
              .where(and(
                eq(orgUnits.id, position.orgUnitId),
                eq(orgUnits.organizationId, organizationId),
              ))
              .limit(1)
          : Promise.resolve([]),
      ]);
      if (!profile) return Response.json({ error: "The position's job profile no longer exists." }, { status: 409 });

      const monthlyBudget = Number(position.annualBudget) > 0
        ? Number(position.annualBudget) / 12
        : 0;

      try {
        const created = await db.transaction(async (tx) => {
          const [requisition] = await tx.insert(jobRequisitions).values({
            organizationId,
            title: profile.title,
            department: unit?.name ?? "Company-wide",
            headcount: 1,
            salaryMin: monthlyBudget ? monthlyBudget.toFixed(2) : null,
            salaryMax: monthlyBudget ? monthlyBudget.toFixed(2) : null,
            employmentType: positionEmploymentType(position.employmentType),
            status: "open",
            description: profile.description ?? position.notes ?? "",
          }).returning();

          await tx.update(positions)
            .set({
              requisitionId: requisition.id,
              status: "open",
              updatedAt: new Date(),
            })
            .where(eq(positions.id, position.id));

          return requisition;
        });

        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Approved position opened for recruitment",
          resource: `${position.code} -> ${created.title}`,
          metadata: {
            positionId: position.id,
            positionCode: position.code,
            requisitionId: created.id,
            orgUnitId: position.orgUnitId,
            annualBudget: Number(position.annualBudget),
          },
        });

        return Response.json(created, { status: 201 });
      } catch {
        return Response.json({
          error: "The position could not be opened for recruitment. It may already be linked to another requisition.",
        }, { status: 409 });
      }
    }

    if (!access.companyWide) {
      return Response.json({
        error: "Unit-scoped HR can create requisitions only from approved positions in their assigned unit.",
      }, { status: 403 });
    }

    const title = String(body.title ?? "").trim();
    const department = String(body.department ?? "General").trim();
    const headcount = Number(body.headcount ?? 1);
    const salaryMin = Number(body.salaryMin ?? 0);
    const salaryMax = Number(body.salaryMax ?? 0);
    const employmentType = String(body.employmentType ?? "Full-time").trim();
    const description = String(body.description ?? "").trim();

    if (!title || !Number.isInteger(headcount) || headcount < 1 || headcount > 1000) {
      return Response.json({ error: "Job title and headcount from 1 to 1000 are required." }, { status: 400 });
    }
    if (
      !Number.isFinite(salaryMin) ||
      !Number.isFinite(salaryMax) ||
      salaryMin < 0 ||
      salaryMax < 0 ||
      (salaryMin > 0 && salaryMax > 0 && salaryMax < salaryMin)
    ) {
      return Response.json({ error: "Salary range is invalid." }, { status: 400 });
    }

    const [created] = await db.insert(jobRequisitions).values({
      organizationId,
      title: title.slice(0, 160),
      department: department.slice(0, 120),
      headcount,
      salaryMin: salaryMin ? salaryMin.toFixed(2) : null,
      salaryMax: salaryMax ? salaryMax.toFixed(2) : null,
      employmentType: employmentType.slice(0, 32),
      status: "open",
      description: description.slice(0, 8000),
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Legacy requisition created without position",
      resource: title,
      metadata: { requisitionId: created.id, department, headcount },
    });

    return Response.json(created, { status: 201 });
  }

  if (entityType === "applicant") {
    const requisitionId = Number(body.requisitionId);
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = String(body.phone ?? "").trim();
    const notes = String(body.notes ?? "").trim();

    if (!Number.isInteger(requisitionId) || !fullName || !email) {
      return Response.json({ error: "Requisition, applicant name, and email are required." }, { status: 400 });
    }

    const [req] = await db.select().from(jobRequisitions)
      .where(and(
        eq(jobRequisitions.id, requisitionId),
        eq(jobRequisitions.organizationId, organizationId),
      ))
      .limit(1);
    if (!req) return Response.json({ error: "Requisition not found in this organization." }, { status: 404 });
    if (["filled", "cancelled"].includes(req.status)) {
      return Response.json({ error: "This requisition is no longer accepting candidates." }, { status: 409 });
    }

    const [linkedPosition] = await db.select().from(positions)
      .where(and(
        eq(positions.organizationId, organizationId),
        eq(positions.requisitionId, requisitionId),
      ))
      .limit(1);

    if (linkedPosition) {
      const scope = assertScope(access, linkedPosition.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    } else if (!access.companyWide) {
      return Response.json({ error: "This legacy requisition has no org-unit ownership." }, { status: 403 });
    }

    const [created] = await db.insert(jobApplicants).values({
      requisitionId,
      organizationId,
      fullName: fullName.slice(0, 160),
      email: email.slice(0, 160),
      phone: phone ? phone.slice(0, 32) : null,
      stage: "applied",
      rating: 3,
      notes: notes.slice(0, 8000),
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Candidate application received",
      resource: `${fullName} -> ${req.title}`,
      metadata: { applicantId: created.id, requisitionId, positionId: linkedPosition?.id ?? null },
    });

    return Response.json(created, { status: 201 });
  }

  return Response.json({ error: "Invalid entityType." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const applicantId = Number(body.applicantId);
  const stage = body.stage === undefined ? "" : String(body.stage);
  const offeredSalary = body.offeredSalary === undefined ? null : Number(body.offeredSalary);
  const notes = body.notes === undefined ? undefined : String(body.notes);
  const rating = body.rating === undefined ? null : Number(body.rating);

  if (!Number.isInteger(applicantId)) {
    return Response.json({ error: "applicantId is required." }, { status: 400 });
  }

  const [applicant] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, applicantId)).limit(1);
  if (!applicant) return Response.json({ error: "Applicant not found." }, { status: 404 });
  if (applicant.hiredEmployeeId) {
    return Response.json({
      error: "This candidate has already been converted to an employee and is now immutable in the hiring pipeline.",
      employeeId: applicant.hiredEmployeeId,
    }, { status: 409 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    applicant.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage recruitment.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, applicant.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [req] = await db.select().from(jobRequisitions)
    .where(and(
      eq(jobRequisitions.id, applicant.requisitionId),
      eq(jobRequisitions.organizationId, applicant.organizationId),
    ))
    .limit(1);
  if (!req) return Response.json({ error: "Requisition not found." }, { status: 404 });

  const [linkedPosition] = await db.select().from(positions)
    .where(and(
      eq(positions.organizationId, applicant.organizationId),
      eq(positions.requisitionId, req.id),
    ))
    .limit(1);

  if (linkedPosition) {
    const scope = assertScope(access, linkedPosition.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  } else if (!access.companyWide) {
    return Response.json({ error: "This legacy requisition has no org-unit ownership." }, { status: 403 });
  }

  if (stage === "hired") {
    return Response.json({
      error: "Use the Hire & onboard action so employee creation, onboarding, and position assignment happen together.",
    }, { status: 409 });
  }
  if (stage && !CANDIDATE_STAGES.includes(stage as (typeof CANDIDATE_STAGES)[number])) {
    return Response.json({ error: "Invalid candidate stage." }, { status: 400 });
  }
  if (offeredSalary !== null && (!Number.isFinite(offeredSalary) || offeredSalary <= 0 || offeredSalary > 100_000_000)) {
    return Response.json({ error: "offeredSalary must be greater than zero." }, { status: 400 });
  }
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return Response.json({ error: "rating must be an integer from 1 to 5." }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (stage) updateData.stage = stage;
  if (offeredSalary !== null) updateData.offeredSalary = offeredSalary.toFixed(2);
  if (notes !== undefined) updateData.notes = notes.slice(0, 8000);
  if (rating !== null) updateData.rating = rating;

  const [updated] = await db.update(jobApplicants)
    .set(updateData)
    .where(eq(jobApplicants.id, applicantId))
    .returning();

  if (stage && ["interview", "offer"].includes(stage) && req.status === "open") {
    await db.update(jobRequisitions)
      .set({ status: "interviewing" })
      .where(eq(jobRequisitions.id, req.id));
  }

  await recordAuditEvent({
    organizationId: applicant.organizationId,
    actor: user.name,
    action: stage ? `Candidate moved to stage: ${stage}` : "Candidate profile updated",
    resource: applicant.fullName,
    metadata: {
      applicantId,
      requisitionId: req.id,
      positionId: linkedPosition?.id ?? null,
      stage: stage || applicant.stage,
      offeredSalary,
    },
  });

  return Response.json(updated);
}
