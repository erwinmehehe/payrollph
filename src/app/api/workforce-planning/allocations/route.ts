import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orgUnits,
  workforcePlanAllocations,
  workforcePlanManagerSubmissions,
  workforcePlans,
} from "@/db/schema";
import {
  getAccess,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
  assertOrganizationRole,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function roleAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

function nonNegativeInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function nonNegativeMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function visibleToAccess(
  orgUnitId: number,
  access: { companyWide: boolean; orgUnitId: number | null },
) {
  return access.companyWide || access.orgUnitId === orgUnitId;
}

function allocationEvidence(
  allocation: {
    id: number;
    orgUnitId: number;
    headcountCeiling: number;
    annualBudgetCeiling: string;
    updatedAt: Date;
  },
  planBudget: string,
) {
  return {
    allocationId: allocation.id,
    orgUnitId: allocation.orgUnitId,
    headcountCeiling: allocation.headcountCeiling,
    annualBudgetCeiling: Number(allocation.annualBudgetCeiling),
    allocationUpdatedAt: allocation.updatedAt.toISOString(),
    planBudget: Number(planBudget),
  };
}

async function workforceAccess(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access || !roleAllowed(access.role, WORKFORCE_MANAGER_ROLES as readonly string[])) {
    return null;
  }
  return access;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await workforceAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  }

  const [allocationRows, submissionRows, unitRows] = await Promise.all([
    db.select().from(workforcePlanAllocations)
      .where(eq(workforcePlanAllocations.organizationId, organizationId))
      .orderBy(workforcePlanAllocations.planId, workforcePlanAllocations.orgUnitId),
    db.select().from(workforcePlanManagerSubmissions)
      .where(eq(workforcePlanManagerSubmissions.organizationId, organizationId))
      .orderBy(desc(workforcePlanManagerSubmissions.createdAt), desc(workforcePlanManagerSubmissions.id)),
    db.select({
      id: orgUnits.id,
      name: orgUnits.name,
      code: orgUnits.code,
      active: orgUnits.active,
    }).from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
  ]);

  const units = new Map(unitRows.map((row) => [row.id, row]));
  const canManageAllocations = access.companyWide
    && roleAllowed(access.role, PEOPLE_ADMIN_ROLES as readonly string[]);

  return Response.json({
    access: {
      role: access.role,
      companyWide: access.companyWide,
      orgUnitId: access.orgUnitId,
      canManageAllocations,
      canDecideSubmissions: canManageAllocations,
    },
    allocations: allocationRows
      .filter((row) => visibleToAccess(row.orgUnitId, access))
      .map((row) => ({
        ...row,
        orgUnitName: units.get(row.orgUnitId)?.name ?? `Org unit #${row.orgUnitId}`,
        orgUnitCode: units.get(row.orgUnitId)?.code ?? null,
      })),
    submissions: submissionRows
      .filter((row) => visibleToAccess(row.orgUnitId, access))
      .map((row) => ({
        ...row,
        orgUnitName: units.get(row.orgUnitId)?.name ?? `Org unit #${row.orgUnitId}`,
        orgUnitCode: units.get(row.orgUnitId)?.code ?? null,
        canSubmit: row.status === "draft" && row.createdByUserId === user.id,
        canDecide: canManageAllocations
          && row.status === "submitted"
          && row.submittedByUserId !== user.id,
      })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce plan allocations");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await workforceAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  }

  if (entityType === "allocation") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can set top-down workforce-plan allocations.",
    );
    if (denied) return denied;
    if (!access.companyWide) {
      return Response.json({ error: "Top-down workforce allocations require company-wide access." }, { status: 403 });
    }

    const planId = Number(body.planId);
    const orgUnitId = Number(body.orgUnitId);
    const headcountCeiling = nonNegativeInt(body.headcountCeiling);
    const annualBudgetCeiling = nonNegativeMoney(body.annualBudgetCeiling);
    const notes = String(body.notes ?? "").trim().slice(0, 2000) || null;
    if (
      !Number.isInteger(planId)
      || planId <= 0
      || !Number.isInteger(orgUnitId)
      || orgUnitId <= 0
      || Number.isNaN(headcountCeiling)
      || Number.isNaN(annualBudgetCeiling)
    ) {
      return Response.json({
        error: "planId, orgUnitId, and non-negative headcount/budget ceilings are required.",
      }, { status: 400 });
    }

    const [[plan], [unit]] = await Promise.all([
      db.select().from(workforcePlans).where(and(
        eq(workforcePlans.id, planId),
        eq(workforcePlans.organizationId, organizationId),
      )).limit(1),
      db.select().from(orgUnits).where(and(
        eq(orgUnits.id, orgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1),
    ]);
    if (!plan) return Response.json({ error: "Workforce plan not found." }, { status: 404 });
    if (!unit?.active) return Response.json({ error: "Active organization unit not found." }, { status: 404 });

    try {
      const row = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from workforce_plans where id = ${planId} for update`);

        const allocations = await tx.select().from(workforcePlanAllocations)
          .where(and(
            eq(workforcePlanAllocations.organizationId, organizationId),
            eq(workforcePlanAllocations.planId, planId),
          ));
        const existing = allocations.find((allocation) => allocation.orgUnitId === orgUnitId) ?? null;
        const otherBudget = allocations
          .filter((allocation) => allocation.orgUnitId !== orgUnitId)
          .reduce((sum, allocation) => sum + Number(allocation.annualBudgetCeiling), 0);
        const planBudget = Number(plan.budget);
        if (otherBudget + annualBudgetCeiling > planBudget + 0.005) {
          throw new Error("ALLOCATION_EXCEEDS_PLAN_BUDGET");
        }

        const activeRequests = await tx.select().from(workforcePlanManagerSubmissions).where(and(
          eq(workforcePlanManagerSubmissions.organizationId, organizationId),
          eq(workforcePlanManagerSubmissions.planId, planId),
          eq(workforcePlanManagerSubmissions.orgUnitId, orgUnitId),
          inArray(workforcePlanManagerSubmissions.status, ["submitted", "accepted"]),
        ));
        const requestBeyondCeiling = activeRequests.find((submission) =>
          submission.requestedHeadcount > headcountCeiling
          || Number(submission.requestedAnnualBudget) > annualBudgetCeiling + 0.005
        );
        if (requestBeyondCeiling) {
          throw new Error("ALLOCATION_BELOW_ACTIVE_REQUEST");
        }

        if (existing) {
          const [updated] = await tx.update(workforcePlanAllocations).set({
            headcountCeiling,
            annualBudgetCeiling: annualBudgetCeiling.toFixed(2),
            notes,
            updatedByUserId: user.id,
            updatedAt: new Date(),
          }).where(eq(workforcePlanAllocations.id, existing.id)).returning();
          return updated;
        }

        const [created] = await tx.insert(workforcePlanAllocations).values({
          organizationId,
          planId,
          orgUnitId,
          headcountCeiling,
          annualBudgetCeiling: annualBudgetCeiling.toFixed(2),
          notes,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        }).returning();
        return created;
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce plan allocation saved",
        resource: `${plan.name} · ${unit.name}`,
        metadata: {
          allocationId: row.id,
          planId,
          orgUnitId,
          headcountCeiling,
          annualBudgetCeiling,
        },
      });

      return Response.json({ allocation: row }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "ALLOCATION_EXCEEDS_PLAN_BUDGET") {
        return Response.json({
          error: "Org-unit allocations cannot exceed the workforce plan's annual budget.",
        }, { status: 409 });
      }
      if (error instanceof Error && error.message === "ALLOCATION_BELOW_ACTIVE_REQUEST") {
        return Response.json({
          error: "This allocation cannot be reduced below a submitted or accepted manager request. Resolve or supersede that request first.",
        }, { status: 409 });
      }
      throw error;
    }
  }

  if (entityType === "submission") {
    const allocationId = Number(body.allocationId);
    const requestedHeadcount = nonNegativeInt(body.requestedHeadcount);
    const requestedAnnualBudget = nonNegativeMoney(body.requestedAnnualBudget);
    const rationale = String(body.rationale ?? "").trim().slice(0, 4000);
    if (
      !Number.isInteger(allocationId)
      || allocationId <= 0
      || Number.isNaN(requestedHeadcount)
      || Number.isNaN(requestedAnnualBudget)
      || rationale.length < 5
    ) {
      return Response.json({
        error: "allocationId, non-negative requested headcount/budget, and a rationale are required.",
      }, { status: 400 });
    }

    const [allocation] = await db.select().from(workforcePlanAllocations).where(and(
      eq(workforcePlanAllocations.id, allocationId),
      eq(workforcePlanAllocations.organizationId, organizationId),
    )).limit(1);
    if (!allocation) return Response.json({ error: "Workforce-plan allocation not found." }, { status: 404 });
    if (!visibleToAccess(allocation.orgUnitId, access)) {
      return Response.json({ error: "This allocation is outside your assigned organization unit." }, { status: 403 });
    }

    const [plan] = await db.select().from(workforcePlans).where(and(
      eq(workforcePlans.id, allocation.planId),
      eq(workforcePlans.organizationId, organizationId),
    )).limit(1);
    if (!plan) return Response.json({ error: "Workforce plan not found." }, { status: 404 });
    if (
      requestedHeadcount > allocation.headcountCeiling
      || requestedAnnualBudget > Number(allocation.annualBudgetCeiling) + 0.005
    ) {
      return Response.json({
        error: "The manager request exceeds the current top-down headcount or budget allocation.",
      }, { status: 409 });
    }

    try {
      const created = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from workforce_plan_allocations where id = ${allocationId} for update`);
        const [freshAllocation] = await tx.select().from(workforcePlanAllocations)
          .where(eq(workforcePlanAllocations.id, allocationId))
          .limit(1);
        if (!freshAllocation) throw new Error("ALLOCATION_MISSING");
        if (
          requestedHeadcount > freshAllocation.headcountCeiling
          || requestedAnnualBudget > Number(freshAllocation.annualBudgetCeiling) + 0.005
        ) {
          throw new Error("REQUEST_EXCEEDS_ALLOCATION");
        }

        const [latest] = await tx.select().from(workforcePlanManagerSubmissions).where(and(
          eq(workforcePlanManagerSubmissions.planId, freshAllocation.planId),
          eq(workforcePlanManagerSubmissions.orgUnitId, freshAllocation.orgUnitId),
        )).orderBy(desc(workforcePlanManagerSubmissions.version)).limit(1);
        if (latest && ["draft", "submitted"].includes(latest.status)) {
          throw new Error("OPEN_MANAGER_REQUEST_EXISTS");
        }
        const version = (latest?.version ?? 0) + 1;

        const [row] = await tx.insert(workforcePlanManagerSubmissions).values({
          organizationId,
          planId: freshAllocation.planId,
          allocationId: freshAllocation.id,
          orgUnitId: freshAllocation.orgUnitId,
          version,
          requestedHeadcount,
          requestedAnnualBudget: requestedAnnualBudget.toFixed(2),
          rationale,
          status: "draft",
          allocationSnapshot: allocationEvidence(freshAllocation, plan.budget),
          createdByUserId: user.id,
        }).returning();
        return row;
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce manager request drafted",
        resource: `${plan.name} · org unit #${allocation.orgUnitId} · v${created.version}`,
        metadata: {
          submissionId: created.id,
          allocationId,
          planId: allocation.planId,
          orgUnitId: allocation.orgUnitId,
          requestedHeadcount,
          requestedAnnualBudget,
        },
      });
      return Response.json({ submission: created }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "OPEN_MANAGER_REQUEST_EXISTS") {
        return Response.json({
          error: "This org unit already has a draft or submitted request for the plan. Resolve it before creating another version.",
        }, { status: 409 });
      }
      if (error instanceof Error && error.message === "REQUEST_EXCEEDS_ALLOCATION") {
        return Response.json({
          error: "The allocation changed and this request now exceeds the current ceiling.",
        }, { status: 409 });
      }
      throw error;
    }
  }

  return Response.json({ error: "entityType must be allocation or submission." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce manager submissions");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const submissionId = Number(body.submissionId);
  const action = String(body.action ?? "");
  const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 2000) || null;
  if (
    !Number.isInteger(submissionId)
    || submissionId <= 0
    || !["submit", "accept", "reject"].includes(action)
  ) {
    return Response.json({ error: "submissionId and a valid action are required." }, { status: 400 });
  }

  const [submission] = await db.select().from(workforcePlanManagerSubmissions)
    .where(eq(workforcePlanManagerSubmissions.id, submissionId))
    .limit(1);
  if (!submission) return Response.json({ error: "Manager submission not found." }, { status: 404 });

  const access = await workforceAccess(user.id, submission.organizationId);
  if (!access || !visibleToAccess(submission.orgUnitId, access)) {
    return Response.json({ error: "This manager submission is outside your workforce scope." }, { status: 403 });
  }

  if (action === "submit") {
    if (submission.status !== "draft") {
      return Response.json({ error: "Only draft manager requests can be submitted." }, { status: 409 });
    }
    if (submission.createdByUserId !== user.id) {
      return Response.json({ error: "Only the manager who drafted this request can submit it." }, { status: 403 });
    }

    const [allocation] = await db.select().from(workforcePlanAllocations)
      .where(eq(workforcePlanAllocations.id, submission.allocationId))
      .limit(1);
    if (!allocation) return Response.json({ error: "The linked workforce allocation no longer exists." }, { status: 409 });
    if (
      submission.requestedHeadcount > allocation.headcountCeiling
      || Number(submission.requestedAnnualBudget) > Number(allocation.annualBudgetCeiling) + 0.005
    ) {
      return Response.json({
        error: "The current allocation is lower than this draft. Create a revised request within the current ceiling.",
      }, { status: 409 });
    }

    const [plan] = await db.select().from(workforcePlans)
      .where(eq(workforcePlans.id, submission.planId))
      .limit(1);
    if (!plan) return Response.json({ error: "Workforce plan not found." }, { status: 404 });

    const now = new Date();
    const [updated] = await db.update(workforcePlanManagerSubmissions).set({
      status: "submitted",
      allocationSnapshot: allocationEvidence(allocation, plan.budget),
      submittedByUserId: user.id,
      submittedAt: now,
      updatedAt: now,
    }).where(and(
      eq(workforcePlanManagerSubmissions.id, submissionId),
      eq(workforcePlanManagerSubmissions.status, "draft"),
    )).returning();
    if (!updated) return Response.json({ error: "The request changed before submission. Reload and try again." }, { status: 409 });

    await recordAuditEvent({
      organizationId: submission.organizationId,
      actor: user.name,
      action: "Workforce manager request submitted",
      resource: `Plan #${submission.planId} · org unit #${submission.orgUnitId} · v${submission.version}`,
      metadata: {
        submissionId,
        allocationId: submission.allocationId,
        requestedHeadcount: submission.requestedHeadcount,
        requestedAnnualBudget: Number(submission.requestedAnnualBudget),
      },
    });
    return Response.json({ submission: updated });
  }

  const denied = await assertOrganizationRole(
    user.id,
    submission.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only company-wide People administrators can decide manager planning requests.",
  );
  if (denied) return denied;
  if (!access.companyWide) {
    return Response.json({ error: "Manager-request decisions require company-wide access." }, { status: 403 });
  }
  if (submission.status !== "submitted") {
    return Response.json({ error: "Only submitted manager requests can be decided." }, { status: 409 });
  }
  if (submission.submittedByUserId === user.id) {
    return Response.json({ error: "The request submitter cannot decide their own workforce request." }, { status: 409 });
  }
  if (action === "reject" && (!decisionNote || decisionNote.length < 5)) {
    return Response.json({ error: "A written decision note is required when rejecting a manager request." }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from workforce_plan_allocations where id = ${submission.allocationId} for update`);
      await tx.execute(sql`select id from workforce_plan_manager_submissions where id = ${submissionId} for update`);

      const [freshSubmission] = await tx.select().from(workforcePlanManagerSubmissions)
        .where(eq(workforcePlanManagerSubmissions.id, submissionId))
        .limit(1);
      if (!freshSubmission || freshSubmission.status !== "submitted") {
        throw new Error("SUBMISSION_DECISION_CONFLICT");
      }

      const [allocation] = await tx.select().from(workforcePlanAllocations)
        .where(eq(workforcePlanAllocations.id, freshSubmission.allocationId))
        .limit(1);
      if (!allocation) throw new Error("ALLOCATION_MISSING");

      if (action === "accept") {
        if (
          freshSubmission.requestedHeadcount > allocation.headcountCeiling
          || Number(freshSubmission.requestedAnnualBudget) > Number(allocation.annualBudgetCeiling) + 0.005
        ) {
          throw new Error("REQUEST_EXCEEDS_ALLOCATION");
        }
        await tx.update(workforcePlanManagerSubmissions).set({
          status: "superseded",
          updatedAt: new Date(),
        }).where(and(
          eq(workforcePlanManagerSubmissions.planId, freshSubmission.planId),
          eq(workforcePlanManagerSubmissions.orgUnitId, freshSubmission.orgUnitId),
          eq(workforcePlanManagerSubmissions.status, "accepted"),
        ));
      }

      const now = new Date();
      const nextStatus = action === "accept" ? "accepted" : "rejected";
      const [updated] = await tx.update(workforcePlanManagerSubmissions).set({
        status: nextStatus,
        decidedByUserId: user.id,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      }).where(and(
        eq(workforcePlanManagerSubmissions.id, submissionId),
        eq(workforcePlanManagerSubmissions.status, "submitted"),
      )).returning();
      if (!updated) throw new Error("SUBMISSION_DECISION_CONFLICT");
      return updated;
    });

    await recordAuditEvent({
      organizationId: submission.organizationId,
      actor: user.name,
      action: action === "accept"
        ? "Workforce manager request accepted"
        : "Workforce manager request rejected",
      resource: `Plan #${submission.planId} · org unit #${submission.orgUnitId} · v${submission.version}`,
      metadata: {
        submissionId,
        allocationId: submission.allocationId,
        requestedHeadcount: submission.requestedHeadcount,
        requestedAnnualBudget: Number(submission.requestedAnnualBudget),
        decisionNote,
      },
    });
    return Response.json({ submission: result });
  } catch (error) {
    if (error instanceof Error && error.message === "SUBMISSION_DECISION_CONFLICT") {
      return Response.json({ error: "This request was already decided. Reload to see the current state." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "REQUEST_EXCEEDS_ALLOCATION") {
      return Response.json({
        error: "The top-down allocation changed and this request now exceeds the current ceiling.",
      }, { status: 409 });
    }
    throw error;
  }
}
