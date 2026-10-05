import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  compensationBands,
  compensationBudgetPools,
  compensationCycles,
  compensationRecommendations,
  employeePayProfiles,
  employeePayRevisions,
  employees,
  jobProfiles,
  orgUnits,
  payrollEntries,
  payrollRuns,
  performanceReviews,
  positionAssignments,
  positions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  APPROVAL_ADMIN_ROLES,
  assertOrganizationRole,
  assertScope,
  getAccess,
  PAYROLL_OPERATOR_ROLES,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const COMPENSATION_VIEW_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager", "payroll"] as const;
const ADJUSTMENT_TYPES = ["merit", "promotion", "market", "equity", "retention", "other"] as const;

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return { error: Response.json({ error: "Employee not found in this workspace." }, { status: 404 }) };
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return { error: Response.json({ error: scope.error }, { status: scope.status }) };
  return { access, employee };
}

async function activePositionForEmployee(organizationId: number, employeeId: number) {
  const [assignment] = await db.select().from(positionAssignments)
    .where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, employeeId),
      isNull(positionAssignments.effectiveUntil),
    ))
    .orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id))
    .limit(1);
  if (!assignment) return { assignment: null, position: null };
  const [position] = await db.select().from(positions)
    .where(and(eq(positions.id, assignment.positionId), eq(positions.organizationId, organizationId)))
    .limit(1);
  return { assignment, position: position ?? null };
}

async function matchingBand(organizationId: number, jobProfileId: number | null, orgUnitId: number | null) {
  if (!jobProfileId) return null;
  const rows = await db.select().from(compensationBands)
    .where(and(eq(compensationBands.organizationId, organizationId), eq(compensationBands.jobProfileId, jobProfileId), eq(compensationBands.active, true)));
  return rows.find((row) => row.orgUnitId === orgUnitId)
    ?? rows.find((row) => row.orgUnitId === null)
    ?? null;
}

