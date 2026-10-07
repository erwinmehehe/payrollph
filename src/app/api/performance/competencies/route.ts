import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmJobProfileSkillRequirements,
  hcmSkills,
  jobProfiles,
  performanceTemplates,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function architectureAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage job-profile competency architecture.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({ error: "Job-profile competency architecture requires company-wide access." }, { status: 403 }) };
  }
  return { access };
}

function proficiency(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await architectureAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const [profiles, skills, requirements, templates] = await Promise.all([
    db.select().from(jobProfiles)
      .where(eq(jobProfiles.organizationId, organizationId))
      .orderBy(asc(jobProfiles.title)),
    db.select().from(hcmSkills)
      .where(eq(hcmSkills.organizationId, organizationId))
      .orderBy(asc(hcmSkills.category), asc(hcmSkills.name)),
    db.select().from(hcmJobProfileSkillRequirements)
      .where(eq(hcmJobProfileSkillRequirements.organizationId, organizationId)),
    db.select().from(performanceTemplates)
      .where(and(
        eq(performanceTemplates.organizationId, organizationId),
        eq(performanceTemplates.type, "competency"),
      ))
      .orderBy(asc(performanceTemplates.name)),
  ]);

  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const templateFor = (jobProfileId: number, skillId: number) =>
    templates.find((template) =>
      template.skillId === skillId
      && (template.jobProfileId == null || template.jobProfileId === jobProfileId)
    ) ?? null;

  const coverage = profiles.map((profile) => {
    const profileRequirements = requirements.filter((requirement) => requirement.jobProfileId === profile.id);
    const mandatory = profileRequirements.filter((requirement) => requirement.mandatory);
    const mapped = mandatory.filter((requirement) => Boolean(templateFor(profile.id, requirement.skillId)));
    return {
      jobProfileId: profile.id,
      title: profile.title,
      family: profile.family,
      level: profile.level,
      mandatorySkills: mandatory.length,
      mappedMandatorySkills: mapped.length,
      complete: mandatory.length === mapped.length,
      missing: mandatory
        .filter((requirement) => !templateFor(profile.id, requirement.skillId))
        .map((requirement) => {
          const skill = skillById.get(requirement.skillId);
          return {
            skillId: requirement.skillId,
            code: skill?.code ?? "SKILL",
            name: skill?.name ?? "Unknown skill",
            minimumProficiency: requirement.minimumProficiency,
          };
        }),
    };
  });

  return Response.json({ profiles, skills, requirements, templates, coverage });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await architectureAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-competency-" + entityType,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (entityType === "skill") {
    const code = String(body.code ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "General").trim() || "General";
    if (!code || !name) {
      return Response.json({ error: "Skill code and name are required." }, { status: 400 });
    }
    try {
      const [row] = await db.insert(hcmSkills).values({
        organizationId,
        code: code.slice(0, 80),
        name: name.slice(0, 160),
        category: category.slice(0, 80),
        description: String(body.description ?? "").trim().slice(0, 4000) || null,
        active: true,
        createdByUserId: user.id,
        createdByName: user.name,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "HCM skill created",
        resource: row.name,
        metadata: { skillId: row.id, code: row.code, category: row.category },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A skill with that code already exists." }, { status: 409 });
    }
  }

  if (entityType === "requirement") {
    const jobProfileId = Number(body.jobProfileId);
    const skillId = Number(body.skillId);
    const minimumProficiency = proficiency(body.minimumProficiency);
    const mandatory = body.mandatory !== false;
    if (!Number.isInteger(jobProfileId) || !Number.isInteger(skillId) || minimumProficiency === null) {
      return Response.json({ error: "jobProfileId, skillId, and minimumProficiency from 1 to 5 are required." }, { status: 400 });
    }

    const [[profile], [skill]] = await Promise.all([
      db.select().from(jobProfiles).where(and(
        eq(jobProfiles.id, jobProfileId),
        eq(jobProfiles.organizationId, organizationId),
        eq(jobProfiles.active, true),
      )).limit(1),
      db.select().from(hcmSkills).where(and(
        eq(hcmSkills.id, skillId),
        eq(hcmSkills.organizationId, organizationId),
        eq(hcmSkills.active, true),
      )).limit(1),
    ]);
    if (!profile || !skill) {
      return Response.json({ error: "Active job profile or skill not found in this workspace." }, { status: 404 });
    }

    try {
      const [row] = await db.insert(hcmJobProfileSkillRequirements).values({
        organizationId,
        jobProfileId,
        skillId,
        minimumProficiency,
        mandatory,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Job profile skill requirement created",
        resource: profile.title,
        metadata: { requirementId: row.id, jobProfileId, skillId, minimumProficiency, mandatory },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This skill is already required by the selected job profile." }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be skill or requirement." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await architectureAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  if (entityType === "requirement") {
    const id = Number(body.id);
    const minimumProficiency = proficiency(body.minimumProficiency);
    if (!Number.isInteger(id) || minimumProficiency === null) {
      return Response.json({ error: "Requirement id and minimumProficiency from 1 to 5 are required." }, { status: 400 });
    }
    const [existing] = await db.select().from(hcmJobProfileSkillRequirements).where(and(
      eq(hcmJobProfileSkillRequirements.id, id),
      eq(hcmJobProfileSkillRequirements.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Job-profile skill requirement not found." }, { status: 404 });

    const [row] = await db.update(hcmJobProfileSkillRequirements).set({
      minimumProficiency,
      mandatory: body.mandatory !== false,
      updatedAt: new Date(),
    }).where(eq(hcmJobProfileSkillRequirements.id, id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Job profile skill requirement updated",
      resource: "Requirement #" + id,
      metadata: {
        requirementId: id,
        jobProfileId: row.jobProfileId,
        skillId: row.skillId,
        minimumProficiency: row.minimumProficiency,
        mandatory: row.mandatory,
      },
    });
    return Response.json(row);
  }

  if (entityType === "template_mapping") {
    const templateId = Number(body.templateId);
    const skillId = body.skillId ? Number(body.skillId) : null;
    const jobProfileId = body.jobProfileId ? Number(body.jobProfileId) : null;
    if (!Number.isInteger(templateId)
        || (skillId !== null && !Number.isInteger(skillId))
        || (jobProfileId !== null && !Number.isInteger(jobProfileId))) {
      return Response.json({ error: "Valid templateId, skillId, and jobProfileId values are required." }, { status: 400 });
    }

    const [template] = await db.select().from(performanceTemplates).where(and(
      eq(performanceTemplates.id, templateId),
      eq(performanceTemplates.organizationId, organizationId),
    )).limit(1);
    if (!template || template.type !== "competency") {
      return Response.json({ error: "Only competency templates can map to HCM skills." }, { status: 404 });
    }

    const [skillRows, profileRows] = await Promise.all([
      skillId
        ? db.select({ id: hcmSkills.id }).from(hcmSkills).where(and(
            eq(hcmSkills.id, skillId),
            eq(hcmSkills.organizationId, organizationId),
            eq(hcmSkills.active, true),
          )).limit(1)
        : Promise.resolve([]),
      jobProfileId
        ? db.select({ id: jobProfiles.id }).from(jobProfiles).where(and(
            eq(jobProfiles.id, jobProfileId),
            eq(jobProfiles.organizationId, organizationId),
            eq(jobProfiles.active, true),
          )).limit(1)
        : Promise.resolve([]),
    ]);
    if (skillId && !skillRows[0]) return Response.json({ error: "Active skill not found." }, { status: 404 });
    if (jobProfileId && !profileRows[0]) return Response.json({ error: "Active job profile not found." }, { status: 404 });

    try {
      const [row] = await db.update(performanceTemplates).set({
        skillId,
        jobProfileId,
        updatedAt: new Date(),
      }).where(eq(performanceTemplates.id, templateId)).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Performance competency mapped to job architecture",
        resource: row.name,
        metadata: { templateId, skillId, jobProfileId },
      });
      return Response.json(row);
    } catch {
      return Response.json({ error: "Another competency template already maps to that skill." }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be requirement or template_mapping." }, { status: 400 });
}
