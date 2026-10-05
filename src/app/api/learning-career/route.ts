import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  developmentPlanItems,
  developmentPlans,
  employeeCertifications,
  employeeSkills,
  employees,
  jobProfileSkills,
  jobProfiles,
  learningCourses,
  learningEnrollments,
  performanceReviews,
  positionAssignments,
  positions,
  skillCatalog,
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

export const dynamic = "force-dynamic";

const LEARNING_ROLES = WORKFORCE_MANAGER_ROLES;
const ACTIVITY_TYPES = ["training", "mentoring", "project", "coaching", "certification", "reading"] as const;
const ENROLLMENT_STATUSES = ["assigned", "in_progress", "completed", "cancelled"] as const;

function validDate(value: string | null) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function addMonths(date: string, months: number) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

function boundedLevel(value: unknown) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
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

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    LEARNING_ROLES,
    "Your role is not allowed to view learning and career development.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [staff, assignments, positionRows, profileRows, skills, requirements, skillRows, plans, items, courses, enrollments, certifications, reviews] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(positionAssignments).where(and(eq(positionAssignments.organizationId, organizationId), isNull(positionAssignments.effectiveUntil))),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(jobProfiles).where(and(eq(jobProfiles.organizationId, organizationId), eq(jobProfiles.active, true))),
    db.select().from(skillCatalog).where(eq(skillCatalog.organizationId, organizationId)),
    db.select().from(jobProfileSkills).where(eq(jobProfileSkills.organizationId, organizationId)),
    db.select().from(employeeSkills).where(eq(employeeSkills.organizationId, organizationId)),
    db.select().from(developmentPlans).where(eq(developmentPlans.organizationId, organizationId)).orderBy(desc(developmentPlans.id)),
    db.select().from(developmentPlanItems).where(eq(developmentPlanItems.organizationId, organizationId)),
    db.select().from(learningCourses).where(eq(learningCourses.organizationId, organizationId)),
    db.select().from(learningEnrollments).where(eq(learningEnrollments.organizationId, organizationId)).orderBy(desc(learningEnrollments.id)),
    db.select().from(employeeCertifications).where(eq(employeeCertifications.organizationId, organizationId)).orderBy(desc(employeeCertifications.id)),
    db.select().from(performanceReviews).where(eq(performanceReviews.organizationId, organizationId)).orderBy(desc(performanceReviews.completedAt), desc(performanceReviews.id)),
  ]);

  const visibleEmployees = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));
  const positionById = new Map(positionRows.map((position) => [position.id, position]));
  const assignmentByEmployee = new Map(assignments.map((assignment) => [assignment.employeeId, assignment]));
  const skillsByEmployee = new Map<number, typeof skillRows>();
  for (const row of skillRows) {
    skillsByEmployee.set(row.employeeId, [...(skillsByEmployee.get(row.employeeId) ?? []), row]);
  }
  const requirementsByProfile = new Map<number, typeof requirements>();
  for (const row of requirements) {
    requirementsByProfile.set(row.jobProfileId, [...(requirementsByProfile.get(row.jobProfileId) ?? []), row]);
  }

  const careerReadiness = [];
  for (const employee of visibleEmployees) {
    const assignment = assignmentByEmployee.get(employee.id);
    const currentPosition = assignment ? positionById.get(assignment.positionId) ?? null : null;
    const currentProfileId = currentPosition?.jobProfileId ?? null;
    const proficiency = new Map((skillsByEmployee.get(employee.id) ?? []).map((row) => [row.skillId, row.proficiencyLevel]));

    for (const target of profileRows) {
      if (target.id === currentProfileId) continue;
      const reqs = requirementsByProfile.get(target.id) ?? [];
      if (!reqs.length) continue;
      let points = 0;
      let possible = 0;
      let met = 0;
      const criticalGaps: Array<{ skillId: number; requiredLevel: number; currentLevel: number }> = [];
      for (const req of reqs) {
        const current = proficiency.get(req.skillId) ?? 0;
        const weight = req.critical ? 2 : 1;
        possible += weight;
        points += Math.min(current / req.requiredLevel, 1) * weight;
        if (current >= req.requiredLevel) met += 1;
        if (req.critical && current < req.requiredLevel) {
          criticalGaps.push({ skillId: req.skillId, requiredLevel: req.requiredLevel, currentLevel: current });
        }
      }
      careerReadiness.push({
        employeeId: employee.id,
        currentJobProfileId: currentProfileId,
        targetJobProfileId: target.id,
        metRequirements: met,
        totalRequirements: reqs.length,
        criticalGaps,
        readinessPercent: possible > 0 ? Math.round((points / possible) * 100) : 0,
      });
    }
  }

  const latestReviewByEmployee = new Map<number, typeof reviews[number]>();
  for (const review of reviews) {
    if (review.status === "completed" && !latestReviewByEmployee.has(review.employeeId)) {
      latestReviewByEmployee.set(review.employeeId, review);
    }
  }

  return Response.json({
    access,
    employees: visibleEmployees.map((employee) => ({
      ...employee,
      activePosition: (() => {
        const assignment = assignmentByEmployee.get(employee.id);
        return assignment ? positionById.get(assignment.positionId) ?? null : null;
      })(),
      latestPerformanceReview: latestReviewByEmployee.get(employee.id) ?? null,
    })),
    jobProfiles: profileRows,
    skills,
    requirements,
    employeeSkills: skillRows.filter((row) => visibleIds.has(row.employeeId)),
    developmentPlans: plans.filter((row) => visibleIds.has(row.employeeId)),
    developmentPlanItems: items.filter((item) => {
      const plan = plans.find((row) => row.id === item.planId);
      return Boolean(plan && visibleIds.has(plan.employeeId));
    }),
    courses,
    enrollments: enrollments.filter((row) => visibleIds.has(row.employeeId)),
    certifications: certifications.filter((row) => visibleIds.has(row.employeeId)).map((row) => ({
      ...row,
      effectiveStatus: row.status === "active" && row.expiresOn && row.expiresOn < todayPh() ? "expired" : row.status,
    })),
    careerReadiness,
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

  if (entityType === "skill") {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "Only People administrators can manage the skills catalog.");
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "The skills catalog requires company-wide access." }, { status: 403 });

    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "General").trim() || "General";
    if (!name) return Response.json({ error: "Skill name is required." }, { status: 400 });
    try {
      const [row] = await db.insert(skillCatalog).values({
        organizationId,
        name: name.slice(0, 160),
        category: category.slice(0, 100),
        description: body.description ? String(body.description).slice(0, 4000) : null,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Skill added to catalog",
        resource: row.name,
        metadata: { skillId: row.id, category: row.category },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A skill with this name already exists." }, { status: 409 });
    }
  }

  if (entityType === "requirement") {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "Only People administrators can define role competencies.");
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Role competency architecture requires company-wide access." }, { status: 403 });

    const jobProfileId = Number(body.jobProfileId);
    const skillId = Number(body.skillId);
    const requiredLevel = boundedLevel(body.requiredLevel);
    if (!Number.isInteger(jobProfileId) || !Number.isInteger(skillId) || requiredLevel === null) {
      return Response.json({ error: "jobProfileId, skillId, and requiredLevel from 1 to 5 are required." }, { status: 400 });
    }
    const [[profile], [skill]] = await Promise.all([
      db.select({ id: jobProfiles.id }).from(jobProfiles).where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1),
      db.select({ id: skillCatalog.id }).from(skillCatalog).where(and(eq(skillCatalog.id, skillId), eq(skillCatalog.organizationId, organizationId))).limit(1),
    ]);
    if (!profile || !skill) return Response.json({ error: "Job profile or skill not found in this workspace." }, { status: 404 });

    const [row] = await db.insert(jobProfileSkills).values({
      organizationId,
      jobProfileId,
      skillId,
      requiredLevel,
      critical: Boolean(body.critical),
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: [jobProfileSkills.jobProfileId, jobProfileSkills.skillId],
      set: { requiredLevel, critical: Boolean(body.critical), updatedAt: new Date() },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Job competency requirement saved",
      resource: "Job profile #" + jobProfileId + " / skill #" + skillId,
      metadata: { requirementId: row.id, requiredLevel, critical: row.critical },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "employee_skill") {
    const denied = await assertOrganizationRole(user.id, organizationId, LEARNING_ROLES, "Your role cannot verify employee skills.");
    if (denied) return denied;
    const employeeId = Number(body.employeeId);
    const skillId = Number(body.skillId);
    const proficiencyLevel = boundedLevel(body.proficiencyLevel);
    if (!Number.isInteger(employeeId) || !Number.isInteger(skillId) || proficiencyLevel === null) {
      return Response.json({ error: "employeeId, skillId, and proficiencyLevel from 1 to 5 are required." }, { status: 400 });
    }
    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    const [skill] = await db.select({ id: skillCatalog.id }).from(skillCatalog)
      .where(and(eq(skillCatalog.id, skillId), eq(skillCatalog.organizationId, organizationId))).limit(1);
    if (!skill) return Response.json({ error: "Skill not found in this workspace." }, { status: 404 });

    const [row] = await db.insert(employeeSkills).values({
      organizationId,
      employeeId,
      skillId,
      proficiencyLevel,
      source: String(body.source ?? "manager").slice(0, 32),
      verifiedByUserId: user.id,
      verifiedAt: new Date(),
      notes: body.notes ? String(body.notes).slice(0, 4000) : null,
    }).onConflictDoUpdate({
      target: [employeeSkills.employeeId, employeeSkills.skillId],
      set: {
        proficiencyLevel,
        source: String(body.source ?? "manager").slice(0, 32),
        verifiedByUserId: user.id,
        verifiedAt: new Date(),
        notes: body.notes ? String(body.notes).slice(0, 4000) : null,
        updatedAt: new Date(),
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee skill verified",
      resource: "Employee #" + employeeId + " / skill #" + skillId,
      metadata: { employeeSkillId: row.id, proficiencyLevel, source: row.source },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "development_plan") {
    const denied = await assertOrganizationRole(user.id, organizationId, LEARNING_ROLES, "Your role cannot create development plans.");
    if (denied) return denied;
    const employeeId = Number(body.employeeId);
    const performanceReviewId = body.performanceReviewId ? Number(body.performanceReviewId) : null;
    const title = String(body.title ?? "").trim();
    const targetDate = body.targetDate ? String(body.targetDate) : null;
    if (!Number.isInteger(employeeId) || !title || !validDate(targetDate)) {
      return Response.json({ error: "employeeId, title, and an optional YYYY-MM-DD targetDate are required." }, { status: 400 });
    }
    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    if (performanceReviewId) {
      const [review] = await db.select().from(performanceReviews)
        .where(and(
          eq(performanceReviews.id, performanceReviewId),
          eq(performanceReviews.organizationId, organizationId),
          eq(performanceReviews.employeeId, employeeId),
        )).limit(1);
      if (!review || review.status !== "completed") {
        return Response.json({ error: "Development plans may only link to a completed review for the same employee." }, { status: 409 });
      }
    }
    const [row] = await db.insert(developmentPlans).values({
      organizationId,
      employeeId,
      performanceReviewId,
      title: title.slice(0, 180),
      targetDate,
      status: "active",
      notes: body.notes ? String(body.notes).slice(0, 8000) : null,
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee development plan created",
      resource: row.title,
      metadata: { developmentPlanId: row.id, employeeId, performanceReviewId },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "plan_item") {
    const denied = await assertOrganizationRole(user.id, organizationId, LEARNING_ROLES, "Your role cannot manage development activities.");
    if (denied) return denied;
    const planId = Number(body.planId);
    const skillId = body.skillId ? Number(body.skillId) : null;
    const title = String(body.title ?? "").trim();
    const activityType = String(body.activityType ?? "training");
    const targetLevel = body.targetLevel ? boundedLevel(body.targetLevel) : null;
    const dueDate = body.dueDate ? String(body.dueDate) : null;
    if (!Number.isInteger(planId) || !title || !ACTIVITY_TYPES.includes(activityType as (typeof ACTIVITY_TYPES)[number]) || !validDate(dueDate)) {
      return Response.json({ error: "planId, title, valid activityType, and optional dueDate are required." }, { status: 400 });
    }
    if (body.targetLevel && targetLevel === null) return Response.json({ error: "targetLevel must be from 1 to 5." }, { status: 400 });
    const [plan] = await db.select().from(developmentPlans)
      .where(and(eq(developmentPlans.id, planId), eq(developmentPlans.organizationId, organizationId))).limit(1);
    if (!plan) return Response.json({ error: "Development plan not found." }, { status: 404 });
    const scoped = await scopedEmployee(user.id, organizationId, plan.employeeId);
    if ("error" in scoped) return scoped.error;
    if (skillId) {
      const [skill] = await db.select({ id: skillCatalog.id }).from(skillCatalog)
        .where(and(eq(skillCatalog.id, skillId), eq(skillCatalog.organizationId, organizationId))).limit(1);
      if (!skill) return Response.json({ error: "Skill not found." }, { status: 404 });
    }
    const [row] = await db.insert(developmentPlanItems).values({
      organizationId,
      planId,
      skillId,
      title: title.slice(0, 180),
      activityType,
      targetLevel,
      dueDate,
      status: "planned",
      notes: body.notes ? String(body.notes).slice(0, 4000) : null,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Development activity added",
      resource: row.title,
      metadata: { developmentPlanItemId: row.id, planId, skillId, targetLevel },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "course") {
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES, "Only People administrators can manage the course catalog.");
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "The course catalog requires company-wide access." }, { status: 403 });

    const code = String(body.code ?? "").trim().toUpperCase();
    const title = String(body.title ?? "").trim();
    const skillId = body.skillId ? Number(body.skillId) : null;
    const awardedLevel = body.awardedLevel ? boundedLevel(body.awardedLevel) : null;
    const validityMonths = body.validityMonths ? Number(body.validityMonths) : null;
    if (!code || !title) return Response.json({ error: "Course code and title are required." }, { status: 400 });
    if (body.awardedLevel && awardedLevel === null) return Response.json({ error: "awardedLevel must be from 1 to 5." }, { status: 400 });
    if (awardedLevel && !skillId) return Response.json({ error: "A course can award a proficiency level only when linked to a skill." }, { status: 400 });
    if (validityMonths !== null && (!Number.isInteger(validityMonths) || validityMonths < 1 || validityMonths > 240)) {
      return Response.json({ error: "validityMonths must be between 1 and 240." }, { status: 400 });
    }
    if (skillId) {
      const [skill] = await db.select({ id: skillCatalog.id }).from(skillCatalog)
        .where(and(eq(skillCatalog.id, skillId), eq(skillCatalog.organizationId, organizationId))).limit(1);
      if (!skill) return Response.json({ error: "Skill not found." }, { status: 404 });
    }
    try {
      const [row] = await db.insert(learningCourses).values({
        organizationId,
        code: code.slice(0, 48),
        title: title.slice(0, 180),
        provider: String(body.provider ?? "Internal").slice(0, 160),
        deliveryMode: String(body.deliveryMode ?? "self_paced").slice(0, 40),
        description: body.description ? String(body.description).slice(0, 8000) : null,
        skillId,
        awardedLevel,
        certificationName: body.certificationName ? String(body.certificationName).slice(0, 180) : null,
        validityMonths,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Learning course created",
        resource: row.code + " - " + row.title,
        metadata: { courseId: row.id, skillId, awardedLevel, certificationName: row.certificationName },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A course with this code already exists." }, { status: 409 });
    }
  }

  if (entityType === "enrollment") {
    const denied = await assertOrganizationRole(user.id, organizationId, LEARNING_ROLES, "Your role cannot assign learning.");
    if (denied) return denied;
    const employeeId = Number(body.employeeId);
    const courseId = Number(body.courseId);
    const developmentPlanItemId = body.developmentPlanItemId ? Number(body.developmentPlanItemId) : null;
    const dueDate = body.dueDate ? String(body.dueDate) : null;
    if (!Number.isInteger(employeeId) || !Number.isInteger(courseId) || !validDate(dueDate)) {
      return Response.json({ error: "employeeId, courseId, and optional dueDate are required." }, { status: 400 });
    }
    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    const [course] = await db.select().from(learningCourses)
      .where(and(eq(learningCourses.id, courseId), eq(learningCourses.organizationId, organizationId))).limit(1);
    if (!course || !course.active) return Response.json({ error: "Active course not found." }, { status: 404 });
    if (developmentPlanItemId) {
      const [item] = await db.select().from(developmentPlanItems)
        .innerJoin(developmentPlans, eq(developmentPlanItems.planId, developmentPlans.id))
        .where(and(
          eq(developmentPlanItems.id, developmentPlanItemId),
          eq(developmentPlanItems.organizationId, organizationId),
          eq(developmentPlans.employeeId, employeeId),
        )).limit(1);
      if (!item) return Response.json({ error: "Development plan item does not belong to this employee." }, { status: 409 });
    }
    try {
      const [row] = await db.insert(learningEnrollments).values({
        organizationId,
        employeeId,
        courseId,
        developmentPlanItemId,
        status: "assigned",
        dueDate,
        assignedByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Learning assigned",
        resource: course.title,
        metadata: { enrollmentId: row.id, employeeId, courseId, developmentPlanItemId },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This employee is already enrolled in the selected course." }, { status: 409 });
    }
  }

  if (entityType === "certification") {
    const denied = await assertOrganizationRole(user.id, organizationId, LEARNING_ROLES, "Your role cannot record certifications.");
    if (denied) return denied;
    const employeeId = Number(body.employeeId);
    const skillId = body.skillId ? Number(body.skillId) : null;
    const name = String(body.name ?? "").trim();
    const issuedOn = String(body.issuedOn ?? "");
    const expiresOn = body.expiresOn ? String(body.expiresOn) : null;
    if (!Number.isInteger(employeeId) || !name || !validDate(issuedOn) || !issuedOn || !validDate(expiresOn)) {
      return Response.json({ error: "employeeId, certification name, issuedOn, and optional expiresOn are required." }, { status: 400 });
    }
    if (expiresOn && expiresOn < issuedOn) return Response.json({ error: "Certification expiry cannot be before issue date." }, { status: 400 });
    const scoped = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    if (skillId) {
      const [skill] = await db.select({ id: skillCatalog.id }).from(skillCatalog)
        .where(and(eq(skillCatalog.id, skillId), eq(skillCatalog.organizationId, organizationId))).limit(1);
      if (!skill) return Response.json({ error: "Skill not found." }, { status: 404 });
    }
    const [row] = await db.insert(employeeCertifications).values({
      organizationId,
      employeeId,
      skillId,
      name: name.slice(0, 180),
      issuer: String(body.issuer ?? "External").slice(0, 160),
      credentialId: body.credentialId ? String(body.credentialId).slice(0, 160) : null,
      issuedOn,
      expiresOn,
      status: expiresOn && expiresOn < todayPh() ? "expired" : "active",
      evidenceUrl: body.evidenceUrl ? String(body.evidenceUrl).slice(0, 2000) : null,
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee certification recorded",
      resource: row.name,
      metadata: { certificationId: row.id, employeeId, skillId, expiresOn },
    });
    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "Invalid entityType." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "enrollment_status") {
    const enrollmentId = Number(body.enrollmentId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(enrollmentId) || !ENROLLMENT_STATUSES.includes(status as (typeof ENROLLMENT_STATUSES)[number])) {
      return Response.json({ error: "enrollmentId and valid status are required." }, { status: 400 });
    }
    const [enrollment] = await db.select().from(learningEnrollments).where(eq(learningEnrollments.id, enrollmentId)).limit(1);
    if (!enrollment) return Response.json({ error: "Enrollment not found." }, { status: 404 });

    const denied = await assertOrganizationRole(user.id, enrollment.organizationId, LEARNING_ROLES, "Your role cannot update learning completion.");
    if (denied) return denied;
    const scoped = await scopedEmployee(user.id, enrollment.organizationId, enrollment.employeeId);
    if ("error" in scoped) return scoped.error;
    if (enrollment.status === "completed") {
      return Response.json({ error: "Completed learning is immutable because it may already have verified a skill or issued a certification." }, { status: 409 });
    }

    const [course] = await db.select().from(learningCourses)
      .where(and(eq(learningCourses.id, enrollment.courseId), eq(learningCourses.organizationId, enrollment.organizationId))).limit(1);
    if (!course) return Response.json({ error: "Enrollment course is missing." }, { status: 409 });

    const score = body.score === undefined || body.score === "" ? null : Number(body.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      return Response.json({ error: "score must be from 0 to 100." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(learningEnrollments).set({
        status,
        completedAt: status === "completed" ? new Date() : null,
        score: score === null ? enrollment.score : score.toFixed(2),
        evidenceUrl: body.evidenceUrl === undefined ? enrollment.evidenceUrl : String(body.evidenceUrl ?? "").slice(0, 2000) || null,
        updatedAt: new Date(),
      }).where(eq(learningEnrollments.id, enrollmentId)).returning();

      let verifiedSkill = null;
      let certification = null;

      if (status === "completed") {
        if (course.skillId && course.awardedLevel) {
          const [existingSkill] = await tx.select().from(employeeSkills)
            .where(and(eq(employeeSkills.employeeId, enrollment.employeeId), eq(employeeSkills.skillId, course.skillId))).limit(1);
          const nextLevel = Math.max(existingSkill?.proficiencyLevel ?? 0, course.awardedLevel);
          const [skill] = await tx.insert(employeeSkills).values({
            organizationId: enrollment.organizationId,
            employeeId: enrollment.employeeId,
            skillId: course.skillId,
            proficiencyLevel: nextLevel,
            source: "training",
            verifiedByUserId: user.id,
            verifiedAt: new Date(),
            notes: "Verified by completion of " + course.code + " - " + course.title,
          }).onConflictDoUpdate({
            target: [employeeSkills.employeeId, employeeSkills.skillId],
            set: {
              proficiencyLevel: nextLevel,
              source: "training",
              verifiedByUserId: user.id,
              verifiedAt: new Date(),
              notes: "Verified by completion of " + course.code + " - " + course.title,
              updatedAt: new Date(),
            },
          }).returning();
          verifiedSkill = skill;
        }

        if (course.certificationName) {
          const issuedOn = todayPh();
          const expiresOn = course.validityMonths ? addMonths(issuedOn, course.validityMonths) : null;
          const [cert] = await tx.insert(employeeCertifications).values({
            organizationId: enrollment.organizationId,
            employeeId: enrollment.employeeId,
            skillId: course.skillId,
            name: course.certificationName,
            issuer: course.provider,
            issuedOn,
            expiresOn,
            status: "active",
            evidenceUrl: updated.evidenceUrl,
            createdByUserId: user.id,
          }).returning();
          certification = cert;
        }

        if (enrollment.developmentPlanItemId) {
          const [linkedItem] = await tx.update(developmentPlanItems).set({
            status: "completed",
            updatedAt: new Date(),
          }).where(eq(developmentPlanItems.id, enrollment.developmentPlanItemId)).returning();
          if (linkedItem) {
            const siblingItems = await tx.select().from(developmentPlanItems)
              .where(eq(developmentPlanItems.planId, linkedItem.planId));
            if (siblingItems.length > 0 && siblingItems.every((item) => ["completed", "cancelled"].includes(item.status))) {
              await tx.update(developmentPlans).set({ status: "completed", updatedAt: new Date() })
                .where(eq(developmentPlans.id, linkedItem.planId));
            }
          }
        }
      }

      return { enrollment: updated, verifiedSkill, certification };
    });

    await recordAuditEvent({
      organizationId: enrollment.organizationId,
      actor: user.name,
      action: status === "completed" ? "Learning completed" : "Learning status updated",
      resource: course.title,
      metadata: {
        enrollmentId,
        employeeId: enrollment.employeeId,
        courseId: course.id,
        status,
        skillId: result.verifiedSkill?.skillId ?? null,
        certificationId: result.certification?.id ?? null,
      },
    });
    return Response.json(result);
  }

  if (action === "plan_item_status") {
    const itemId = Number(body.itemId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(itemId) || !["planned", "in_progress", "completed", "cancelled"].includes(status)) {
      return Response.json({ error: "itemId and valid status are required." }, { status: 400 });
    }
    const [item] = await db.select().from(developmentPlanItems)
      .where(eq(developmentPlanItems.id, itemId)).limit(1);
    if (!item) return Response.json({ error: "Development item not found." }, { status: 404 });
    const [plan] = await db.select().from(developmentPlans)
      .where(eq(developmentPlans.id, item.planId)).limit(1);
    if (!plan) return Response.json({ error: "Development plan not found." }, { status: 409 });
    const denied = await assertOrganizationRole(user.id, plan.organizationId, LEARNING_ROLES);
    if (denied) return denied;
    const scoped = await scopedEmployee(user.id, plan.organizationId, plan.employeeId);
    if ("error" in scoped) return scoped.error;

    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(developmentPlanItems).set({ status, updatedAt: new Date() })
        .where(eq(developmentPlanItems.id, itemId)).returning();
      const siblings = await tx.select().from(developmentPlanItems).where(eq(developmentPlanItems.planId, plan.id));
      if (siblings.length > 0 && siblings.every((activity) => ["completed", "cancelled"].includes(activity.status))) {
        await tx.update(developmentPlans).set({ status: "completed", updatedAt: new Date() })
          .where(eq(developmentPlans.id, plan.id));
      } else if (plan.status === "completed") {
        await tx.update(developmentPlans).set({ status: "active", updatedAt: new Date() })
          .where(eq(developmentPlans.id, plan.id));
      }
      return updated;
    });

    await recordAuditEvent({
      organizationId: plan.organizationId,
      actor: user.name,
      action: "Development activity status changed",
      resource: item.title,
      metadata: { developmentPlanItemId: itemId, planId: plan.id, employeeId: plan.employeeId, status },
    });
    return Response.json(row);
  }

  return Response.json({ error: "action must be enrollment_status or plan_item_status." }, { status: 400 });
}
