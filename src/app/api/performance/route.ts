import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  jobProfiles,
  orgUnits,
  performanceCalibrationSessions,
  performanceCycleTemplates,
  performanceCycles,
  performanceGoals,
  performanceReviewItems,
  performanceReviews,
  performanceTemplates,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const PERFORMANCE_ROLES = WORKFORCE_MANAGER_ROLES;

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function score(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n.toFixed(2) : null;
}

function boundedWeight(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n.toFixed(2) : null;
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return { error: Response.json({ error: "Employee not found in this workspace." }, { status: 404 }) };
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return { error: Response.json({ error: scope.error }, { status: scope.status }) };
  return { access, employee };
}

async function cycleInOrganization(organizationId: number, cycleId: number) {
  const [cycle] = await db.select().from(performanceCycles)
    .where(and(eq(performanceCycles.id, cycleId), eq(performanceCycles.organizationId, organizationId)))
    .limit(1);
  return cycle ?? null;
}

async function assertGoalAccess(userId: number, goal: typeof performanceGoals.$inferSelect) {
  const access = await getAccess(userId, goal.organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  if (goal.scope === "company") {
    if (!access.companyWide) {
      return { error: Response.json({ error: "Company goals require company-wide access." }, { status: 403 }) };
    }
    return { access };
  }
  if (goal.scope === "team") {
    const scoped = assertScope(access, goal.orgUnitId);
    if (!scoped.ok) return { error: Response.json({ error: scoped.error }, { status: scoped.status }) };
    return { access };
  }
  if (!goal.employeeId) {
    return { error: Response.json({ error: "Employee goal is missing its employee target." }, { status: 409 }) };
  }
  return scopedEmployee(userId, goal.organizationId, goal.employeeId);
}

async function cycleCompletionReadiness(
  organizationId: number,
  cycle: typeof performanceCycles.$inferSelect,
) {
  const [reviews, cycleLinks, calibrationSessions] = await Promise.all([
    db.select().from(performanceReviews).where(and(
      eq(performanceReviews.organizationId, organizationId),
      eq(performanceReviews.cycleId, cycle.id),
    )),
    db.select().from(performanceCycleTemplates).where(and(
      eq(performanceCycleTemplates.organizationId, organizationId),
      eq(performanceCycleTemplates.cycleId, cycle.id),
    )),
    db.select().from(performanceCalibrationSessions).where(and(
      eq(performanceCalibrationSessions.organizationId, organizationId),
      eq(performanceCalibrationSessions.cycleId, cycle.id),
    )),
  ]);

  const reviewItems = reviews.length
    ? await db.select().from(performanceReviewItems)
        .where(eq(performanceReviewItems.organizationId, organizationId))
    : [];
  const reviewIds = new Set(reviews.map((row) => row.id));
  const relevantItems = reviewItems.filter((row) => reviewIds.has(row.reviewId));
  const requiredTemplateIds = new Set(cycleLinks.filter((row) => row.required).map((row) => row.templateId));

  const openReviews = reviews.filter((row) => row.status !== "completed");
  const missingFinalRatings = reviews.filter((row) => row.status === "completed" && !row.finalScore);
  const missingRequiredItems = reviews.filter((review) =>
    [...requiredTemplateIds].some((templateId) => {
      const item = relevantItems.find((row) => row.reviewId === review.id && row.templateId === templateId);
      return !item?.managerScore || !item?.finalScore;
    }),
  );
  const calibrationFinalized = calibrationSessions.some((session) => session.status === "finalized");
  const calibrationRequiredAndOpen = (cycle.requireCalibration || calibrationSessions.length > 0) && !calibrationFinalized;

  return {
    totalReviews: reviews.length,
    completedReviews: reviews.filter((row) => row.status === "completed").length,
    openReviews: openReviews.length,
    missingFinalRatings: missingFinalRatings.length,
    missingRequiredItems: missingRequiredItems.length,
    calibrationRequired: cycle.requireCalibration,
    calibrationFinalized,
    calibrationRequiredAndOpen,
    ready:
      reviews.length > 0 &&
      openReviews.length === 0 &&
      missingFinalRatings.length === 0 &&
      missingRequiredItems.length === 0 &&
      !calibrationRequiredAndOpen,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PERFORMANCE_ROLES,
    "Your role is not allowed to view performance management.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [staff, units, cycles, goals, reviews, templates, cycleTemplates, reviewItems] = await Promise.all([
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      id: orgUnits.id,
      name: orgUnits.name,
      type: orgUnits.type,
      parentId: orgUnits.parentId,
    }).from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
    db.select().from(performanceCycles)
      .where(eq(performanceCycles.organizationId, organizationId))
      .orderBy(desc(performanceCycles.startDate)),
    db.select().from(performanceGoals)
      .where(eq(performanceGoals.organizationId, organizationId))
      .orderBy(desc(performanceGoals.id)),
    db.select().from(performanceReviews)
      .where(eq(performanceReviews.organizationId, organizationId))
      .orderBy(desc(performanceReviews.id)),
    db.select().from(performanceTemplates)
      .where(eq(performanceTemplates.organizationId, organizationId))
      .orderBy(desc(performanceTemplates.id)),
    db.select().from(performanceCycleTemplates)
      .where(eq(performanceCycleTemplates.organizationId, organizationId))
      .orderBy(desc(performanceCycleTemplates.id)),
    db.select().from(performanceReviewItems)
      .where(eq(performanceReviewItems.organizationId, organizationId))
      .orderBy(desc(performanceReviewItems.id)),
  ]);

  const visibleEmployees = access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));
  const visibleReviews = reviews.filter((row) => visibleIds.has(row.employeeId));
  const visibleReviewIds = new Set(visibleReviews.map((row) => row.id));
  const visibleGoals = goals.filter((goal) => {
    if (access.companyWide) return true;
    if (goal.scope === "company") return true;
    if (goal.scope === "team") return goal.orgUnitId === access.orgUnitId;
    return goal.employeeId ? visibleIds.has(goal.employeeId) : false;
  });
  const visibleUnits = access.companyWide ? units : units.filter((unit) => unit.id === access.orgUnitId);

  const readiness = Object.fromEntries(
    await Promise.all(cycles.map(async (cycle) => [cycle.id, await cycleCompletionReadiness(organizationId, cycle)])),
  );

  return Response.json({
    cycles,
    employees: visibleEmployees,
    orgUnits: visibleUnits,
    goals: visibleGoals,
    reviews: visibleReviews,
    templates,
    cycleTemplates,
    reviewItems: reviewItems.filter((row) => visibleReviewIds.has(row.reviewId)),
    cycleReadiness: readiness,
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

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PERFORMANCE_ROLES,
    "Your role is not allowed to manage performance.",
  );
  if (denied) return denied;

  if (entityType === "cycle") {
    const peopleDenied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can create review cycles.",
    );
    if (peopleDenied) return peopleDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Performance cycles are organization-wide and require company-wide access." }, { status: 403 });
    }

    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    if (!name || !validIsoDate(startDate) || !validIsoDate(endDate) || endDate < startDate) {
      return Response.json({ error: "name and a valid start/end date range are required." }, { status: 400 });
    }

    const [row] = await db.insert(performanceCycles).values({
      organizationId,
      name: name.slice(0, 160),
      startDate,
      endDate,
      status: "active",
      requireSelfAssessment: body.requireSelfAssessment === true,
      requireManagerSummary: body.requireManagerSummary !== false,
      requireCalibration: body.requireCalibration === true,
      createdByUserId: user.id,
      createdBy: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance cycle created",
      resource: row.name,
      metadata: {
        cycleId: row.id,
        startDate,
        endDate,
        requireSelfAssessment: row.requireSelfAssessment,
        requireManagerSummary: row.requireManagerSummary,
        requireCalibration: row.requireCalibration,
      },
    });

    return Response.json(row, { status: 201 });
  }

  if (entityType === "template") {
    const peopleDenied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (peopleDenied) return peopleDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Performance templates require company-wide access." }, { status: 403 });
    }

    const code = String(body.code ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();
    const type = String(body.type ?? "");
    const defaultWeight = boundedWeight(body.defaultWeight);
    const jobProfileId = body.jobProfileId ? Number(body.jobProfileId) : null;
    if (!code || !name || !["competency", "kra"].includes(type) || defaultWeight === null) {
      return Response.json({ error: "code, name, type (competency or kra), and a weight from 0 to 100 are required." }, { status: 400 });
    }
    if (jobProfileId) {
      const [profile] = await db.select({ id: jobProfiles.id }).from(jobProfiles)
        .where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId)))
        .limit(1);
      if (!profile) return Response.json({ error: "Job profile not found in this workspace." }, { status: 404 });
    }

    try {
      const [row] = await db.insert(performanceTemplates).values({
        organizationId,
        code: code.slice(0, 60),
        name: name.slice(0, 180),
        type,
        description: body.description ? String(body.description).slice(0, 4000) : null,
        jobProfileId,
        defaultWeight,
        ratingAnchors: typeof body.ratingAnchors === "object" && body.ratingAnchors ? body.ratingAnchors : {},
        active: true,
        createdByUserId: user.id,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Performance template created",
        resource: row.name,
        metadata: { templateId: row.id, code: row.code, type: row.type, defaultWeight: row.defaultWeight },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A performance template with this code already exists." }, { status: 409 });
    }
  }

  if (entityType === "cycle_template") {
    const peopleDenied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (peopleDenied) return peopleDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Cycle templates require company-wide access." }, { status: 403 });
    }

    const cycleId = Number(body.cycleId);
    const templateId = Number(body.templateId);
    const weight = boundedWeight(body.weight);
    if (!Number.isInteger(cycleId) || !Number.isInteger(templateId) || weight === null) {
      return Response.json({ error: "cycleId, templateId and a weight from 0 to 100 are required." }, { status: 400 });
    }
    const [cycle, template] = await Promise.all([
      cycleInOrganization(organizationId, cycleId),
      db.select().from(performanceTemplates)
        .where(and(eq(performanceTemplates.id, templateId), eq(performanceTemplates.organizationId, organizationId)))
        .limit(1).then((rows) => rows[0] ?? null),
    ]);
    if (!cycle || !template) return Response.json({ error: "Cycle or template not found in this workspace." }, { status: 404 });
    if (cycle.status === "completed") return Response.json({ error: "Completed cycles cannot accept new templates." }, { status: 409 });

    const existingReviews = await db.select({ id: performanceReviews.id, status: performanceReviews.status })
      .from(performanceReviews)
      .where(and(
        eq(performanceReviews.organizationId, organizationId),
        eq(performanceReviews.cycleId, cycleId),
      ));
    if (existingReviews.some((review) => review.status === "completed")) {
      return Response.json({
        error: "Review structure is locked after the first review completes. Create a new cycle to change required competencies or KRAs.",
      }, { status: 409 });
    }

    try {
      const [row] = await db.insert(performanceCycleTemplates).values({
        organizationId,
        cycleId,
        templateId,
        weight,
        required: body.required !== false,
      }).returning();

      const openReviews = await db.select().from(performanceReviews).where(and(
        eq(performanceReviews.organizationId, organizationId),
        eq(performanceReviews.cycleId, cycleId),
      ));
      for (const review of openReviews) {
        await db.insert(performanceReviewItems).values({
          organizationId,
          reviewId: review.id,
          templateId,
        }).onConflictDoNothing();
      }

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Performance template attached to cycle",
        resource: cycle.name,
        metadata: { cycleId, templateId, weight, required: row.required },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This template is already attached to the cycle." }, { status: 409 });
    }
  }

  if (entityType === "goal") {
    const scope = String(body.scope ?? "employee");
    const employeeId = body.employeeId ? Number(body.employeeId) : null;
    const orgUnitId = body.orgUnitId ? Number(body.orgUnitId) : null;
    const parentGoalId = body.parentGoalId ? Number(body.parentGoalId) : null;
    const title = String(body.title ?? "").trim();
    const cycleId = body.cycleId ? Number(body.cycleId) : null;
    const weight = boundedWeight(body.weight);
    const dueDate = body.dueDate ? String(body.dueDate) : null;

    if (!["company", "team", "employee"].includes(scope) || !title || weight === null) {
      return Response.json({ error: "scope, title, and weight from 0 to 100 are required." }, { status: 400 });
    }
    if (dueDate && !validIsoDate(dueDate)) {
      return Response.json({ error: "dueDate must be YYYY-MM-DD." }, { status: 400 });
    }

    const access = await getAccess(user.id, organizationId);
    if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

    let employee: typeof employees.$inferSelect | null = null;
    if (scope === "company") {
      if (!access.companyWide) return Response.json({ error: "Company goals require company-wide access." }, { status: 403 });
      if (employeeId || orgUnitId) return Response.json({ error: "Company goals cannot target an employee or team." }, { status: 400 });
      if (parentGoalId) return Response.json({ error: "Company goals are top-level and cannot have a parent." }, { status: 400 });
    } else if (scope === "team") {
      if (!Number.isInteger(orgUnitId)) return Response.json({ error: "Team goals require orgUnitId." }, { status: 400 });
      const scoped = assertScope(access, orgUnitId);
      if (!scoped.ok) return Response.json({ error: scoped.error }, { status: scoped.status });
      if (employeeId) return Response.json({ error: "Team goals cannot target an employee." }, { status: 400 });
    } else {
      if (!Number.isInteger(employeeId)) return Response.json({ error: "Employee goals require employeeId." }, { status: 400 });
      const scoped = await scopedEmployee(user.id, organizationId, employeeId!);
      if ("error" in scoped) return scoped.error;
      employee = scoped.employee;
    }

    if (cycleId) {
      const cycle = await cycleInOrganization(organizationId, cycleId);
      if (!cycle) return Response.json({ error: "Performance cycle not found in this workspace." }, { status: 404 });
      if (cycle.status === "completed") return Response.json({ error: "Completed cycles cannot accept new goals." }, { status: 409 });
    }

    if (parentGoalId) {
      const [parent] = await db.select().from(performanceGoals).where(and(
        eq(performanceGoals.id, parentGoalId),
        eq(performanceGoals.organizationId, organizationId),
      )).limit(1);
      if (!parent) return Response.json({ error: "Parent goal not found in this workspace." }, { status: 404 });
      if (parent.scope === "employee") {
        return Response.json({ error: "Employee goals cannot be used as parents in the company → team → employee hierarchy." }, { status: 400 });
      }
      if (scope === "team" && parent.scope !== "company") {
        return Response.json({ error: "Team goals may only cascade from a company goal." }, { status: 400 });
      }
      if (scope === "employee" && parent.scope === "team" && employee?.orgUnitId !== parent.orgUnitId) {
        return Response.json({ error: "An employee goal can only cascade from a team goal in that employee's org unit." }, { status: 400 });
      }
      if (cycleId && parent.cycleId && parent.cycleId !== cycleId) {
        return Response.json({ error: "Parent and child goals must belong to the same performance cycle." }, { status: 400 });
      }
    }

    const [row] = await db.insert(performanceGoals).values({
      organizationId,
      employeeId: scope === "employee" ? employeeId : null,
      orgUnitId: scope === "team" ? orgUnitId : null,
      parentGoalId,
      scope,
      cycleId,
      title: title.slice(0, 180),
      description: body.description ? String(body.description).slice(0, 4000) : null,
      weight,
      progress: 0,
      status: "active",
      dueDate,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance goal created",
      resource: row.title,
      metadata: { goalId: row.id, scope, employeeId: row.employeeId, orgUnitId: row.orgUnitId, parentGoalId, cycleId, weight },
    });

    return Response.json(row, { status: 201 });
  }

  if (entityType === "review") {
    const employeeId = Number(body.employeeId);
    const cycleId = Number(body.cycleId);
    if (!Number.isInteger(employeeId) || !Number.isInteger(cycleId)) {
      return Response.json({ error: "employeeId and cycleId are required." }, { status: 400 });
    }

    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;

    const cycle = await cycleInOrganization(organizationId, cycleId);
    if (!cycle) return Response.json({ error: "Performance cycle not found in this workspace." }, { status: 404 });
    if (cycle.status === "completed") return Response.json({ error: "Completed cycles cannot accept new reviews." }, { status: 409 });

    try {
      const [row] = await db.insert(performanceReviews).values({
        organizationId,
        employeeId,
        cycleId,
        reviewerUserId: user.id,
        status: "in_progress",
      }).returning();

      const links = await db.select().from(performanceCycleTemplates).where(and(
        eq(performanceCycleTemplates.organizationId, organizationId),
        eq(performanceCycleTemplates.cycleId, cycleId),
      ));
      if (links.length) {
        await db.insert(performanceReviewItems).values(links.map((link) => ({
          organizationId,
          reviewId: row.id,
          templateId: link.templateId,
        })));
      }

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Performance review opened",
        resource: `Employee #${employeeId}`,
        metadata: { reviewId: row.id, cycleId, employeeId, structuredItems: links.length },
      });

      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A review already exists for this employee in this cycle." }, { status: 409 });
    }
  }

  return Response.json({ error: "Unsupported performance entityType." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const entityType = String(body.entityType ?? "");

  if (entityType === "goal") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Goal id is required." }, { status: 400 });
    const [existing] = await db.select().from(performanceGoals).where(eq(performanceGoals.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Goal not found." }, { status: 404 });

    const denied = await assertOrganizationRole(user.id, existing.organizationId, PERFORMANCE_ROLES);
    if (denied) return denied;
    const scoped = await assertGoalAccess(user.id, existing);
    if ("error" in scoped) return scoped.error;

    if (existing.cycleId) {
      const cycle = await cycleInOrganization(existing.organizationId, existing.cycleId);
      if (cycle?.status === "completed") return Response.json({ error: "Goals in a completed cycle are locked." }, { status: 409 });
    }

    const progress = body.progress === undefined ? existing.progress : Number(body.progress);
    const status = body.status === undefined ? existing.status : String(body.status);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      return Response.json({ error: "progress must be an integer from 0 to 100." }, { status: 400 });
    }
    if (!["active", "completed", "cancelled"].includes(status)) {
      return Response.json({ error: "Invalid goal status." }, { status: 400 });
    }

    const [row] = await db.update(performanceGoals)
      .set({
        progress,
        status: progress === 100 && status === "active" ? "completed" : status,
        updatedAt: new Date(),
      })
      .where(eq(performanceGoals.id, id))
      .returning();

    await recordAuditEvent({
      organizationId: existing.organizationId,
      actor: user.name,
      action: "Performance goal updated",
      resource: existing.title,
      metadata: { goalId: id, scope: existing.scope, progress: row.progress, status: row.status },
    });

    return Response.json(row);
  }

  if (entityType === "review_item") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Review item id is required." }, { status: 400 });
    const [item] = await db.select().from(performanceReviewItems).where(eq(performanceReviewItems.id, id)).limit(1);
    if (!item) return Response.json({ error: "Review item not found." }, { status: 404 });
    const [review] = await db.select().from(performanceReviews).where(eq(performanceReviews.id, item.reviewId)).limit(1);
    if (!review) return Response.json({ error: "Performance review not found." }, { status: 404 });

    const denied = await assertOrganizationRole(user.id, review.organizationId, PERFORMANCE_ROLES);
    if (denied) return denied;
    const scoped = await scopedEmployee(user.id, review.organizationId, review.employeeId);
    if ("error" in scoped) return scoped.error;
    const cycle = await cycleInOrganization(review.organizationId, review.cycleId);
    if (cycle?.status === "completed" || review.status === "completed") {
      return Response.json({ error: "Completed review evidence is locked." }, { status: 409 });
    }

    const managerScore = score(body.managerScore);
    const finalScore = score(body.finalScore ?? body.managerScore);
    if (managerScore === null || finalScore === null) {
      return Response.json({ error: "Structured review scores must be from 1.00 to 5.00." }, { status: 400 });
    }

    const [row] = await db.update(performanceReviewItems).set({
      managerScore,
      finalScore,
      managerComment: body.managerComment ? String(body.managerComment).slice(0, 4000) : item.managerComment,
      updatedAt: new Date(),
    }).where(eq(performanceReviewItems.id, id)).returning();

    await recordAuditEvent({
      organizationId: review.organizationId,
      actor: user.name,
      action: "Structured performance item scored",
      resource: `Review #${review.id}`,
      metadata: { reviewItemId: id, templateId: item.templateId, managerScore, finalScore },
    });

    return Response.json(row);
  }

  if (entityType === "review") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Review id is required." }, { status: 400 });
    const [existing] = await db.select().from(performanceReviews).where(eq(performanceReviews.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Review not found." }, { status: 404 });

    const denied = await assertOrganizationRole(user.id, existing.organizationId, PERFORMANCE_ROLES);
    if (denied) return denied;
    const scoped = await scopedEmployee(user.id, existing.organizationId, existing.employeeId);
    if ("error" in scoped) return scoped.error;

    const cycle = await cycleInOrganization(existing.organizationId, existing.cycleId);
    if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });
    if (cycle.status === "completed") return Response.json({ error: "Completed cycles are locked." }, { status: 409 });

    const managerScore = body.managerScore === undefined ? existing.managerScore : score(body.managerScore);
    const finalScore = body.finalScore === undefined
      ? (body.managerScore === undefined ? existing.finalScore : score(body.managerScore))
      : score(body.finalScore);
    if ((body.managerScore !== undefined && managerScore === null) || (body.finalScore !== undefined && finalScore === null)) {
      return Response.json({ error: "Review scores must be from 1.00 to 5.00." }, { status: 400 });
    }

    const status = String(body.status ?? "in_progress");
    if (!["in_progress", "completed"].includes(status)) {
      return Response.json({ error: "Review status must be in_progress or completed." }, { status: 400 });
    }
    const managerSummary = body.managerSummary === undefined
      ? existing.managerSummary
      : String(body.managerSummary ?? "").trim().slice(0, 8000) || null;

    if (status === "completed") {
      if (!managerScore || !finalScore) {
        return Response.json({ error: "Manager and final scores are required before completing a review." }, { status: 409 });
      }
      if (cycle.requireManagerSummary && !managerSummary) {
        return Response.json({ error: "This cycle requires a manager summary before review completion." }, { status: 409 });
      }
      if (cycle.requireSelfAssessment && (!existing.selfScore || !existing.employeeReflection)) {
        return Response.json({ error: "This cycle requires the employee self-assessment before manager completion." }, { status: 409 });
      }

      const [links, items] = await Promise.all([
        db.select().from(performanceCycleTemplates).where(and(
          eq(performanceCycleTemplates.organizationId, existing.organizationId),
          eq(performanceCycleTemplates.cycleId, existing.cycleId),
        )),
        db.select().from(performanceReviewItems).where(and(
          eq(performanceReviewItems.organizationId, existing.organizationId),
          eq(performanceReviewItems.reviewId, id),
        )),
      ]);
      for (const link of links.filter((row) => row.required)) {
        const item = items.find((row) => row.templateId === link.templateId);
        if (!item?.managerScore || !item?.finalScore) {
          return Response.json({ error: "Score every required competency/KRA item before completing the review." }, { status: 409 });
        }
        if (cycle.requireSelfAssessment && !item.selfScore) {
          return Response.json({ error: "This cycle requires employee self-ratings for every required competency/KRA item." }, { status: 409 });
        }
      }
    }

    const [row] = await db.update(performanceReviews)
      .set({
        managerScore,
        finalScore,
        managerSummary,
        status,
        completedAt: status === "completed" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(performanceReviews.id, id))
      .returning();

    await recordAuditEvent({
      organizationId: existing.organizationId,
      actor: user.name,
      action: status === "completed" ? "Performance review completed" : "Performance review updated",
      resource: `Employee #${existing.employeeId}`,
      metadata: { reviewId: id, cycleId: existing.cycleId, finalScore: row.finalScore },
    });

    return Response.json(row);
  }

  if (entityType === "cycle") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Cycle id is required." }, { status: 400 });
    const [cycle] = await db.select().from(performanceCycles).where(eq(performanceCycles.id, id)).limit(1);
    if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });

    const peopleDenied = await assertOrganizationRole(user.id, cycle.organizationId, PEOPLE_ADMIN_ROLES);
    if (peopleDenied) return peopleDenied;
    const access = await getAccess(user.id, cycle.organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Closing a performance cycle requires company-wide access." }, { status: 403 });
    }
    if (cycle.status === "completed") return Response.json(cycle);

    const readiness = await cycleCompletionReadiness(cycle.organizationId, cycle);
    if (!readiness.ready) {
      return Response.json({
        error: "The cycle cannot close until every review is complete, required structured evidence is scored, and any required calibration is finalized.",
        readiness,
      }, { status: 409 });
    }

    const [row] = await db.update(performanceCycles).set({
      status: "completed",
      completedAt: new Date(),
      completedByUserId: user.id,
      updatedAt: new Date(),
    }).where(eq(performanceCycles.id, id)).returning();

    await recordAuditEvent({
      organizationId: cycle.organizationId,
      actor: user.name,
      action: "Performance cycle completed",
      resource: cycle.name,
      metadata: { cycleId: id, readiness },
    });

    return Response.json({ ...row, readiness });
  }

  return Response.json({ error: "Unsupported performance entityType." }, { status: 400 });
}