async function cycleBudgetUsage(cycleId: number, orgUnitId: number | null, excludeRecommendationId?: number) {
  const rows = await db.select().from(compensationRecommendations)
    .where(eq(compensationRecommendations.cycleId, cycleId));
  return rows
    .filter((row) => ["submitted", "approved", "applied"].includes(row.status))
    .filter((row) => orgUnitId === null || row.orgUnitId === orgUnitId)
    .filter((row) => !excludeRecommendationId || row.id !== excludeRecommendationId)
    .reduce((sum, row) => sum + Number(row.annualizedIncrease), 0);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    COMPENSATION_VIEW_ROLES,
    "Your role is not allowed to view compensation management.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [staff, payProfiles, assignments, positionRows, profileRows, bands, cycles, pools, recommendations, reviews, units] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, organizationId)),
    db.select().from(positionAssignments).where(and(eq(positionAssignments.organizationId, organizationId), isNull(positionAssignments.effectiveUntil))),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId)),
    db.select().from(compensationBands).where(eq(compensationBands.organizationId, organizationId)).orderBy(desc(compensationBands.id)),
    db.select().from(compensationCycles).where(eq(compensationCycles.organizationId, organizationId)).orderBy(desc(compensationCycles.effectiveDate)),
    db.select().from(compensationBudgetPools).where(eq(compensationBudgetPools.organizationId, organizationId)),
    db.select().from(compensationRecommendations).where(eq(compensationRecommendations.organizationId, organizationId)).orderBy(desc(compensationRecommendations.id)),
    db.select().from(performanceReviews).where(eq(performanceReviews.organizationId, organizationId)).orderBy(desc(performanceReviews.completedAt), desc(performanceReviews.id)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
  ]);

  const visibleEmployees = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));
  const payByEmployee = new Map(payProfiles.map((profile) => [profile.employeeId, profile]));
  const positionById = new Map(positionRows.map((position) => [position.id, position]));
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const assignmentByEmployee = new Map(assignments.map((assignment) => [assignment.employeeId, assignment]));
  const latestReviewByEmployee = new Map<number, typeof reviews[number]>();
  for (const review of reviews) {
    if (review.status === "completed" && !latestReviewByEmployee.has(review.employeeId)) {
      latestReviewByEmployee.set(review.employeeId, review);
    }
  }

  const employeeCompensation = visibleEmployees.map((employee) => {
    const pay = payByEmployee.get(employee.id) ?? null;
    const assignment = assignmentByEmployee.get(employee.id) ?? null;
    const position = assignment ? positionById.get(assignment.positionId) ?? null : null;
    const profile = position ? profileById.get(position.jobProfileId) ?? null : null;
    const exactBand = profile
      ? bands.find((band) => band.active && band.jobProfileId === profile.id && band.orgUnitId === employee.orgUnitId)
        ?? bands.find((band) => band.active && band.jobProfileId === profile.id && band.orgUnitId === null)
        ?? null
      : null;
    const currentMonthlyRate = pay?.payBasis === "monthly" ? Number(pay.rateAmount) : null;
    const midpoint = exactBand ? Number(exactBand.midpointMonthly) : null;
    return {
      employee,
      payProfile: pay,
      assignment,
      position,
      jobProfile: profile,
      band: exactBand,
      currentMonthlyRate,
      compaRatio: currentMonthlyRate !== null && midpoint && midpoint > 0 ? currentMonthlyRate / midpoint : null,
      latestPerformanceReview: latestReviewByEmployee.get(employee.id) ?? null,
    };
  });

  return Response.json({
    bands,
    cycles,
    pools: access.companyWide ? pools : pools.filter((pool) => pool.orgUnitId === access.orgUnitId),
    recommendations: recommendations.filter((row) => visibleIds.has(row.employeeId)),
    employees: employeeCompensation,
    jobProfiles: profileRows,
    orgUnits: access.companyWide ? units : units.filter((unit) => unit.id === access.orgUnitId),
    access,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  if (entityType === "band") {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "Only People administrators can manage salary bands.");
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Salary band architecture requires company-wide access." }, { status: 403 });

    const jobProfileId = Number(body.jobProfileId);
    const orgUnitId = body.orgUnitId ? Number(body.orgUnitId) : null;
    const minimum = money(body.minimumMonthly);
    const midpoint = money(body.midpointMonthly);
    const maximum = money(body.maximumMonthly);
    if (!Number.isInteger(jobProfileId) || !Number.isFinite(minimum) || !Number.isFinite(midpoint) || !Number.isFinite(maximum) || minimum <= 0 || minimum > midpoint || midpoint > maximum) {
      return Response.json({ error: "A job profile and ordered positive minimum, midpoint, and maximum are required." }, { status: 400 });
    }
    const [profile] = await db.select({ id: jobProfiles.id }).from(jobProfiles)
      .where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1);
    if (!profile) return Response.json({ error: "Job profile not found in this workspace." }, { status: 404 });
    if (orgUnitId) {
      const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits)
        .where(and(eq(orgUnits.id, orgUnitId), eq(orgUnits.organizationId, organizationId))).limit(1);
      if (!unit) return Response.json({ error: "Organization unit not found in this workspace." }, { status: 404 });
    }
    const locationKey = orgUnitId ? "org-unit:" + orgUnitId : "company";
    const [row] = await db.insert(compensationBands).values({
      organizationId,
      jobProfileId,
      orgUnitId,
      locationKey,
      currency: "PHP",
      minimumMonthly: minimum.toFixed(2),
      midpointMonthly: midpoint.toFixed(2),
      maximumMonthly: maximum.toFixed(2),
      active: true,
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: [compensationBands.organizationId, compensationBands.jobProfileId, compensationBands.locationKey],
      set: {
        orgUnitId,
        minimumMonthly: minimum.toFixed(2),
        midpointMonthly: midpoint.toFixed(2),
        maximumMonthly: maximum.toFixed(2),
        active: true,
        updatedAt: new Date(),
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Compensation band saved",
      resource: "Job profile #" + jobProfileId + " / " + locationKey,
      metadata: { bandId: row.id, minimum, midpoint, maximum, orgUnitId },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "cycle") {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "Only People administrators can create compensation cycles.");
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Compensation cycles require company-wide access." }, { status: 403 });

    const name = String(body.name ?? "").trim();
    const effectiveDate = String(body.effectiveDate ?? "");
    const totalBudget = money(body.totalBudget ?? 0);
    if (!name || !validDate(effectiveDate) || !Number.isFinite(totalBudget) || totalBudget < 0) {
      return Response.json({ error: "name, YYYY-MM-DD effectiveDate, and a non-negative totalBudget are required." }, { status: 400 });
    }
    try {
      const [row] = await db.insert(compensationCycles).values({
        organizationId,
        name: name.slice(0, 160),
        effectiveDate,
        totalBudget: totalBudget.toFixed(2),
        status: "open",
        createdByUserId: user.id,
        createdBy: user.name,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Compensation cycle created",
        resource: row.name,
        metadata: { cycleId: row.id, effectiveDate, totalBudget },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A compensation cycle with this name and effective date already exists." }, { status: 409 });
    }
  }

  if (entityType === "pool") {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "Only People administrators can allocate compensation budgets.");
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Budget pools require company-wide access." }, { status: 403 });

    const cycleId = Number(body.cycleId);
    const orgUnitId = Number(body.orgUnitId);
    const managerEmployeeId = body.managerEmployeeId ? Number(body.managerEmployeeId) : null;
    const budget = money(body.budget);
    if (!Number.isInteger(cycleId) || !Number.isInteger(orgUnitId) || !Number.isFinite(budget) || budget < 0) {
      return Response.json({ error: "cycleId, orgUnitId, and a non-negative budget are required." }, { status: 400 });
    }
    const [cycle] = await db.select().from(compensationCycles)
      .where(and(eq(compensationCycles.id, cycleId), eq(compensationCycles.organizationId, organizationId))).limit(1);
    if (!cycle) return Response.json({ error: "Compensation cycle not found." }, { status: 404 });
    if (cycle.status !== "open") return Response.json({ error: "Budget pools can only be changed while the cycle is open." }, { status: 409 });
    const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), eq(orgUnits.organizationId, organizationId))).limit(1);
    if (!unit) return Response.json({ error: "Organization unit not found." }, { status: 404 });
    if (managerEmployeeId) {
      const [manager] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
        .where(and(eq(employees.id, managerEmployeeId), eq(employees.organizationId, organizationId))).limit(1);
      if (!manager) return Response.json({ error: "Manager employee not found." }, { status: 404 });
      if (manager.orgUnitId !== orgUnitId) {
        return Response.json({ error: "The budget-pool manager must belong to the same organization unit." }, { status: 409 });
      }
    }

    const existingPools = await db.select().from(compensationBudgetPools).where(eq(compensationBudgetPools.cycleId, cycleId));
    const allocatedElsewhere = existingPools.filter((pool) => pool.orgUnitId !== orgUnitId).reduce((sum, pool) => sum + Number(pool.budget), 0);
    if (allocatedElsewhere + budget > Number(cycle.totalBudget) + 0.005) {
      return Response.json({ error: "Org-unit budget pools cannot exceed the cycle's total budget." }, { status: 409 });
    }

    const [row] = await db.insert(compensationBudgetPools).values({
      organizationId,
      cycleId,
      orgUnitId,
      managerEmployeeId,
      budget: budget.toFixed(2),
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: [compensationBudgetPools.cycleId, compensationBudgetPools.orgUnitId],
      set: { managerEmployeeId, budget: budget.toFixed(2), updatedAt: new Date() },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Compensation budget pool saved",
      resource: "Cycle #" + cycleId + " / org unit #" + orgUnitId,
      metadata: { poolId: row.id, budget, managerEmployeeId },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "recommendation") {
    const denied = await assertOrganizationRole(user.id, organizationId, WORKFORCE_MANAGER_ROLES, "Your role cannot propose compensation changes.");
    if (denied) return denied;

    const cycleId = Number(body.cycleId);
    const employeeId = Number(body.employeeId);
    const proposedMonthlyRate = money(body.proposedMonthlyRate);
    const adjustmentType = String(body.adjustmentType ?? "merit");
    const rationale = String(body.rationale ?? "").trim();
    if (!Number.isInteger(cycleId) || !Number.isInteger(employeeId) || !Number.isFinite(proposedMonthlyRate) || proposedMonthlyRate <= 0) {
      return Response.json({ error: "cycleId, employeeId, and a positive proposed monthly rate are required." }, { status: 400 });
    }
    if (!ADJUSTMENT_TYPES.includes(adjustmentType as (typeof ADJUSTMENT_TYPES)[number])) {
      return Response.json({ error: "Invalid adjustment type." }, { status: 400 });
    }

    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    const employee = scoped.employee;

    const [cycle] = await db.select().from(compensationCycles)
      .where(and(eq(compensationCycles.id, cycleId), eq(compensationCycles.organizationId, organizationId))).limit(1);
    if (!cycle) return Response.json({ error: "Compensation cycle not found." }, { status: 404 });
    if (cycle.status !== "open") return Response.json({ error: "Recommendations can only be submitted while the cycle is open." }, { status: 409 });

    const [pay] = await db.select().from(employeePayProfiles)
      .where(and(eq(employeePayProfiles.employeeId, employeeId), eq(employeePayProfiles.organizationId, organizationId))).limit(1);
    if (!pay) return Response.json({ error: "Employee pay profile is missing." }, { status: 409 });
    if (pay.payBasis !== "monthly") {
      return Response.json({ error: "Compensation cycles currently support monthly-paid employees only." }, { status: 409 });
    }

    const { position } = await activePositionForEmployee(organizationId, employeeId);
    const band = await matchingBand(organizationId, position?.jobProfileId ?? null, employee.orgUnitId);
    const latestReview = (await db.select().from(performanceReviews)
      .where(and(eq(performanceReviews.organizationId, organizationId), eq(performanceReviews.employeeId, employeeId)))
      .orderBy(desc(performanceReviews.completedAt), desc(performanceReviews.id)))
      .find((review) => review.status === "completed") ?? null;

    const currentMonthlyRate = Number(pay.rateAmount);
    const annualizedIncrease = Math.max(0, (proposedMonthlyRate - currentMonthlyRate) * 12);
    const [pool] = employee.orgUnitId
      ? await db.select().from(compensationBudgetPools)
          .where(and(eq(compensationBudgetPools.cycleId, cycleId), eq(compensationBudgetPools.orgUnitId, employee.orgUnitId))).limit(1)
      : [];

    const usage = await cycleBudgetUsage(cycleId, pool ? employee.orgUnitId : null);
    const budgetLimit = pool ? Number(pool.budget) : Number(cycle.totalBudget);
    if (usage + annualizedIncrease > budgetLimit + 0.005) {
      return Response.json({
        error: pool
          ? "This recommendation would exceed the employee's org-unit compensation budget."
          : "This recommendation would exceed the compensation cycle budget.",
      }, { status: 409 });
    }

    try {
      const [row] = await db.insert(compensationRecommendations).values({
        organizationId,
        cycleId,
        employeeId,
        orgUnitId: employee.orgUnitId,
        positionId: position?.id ?? null,
        bandId: band?.id ?? null,
        performanceReviewId: latestReview?.id ?? null,
        adjustmentType,
        currentMonthlyRate: currentMonthlyRate.toFixed(2),
        proposedMonthlyRate: proposedMonthlyRate.toFixed(2),
        annualizedIncrease: annualizedIncrease.toFixed(2),
        rationale: rationale.slice(0, 8000) || null,
        bandExceptionReason: body.bandExceptionReason ? String(body.bandExceptionReason).slice(0, 4000) : null,
        status: "submitted",
        proposedByUserId: user.id,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Compensation recommendation submitted",
        resource: employee.firstName + " " + employee.lastName,
        metadata: {
          recommendationId: row.id,
          cycleId,
          employeeId,
          currentMonthlyRate,
          proposedMonthlyRate,
          annualizedIncrease,
          bandId: band?.id ?? null,
          performanceReviewId: latestReview?.id ?? null,
        },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This employee already has a recommendation in the selected cycle." }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be band, cycle, pool, or recommendation." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const recommendationId = Number(body.recommendationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(recommendationId)) return Response.json({ error: "recommendationId is required." }, { status: 400 });

  const [recommendation] = await db.select().from(compensationRecommendations)
    .where(eq(compensationRecommendations.id, recommendationId)).limit(1);
  if (!recommendation) return Response.json({ error: "Compensation recommendation not found." }, { status: 404 });

  const scoped = await scopedEmployee(user.id, recommendation.organizationId, recommendation.employeeId);
  if ("error" in scoped) return scoped.error;

  if (action === "approve" || action === "reject") {
    const denied = await assertOrganizationRole(
      user.id,
      recommendation.organizationId,
      APPROVAL_ADMIN_ROLES,
      "Only compensation approvers can decide recommendations.",
    );
    if (denied) return denied;
    if (recommendation.status !== "submitted") {
      return Response.json({ error: "Only submitted recommendations can be decided." }, { status: 409 });
    }
    if (recommendation.proposedByUserId === user.id) {
      return Response.json({ error: "Four-eyes control: the proposer cannot approve or reject their own compensation recommendation." }, { status: 409 });
    }

    if (action === "reject") {
      const [row] = await db.update(compensationRecommendations).set({
        status: "rejected",
        approvedByUserId: user.id,
        approvedAt: new Date(),
        decisionNote: body.decisionNote ? String(body.decisionNote).slice(0, 4000) : "Rejected",
        updatedAt: new Date(),
      }).where(eq(compensationRecommendations.id, recommendationId)).returning();

      await recordAuditEvent({
        organizationId: recommendation.organizationId,
        actor: user.name,
        action: "Compensation recommendation rejected",
        resource: "Recommendation #" + recommendationId,
        metadata: { recommendationId, employeeId: recommendation.employeeId },
      });
      return Response.json(row);
    }

    const band = recommendation.bandId
      ? (await db.select().from(compensationBands).where(eq(compensationBands.id, recommendation.bandId)).limit(1))[0]
      : null;
    const proposed = Number(recommendation.proposedMonthlyRate);
    const outsideBand = band
      ? proposed < Number(band.minimumMonthly) || proposed > Number(band.maximumMonthly)
      : false;
    const exceptionReason = String(body.bandExceptionReason ?? recommendation.bandExceptionReason ?? "").trim();
    if (outsideBand && !exceptionReason) {
      return Response.json({ error: "An explicit band exception reason is required before approving pay outside the salary range." }, { status: 409 });
    }

    const [cycle] = await db.select().from(compensationCycles)
      .where(eq(compensationCycles.id, recommendation.cycleId)).limit(1);
    if (!cycle || cycle.status !== "open") {
      return Response.json({ error: "The compensation cycle is no longer open for approvals." }, { status: 409 });
    }
    const [pool] = recommendation.orgUnitId
      ? await db.select().from(compensationBudgetPools)
          .where(and(eq(compensationBudgetPools.cycleId, recommendation.cycleId), eq(compensationBudgetPools.orgUnitId, recommendation.orgUnitId))).limit(1)
      : [];
    const usage = await cycleBudgetUsage(recommendation.cycleId, pool ? recommendation.orgUnitId : null, recommendation.id);
    const limit = pool ? Number(pool.budget) : Number(cycle.totalBudget);
    if (usage + Number(recommendation.annualizedIncrease) > limit + 0.005) {
      return Response.json({ error: "Budget changed after submission; this recommendation no longer fits the available compensation budget." }, { status: 409 });
    }

    const [row] = await db.update(compensationRecommendations).set({
      status: "approved",
      approvedByUserId: user.id,
      approvedAt: new Date(),
      bandExceptionReason: exceptionReason || null,
      decisionNote: body.decisionNote ? String(body.decisionNote).slice(0, 4000) : "Approved",
      updatedAt: new Date(),
    }).where(eq(compensationRecommendations.id, recommendationId)).returning();

    await recordAuditEvent({
      organizationId: recommendation.organizationId,
      actor: user.name,
      action: "Compensation recommendation approved",
      resource: "Recommendation #" + recommendationId,
      metadata: { recommendationId, employeeId: recommendation.employeeId, outsideBand },
    });
    return Response.json(row);
  }

  if (action === "apply") {
    const denied = await assertOrganizationRole(
      user.id,
      recommendation.organizationId,
      PAYROLL_OPERATOR_ROLES,
      "Only payroll operators can apply approved compensation changes.",
    );
    if (denied) return denied;
    if (recommendation.status !== "approved" || !recommendation.approvedByUserId) {
      return Response.json({ error: "Only approved compensation recommendations can be applied." }, { status: 409 });
    }
    if (recommendation.proposedByUserId === user.id) {
      return Response.json({ error: "Four-eyes control: the proposer cannot apply their own compensation recommendation." }, { status: 409 });
    }

    const [cycle] = await db.select().from(compensationCycles)
      .where(eq(compensationCycles.id, recommendation.cycleId)).limit(1);
    if (!cycle) return Response.json({ error: "Compensation cycle not found." }, { status: 409 });
    const effectiveDate = String(cycle.effectiveDate);
    const today = todayPh();
    if (effectiveDate > today) {
      return Response.json({ error: "This approved change is scheduled for " + effectiveDate + " and cannot be applied early." }, { status: 409 });
    }

    const [pay] = await db.select().from(employeePayProfiles)
      .where(and(eq(employeePayProfiles.employeeId, recommendation.employeeId), eq(employeePayProfiles.organizationId, recommendation.organizationId))).limit(1);
    if (!pay || pay.payBasis !== "monthly") {
      return Response.json({ error: "The employee no longer has a monthly pay profile." }, { status: 409 });
    }
    if (Math.abs(Number(pay.rateAmount) - Number(recommendation.currentMonthlyRate)) > 0.005) {
      return Response.json({ error: "The employee's pay changed after this recommendation was submitted. Recreate the recommendation from the current pay record." }, { status: 409 });
    }

    const [laterRevision] = await db.select().from(employeePayRevisions)
      .where(and(eq(employeePayRevisions.organizationId, recommendation.organizationId), eq(employeePayRevisions.employeeId, recommendation.employeeId)))
      .orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
      .limit(1);
    if (laterRevision && String(laterRevision.effectiveDate) >= effectiveDate) {
      return Response.json({ error: "An equal or later effective-dated pay revision already exists for this employee." }, { status: 409 });
    }

    if (effectiveDate < today) {
      const [released] = await db.select({ runId: payrollRuns.id, periodLabel: payrollRuns.periodLabel }).from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(
          eq(payrollEntries.employeeId, recommendation.employeeId),
          eq(payrollRuns.organizationId, recommendation.organizationId),
          eq(payrollRuns.status, "Released"),
          gte(payrollRuns.periodEnd, effectiveDate),
        ))
        .orderBy(desc(payrollRuns.periodEnd))
        .limit(1);
      if (released) {
        return Response.json({
          error: "Released payroll exists after this cycle's effective date. Apply this change through the retro-pay reconciliation flow instead of silently rewriting payroll history.",
        }, { status: 409 });
      }
    }

    const proposed = Number(recommendation.proposedMonthlyRate);
    const result = await db.transaction(async (tx) => {
      const [revision] = await tx.insert(employeePayRevisions).values({
        employeeId: recommendation.employeeId,
        organizationId: recommendation.organizationId,
        effectiveDate,
        previousPayBasis: pay.payBasis,
        previousRateAmount: Number(pay.rateAmount).toFixed(2),
        previousStandardWorkDaysPerMonth: Number(pay.standardWorkDaysPerMonth).toFixed(2),
        previousStandardHoursPerDay: Number(pay.standardHoursPerDay).toFixed(2),
        newPayBasis: "monthly",
        newRateAmount: proposed.toFixed(2),
        newStandardWorkDaysPerMonth: Number(pay.standardWorkDaysPerMonth).toFixed(2),
        newStandardHoursPerDay: Number(pay.standardHoursPerDay).toFixed(2),
        reason: "Compensation cycle: " + cycle.name + " (" + recommendation.adjustmentType + ")",
        createdBy: user.name,
      }).returning();

      await tx.update(employeePayProfiles).set({
        rateAmount: proposed.toFixed(2),
        updatedAt: new Date(),
      }).where(eq(employeePayProfiles.employeeId, recommendation.employeeId));

      await tx.update(employees).set({
        basicRate: proposed.toFixed(2),
      }).where(and(eq(employees.id, recommendation.employeeId), eq(employees.organizationId, recommendation.organizationId)));

      const [updatedRecommendation] = await tx.update(compensationRecommendations).set({
        status: "applied",
        appliedByUserId: user.id,
        appliedPayRevisionId: revision.id,
        appliedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(compensationRecommendations.id, recommendationId)).returning();

      return { revision, recommendation: updatedRecommendation };
    });

    await recordAuditEvent({
      organizationId: recommendation.organizationId,
      actor: user.name,
      action: "Approved compensation change applied to payroll profile",
      resource: "Employee #" + recommendation.employeeId,
      metadata: {
        recommendationId,
        cycleId: recommendation.cycleId,
        payRevisionId: result.revision.id,
        previousMonthlyRate: Number(pay.rateAmount),
        newMonthlyRate: proposed,
        effectiveDate,
      },
    });
    return Response.json(result);
  }

  return Response.json({ error: "action must be approve, reject, or apply." }, { status: 400 });
}
