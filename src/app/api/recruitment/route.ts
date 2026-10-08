import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  jobApplicants,
  jobProfiles,
  jobRequisitions,
  orgUnits,
  positionAssignments,
  positions,
  workforcePlanBaselines,
  workforcePlanPositionExecutions,
  workforcePlans,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { runAutomationEventSafely } from "@/lib/automation";
import { positionControlFingerprint } from "@/lib/hcm-position-business-process";
import { PlanRequisitionHandoffError, resolvePublishedPlanRequisitionLineage } from "@/lib/workforce-plan-requisition-handoff";

export const dynamic = "force-dynamic";

const RECRUITMENT_MANAGER_ROLES = ["owner", "admin", "hr"] as const;

class RecruitmentConflict extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "RecruitmentConflict";
  }
}

const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "rejected"] as const;
const CANDIDATE_TRANSITIONS: Record<string, readonly string[]> = {
  applied: ["screening", "rejected"],
  screening: ["interview", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["rejected"],
  rejected: [],
};

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
    RECRUITMENT_MANAGER_ROLES,
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
  const visiblePositionIds = new Set(visiblePositions.map((position) => position.id));
  const positionById = new Map(allPositions.map((position) => [position.id, position]));

  // Legacy requisitions predate explicit org-unit ownership. Company-wide People
  // admins retain access; scoped HR sees only requisitions tied to positions in
  // their own unit.
  let reqs = access.companyWide
    ? allReqs
    : allReqs.filter((row) => row.positionId != null && visiblePositionIds.has(row.positionId));

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
      const linked = row.positionId ? positionById.get(row.positionId) : null;
      const reqApplicants = applicantsByReq.get(row.id) ?? [];
      return {
        ...row,
        applicantCount: reqApplicants.length,
        interviewCount: reqApplicants.filter((applicant) => applicant.stage === "interview").length,
        offerCount: reqApplicants.filter((applicant) => applicant.stage === "offer").length,
        hiredCount: reqApplicants.filter((applicant) => applicant.stage === "hired").length,
        positionCode: linked?.code ?? null,
        orgUnitId: linked?.orgUnitId ?? null,
        annualPositionBudget: linked?.annualBudget ?? null,
      };
    }),
    applicants,
    access,
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
    RECRUITMENT_MANAGER_ROLES,
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
      if (position.status !== "approved") {
        return Response.json({
          error: "Only an approved position can be opened for recruitment.",
          positionStatus: position.status,
        }, { status: 409 });
      }

      const priorSearches = await db.select({ id: jobRequisitions.id, status: jobRequisitions.status })
        .from(jobRequisitions)
        .where(and(
          eq(jobRequisitions.organizationId, organizationId),
          eq(jobRequisitions.positionId, position.id),
        ));
      const activeSearch = priorSearches.find((row) => !["filled", "cancelled"].includes(row.status));
      if (activeSearch) {
        return Response.json({
          error: "This position already has an active requisition.",
          requisitionId: activeSearch.id,
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

      const createdOrResponse = await db.transaction(async (tx) => {
        // Match published-plan position execution lock order (plan -> position).
        // A row-share lock also serializes against concurrent baseline publish,
        // which locks the plan row FOR UPDATE before changing the baseline.
        if (position.planId != null) {
          await tx.execute(sql`select pg_advisory_xact_lock(4194, ${position.planId})`);
          await tx.execute(sql`select id from workforce_plans where id = ${position.planId} for share`);
        }
        await tx.execute(sql`select pg_advisory_xact_lock(4102, ${position.id})`);

        const lockedSearches = await tx.select({
          id: jobRequisitions.id,
          status: jobRequisitions.status,
        }).from(jobRequisitions).where(and(
          eq(jobRequisitions.organizationId, organizationId),
          eq(jobRequisitions.positionId, position.id),
        ));
        const lockedActiveSearch = lockedSearches.find((row) => !["filled", "cancelled"].includes(row.status));
        if (lockedActiveSearch) {
          throw new RecruitmentConflict("This position already has an active requisition.", {
            requisitionId: lockedActiveSearch.id,
          });
        }

        const [freshPosition] = await tx.select().from(positions).where(and(
          eq(positions.id, position.id),
          eq(positions.organizationId, organizationId),
        )).limit(1);
        if (!freshPosition || freshPosition.status !== "approved") {
          throw new RecruitmentConflict("Only an approved position can be opened for recruitment.", {
            positionStatus: freshPosition?.status ?? "missing",
          });
        }
        if (positionControlFingerprint(freshPosition) !== positionControlFingerprint(position)) {
          throw new RecruitmentConflict(
            "The approved position changed while the requisition was being opened. Refresh before submitting.",
          );
        }

        // Plan-linked positions must be backed by the exact CURRENT published
        // baseline AND an applied position execution. This gate prevents manual
        // position approval or stale plan publication from manufacturing hiring
        // authority. Existing requisitions are not retroactively rewritten.
        let lineage = null as ReturnType<typeof resolvePublishedPlanRequisitionLineage> | null;
        if (freshPosition.planId != null) {
          const [[plan], [baseline]] = await Promise.all([
            tx.select().from(workforcePlans).where(and(
              eq(workforcePlans.id, freshPosition.planId),
              eq(workforcePlans.organizationId, organizationId),
            )).limit(1),
            tx.select().from(workforcePlanBaselines).where(and(
              eq(workforcePlanBaselines.organizationId, organizationId),
              eq(workforcePlanBaselines.planId, freshPosition.planId),
              eq(workforcePlanBaselines.current, true),
            )).orderBy(desc(workforcePlanBaselines.version)).limit(1),
          ]);
          const appliedExecutions = baseline
            ? await tx.select().from(workforcePlanPositionExecutions).where(and(
                eq(workforcePlanPositionExecutions.organizationId, organizationId),
                eq(workforcePlanPositionExecutions.planId, freshPosition.planId),
                eq(workforcePlanPositionExecutions.baselineId, baseline.id),
                eq(workforcePlanPositionExecutions.status, "applied"),
              )).orderBy(desc(workforcePlanPositionExecutions.id))
            : [];
          lineage = resolvePublishedPlanRequisitionLineage({
            organizationId,
            plan: plan ?? null,
            baseline: baseline ?? null,
            executions: appliedExecutions,
            position: {
              ...freshPosition,
              plannedStartDate: freshPosition.plannedStartDate
                ? String(freshPosition.plannedStartDate) : null,
            },
          });
        }

        const [activeAssignment] = await tx.select({ id: positionAssignments.id })
          .from(positionAssignments)
          .where(and(
            eq(positionAssignments.positionId, position.id),
            isNull(positionAssignments.effectiveUntil),
          ))
          .limit(1);
        if (activeAssignment) {
          throw new RecruitmentConflict("An occupied position cannot be opened for recruitment.");
        }

        const [requisition] = await tx.insert(jobRequisitions).values({
          organizationId,
          positionId: position.id,
          planHandoffEvidence: lineage,
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
          .set({ status: "open", updatedAt: new Date() })
          .where(eq(positions.id, position.id));

        return { requisition, lineage };
      }).catch((error: unknown) => {
        if (error instanceof PlanRequisitionHandoffError) {
          return Response.json({ error: error.message, code: error.code }, { status: 409 });
        }
        if (error instanceof RecruitmentConflict) {
          return Response.json({ error: error.message, ...error.details }, { status: 409 });
        }
        throw error;
      });
      if (createdOrResponse instanceof Response) return createdOrResponse;
      const { requisition: created, lineage } = createdOrResponse;

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
          planHandoffEvidence: lineage,
        },
      });

      const automation = await runAutomationEventSafely({
        organizationId,
        trigger: "position.opened",
        eventKey: `position-opened:${position.id}:${created.id}`,
        context: {
          positionId: position.id,
          positionCode: position.code,
          orgUnitId: position.orgUnitId,
          title: created.title,
          employmentType: position.employmentType,
          annualBudget: Number(position.annualBudget),
          eventAmount: Number(position.annualBudget),
          requisitionId: created.id,
          planId: lineage?.planId ?? null,
          baselineId: lineage?.baselineId ?? null,
          positionExecutionId: lineage?.executionId ?? null,
        },
      });

      return Response.json({ ...created, automation }, { status: 201 });
    }

    return Response.json({
      error: "New requisitions must be opened from an approved position in Planning.",
    }, { status: 409 });
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

    const [linkedPosition] = req.positionId
      ? await db.select().from(positions)
          .where(and(
            eq(positions.id, req.positionId),
            eq(positions.organizationId, organizationId),
          ))
          .limit(1)
      : [];

    if (linkedPosition) {
      const scope = assertScope(access, linkedPosition.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    } else if (!access.companyWide) {
      return Response.json({ error: "This legacy requisition has no org-unit ownership." }, { status: 403 });
    }

    const createdOrResponse = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4103, ${requisitionId})`);
      if (linkedPosition) {
        await tx.execute(sql`select pg_advisory_xact_lock(4102, ${linkedPosition.id})`);
      }

      const [freshReq] = await tx.select({
        status: jobRequisitions.status,
        positionId: jobRequisitions.positionId,
        title: jobRequisitions.title,
      }).from(jobRequisitions).where(and(
        eq(jobRequisitions.id, requisitionId),
        eq(jobRequisitions.organizationId, organizationId),
      )).limit(1);
      if (!freshReq) throw new RecruitmentConflict("Requisition no longer exists.");
      if (["filled", "cancelled"].includes(freshReq.status)) {
        throw new RecruitmentConflict("This requisition is no longer accepting candidates.", {
          requisitionStatus: freshReq.status,
        });
      }
      if (freshReq.positionId !== req.positionId) {
        throw new RecruitmentConflict("The requisition's position linkage changed. Reload before adding a candidate.");
      }

      if (linkedPosition) {
        const [freshPosition] = await tx.select({ status: positions.status }).from(positions).where(and(
          eq(positions.id, linkedPosition.id),
          eq(positions.organizationId, organizationId),
        )).limit(1);
        if (!freshPosition || freshPosition.status !== "open") {
          throw new RecruitmentConflict("The linked position is no longer open for recruitment.", {
            positionStatus: freshPosition?.status ?? "missing",
          });
        }
      }

      const [created] = await tx.insert(jobApplicants).values({
        requisitionId,
        organizationId,
        fullName: fullName.slice(0, 160),
        email: email.slice(0, 160),
        phone: phone ? phone.slice(0, 32) : null,
        stage: "applied",
        rating: 3,
        notes: notes.slice(0, 8000),
      }).returning();

      return { created, requisitionTitle: freshReq.title };
    }).catch((error: unknown) => {
      if (error instanceof RecruitmentConflict) {
        return Response.json({ error: error.message, ...error.details }, { status: 409 });
      }
      throw error;
    });
    if (createdOrResponse instanceof Response) return createdOrResponse;

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Candidate application received",
      resource: `${fullName} -> ${createdOrResponse.requisitionTitle}`,
      metadata: { applicantId: createdOrResponse.created.id, requisitionId, positionId: linkedPosition?.id ?? null },
    });

    return Response.json(createdOrResponse.created, { status: 201 });
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
    RECRUITMENT_MANAGER_ROLES,
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

  const [linkedPosition] = req.positionId
    ? await db.select().from(positions)
        .where(and(
          eq(positions.id, req.positionId),
          eq(positions.organizationId, applicant.organizationId),
        ))
        .limit(1)
    : [];

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
  if (stage && stage !== applicant.stage && !(CANDIDATE_TRANSITIONS[applicant.stage] ?? []).includes(stage)) {
    return Response.json({
      error: `Candidate cannot move from ${applicant.stage} to ${stage}.`,
      currentStage: applicant.stage,
      requestedStage: stage,
    }, { status: 409 });
  }
  if (stage === "offer" && offeredSalary === null && !applicant.offeredSalary) {
    return Response.json({ error: "A monthly-equivalent offeredSalary is required before moving a candidate to Job Offer." }, { status: 400 });
  }
  const effectiveOffer = offeredSalary ?? (applicant.offeredSalary ? Number(applicant.offeredSalary) : null);
  if ((stage === "offer" || offeredSalary !== null) && effectiveOffer !== null && linkedPosition && Number(linkedPosition.annualBudget) > 0 && effectiveOffer * 12 > Number(linkedPosition.annualBudget) + 0.01) {
    return Response.json({
      error: "The offer exceeds the approved annual position budget.",
      approvedAnnualBudget: Number(linkedPosition.annualBudget),
      proposedAnnualizedOffer: effectiveOffer * 12,
    }, { status: 409 });
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

  const updatedOrResponse = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4101, ${applicantId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(4103, ${req.id})`);
    if (linkedPosition) {
      await tx.execute(sql`select pg_advisory_xact_lock(4102, ${linkedPosition.id})`);
    }

    const [freshApplicant] = await tx.select({
      stage: jobApplicants.stage,
      hiredEmployeeId: jobApplicants.hiredEmployeeId,
      offeredSalary: jobApplicants.offeredSalary,
    }).from(jobApplicants).where(eq(jobApplicants.id, applicantId)).limit(1);
    if (!freshApplicant) throw new RecruitmentConflict("Applicant no longer exists.");
    if (freshApplicant.hiredEmployeeId || freshApplicant.stage === "hired") {
      throw new RecruitmentConflict("This candidate has already been converted to an employee and is now immutable in the hiring pipeline.", {
        employeeId: freshApplicant.hiredEmployeeId,
      });
    }

    const [freshReq] = await tx.select({
      status: jobRequisitions.status,
      positionId: jobRequisitions.positionId,
    }).from(jobRequisitions).where(eq(jobRequisitions.id, req.id)).limit(1);
    if (!freshReq) throw new RecruitmentConflict("Requisition no longer exists.");
    if (["filled", "cancelled"].includes(freshReq.status)) {
      throw new RecruitmentConflict("This requisition is closed and its candidate pipeline is immutable.", {
        requisitionStatus: freshReq.status,
      });
    }
    if (freshReq.positionId !== req.positionId) {
      throw new RecruitmentConflict("The requisition's position linkage changed. Reload before updating this candidate.");
    }

    if (stage && stage !== freshApplicant.stage && !(CANDIDATE_TRANSITIONS[freshApplicant.stage] ?? []).includes(stage)) {
      throw new RecruitmentConflict(`Candidate cannot move from ${freshApplicant.stage} to ${stage}.`, {
        currentStage: freshApplicant.stage,
        requestedStage: stage,
      });
    }

    const freshEffectiveOffer = offeredSalary ?? (freshApplicant.offeredSalary ? Number(freshApplicant.offeredSalary) : null);
    if (stage === "offer" && freshEffectiveOffer === null) {
      return Response.json({ error: "A monthly-equivalent offeredSalary is required before moving a candidate to Job Offer." }, { status: 400 });
    }

    if (linkedPosition && (stage === "offer" || offeredSalary !== null)) {
      const [freshPosition] = await tx.select({
        status: positions.status,
        annualBudget: positions.annualBudget,
      }).from(positions).where(and(
        eq(positions.id, linkedPosition.id),
        eq(positions.organizationId, applicant.organizationId),
      )).limit(1);
      if (!freshPosition || freshPosition.status !== "open") {
        throw new RecruitmentConflict("The linked position is no longer open for recruitment.", {
          positionStatus: freshPosition?.status ?? "missing",
        });
      }
      if (
        freshEffectiveOffer !== null
        && Number(freshPosition.annualBudget) > 0
        && freshEffectiveOffer * 12 > Number(freshPosition.annualBudget) + 0.01
      ) {
        throw new RecruitmentConflict("The offer exceeds the approved annual position budget.", {
          approvedAnnualBudget: Number(freshPosition.annualBudget),
          proposedAnnualizedOffer: freshEffectiveOffer * 12,
        });
      }
    }

    const [updated] = await tx.update(jobApplicants)
      .set(updateData)
      .where(eq(jobApplicants.id, applicantId))
      .returning();

    if (stage && ["interview", "offer"].includes(stage) && freshReq.status === "open") {
      await tx.update(jobRequisitions)
        .set({ status: "interviewing" })
        .where(eq(jobRequisitions.id, req.id));
    }

    return { updated, previousStage: freshApplicant.stage };
  }).catch((error: unknown) => {
    if (error instanceof RecruitmentConflict) {
      return Response.json({ error: error.message, ...error.details }, { status: 409 });
    }
    throw error;
  });

  if (updatedOrResponse instanceof Response) return updatedOrResponse;

  await recordAuditEvent({
    organizationId: applicant.organizationId,
    actor: user.name,
    action: stage ? `Candidate moved to stage: ${stage}` : "Candidate profile updated",
    resource: applicant.fullName,
    metadata: {
      applicantId,
      requisitionId: req.id,
      positionId: linkedPosition?.id ?? null,
      previousStage: updatedOrResponse.previousStage,
      stage: stage || updatedOrResponse.previousStage,
      offeredSalary,
    },
  });

  return Response.json(updatedOrResponse.updated);
}
