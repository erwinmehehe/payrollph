import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
  hcmEmployeeSkills,
  hcmJobProfileCredentialRequirements,
  hcmJobProfileSkillRequirements,
  hcmSkills,
  jobProfiles,
} from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\\d{4}-\\d{2}-\\d{2}$/;

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);
  const jobProfileId = Number(url.searchParams.get("jobProfileId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage worker capabilities.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  if (employeeId > 0) {
    const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
      .limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  }

  const [skills, profileSkills, employeeSkills, profileCredentials, documentRequirements, employeeDocuments, profiles] = await Promise.all([
    db.select().from(hcmSkills)
      .where(and(eq(hcmSkills.organizationId, organizationId), eq(hcmSkills.active, true)))
      .orderBy(asc(hcmSkills.category), asc(hcmSkills.name)),
    db.select().from(hcmJobProfileSkillRequirements)
      .where(jobProfileId > 0
        ? and(eq(hcmJobProfileSkillRequirements.organizationId, organizationId), eq(hcmJobProfileSkillRequirements.jobProfileId, jobProfileId))
        : eq(hcmJobProfileSkillRequirements.organizationId, organizationId))
      .orderBy(asc(hcmJobProfileSkillRequirements.jobProfileId), asc(hcmJobProfileSkillRequirements.skillId)),
    employeeId > 0
      ? db.select().from(hcmEmployeeSkills)
          .where(and(eq(hcmEmployeeSkills.organizationId, organizationId), eq(hcmEmployeeSkills.employeeId, employeeId)))
          .orderBy(asc(hcmEmployeeSkills.skillId), asc(hcmEmployeeSkills.effectiveFrom))
      : Promise.resolve([]),
    db.select().from(hcmJobProfileCredentialRequirements)
      .where(jobProfileId > 0
        ? and(eq(hcmJobProfileCredentialRequirements.organizationId, organizationId), eq(hcmJobProfileCredentialRequirements.jobProfileId, jobProfileId))
        : eq(hcmJobProfileCredentialRequirements.organizationId, organizationId))
      .orderBy(asc(hcmJobProfileCredentialRequirements.jobProfileId), asc(hcmJobProfileCredentialRequirements.documentRequirementId)),
    db.select().from(hcmDocumentRequirements)
      .where(and(eq(hcmDocumentRequirements.organizationId, organizationId), eq(hcmDocumentRequirements.active, true)))
      .orderBy(asc(hcmDocumentRequirements.name)),
    employeeId > 0
      ? db.select().from(hcmEmployeeDocumentCompliance)
          .where(and(eq(hcmEmployeeDocumentCompliance.organizationId, organizationId), eq(hcmEmployeeDocumentCompliance.employeeId, employeeId)))
          .orderBy(asc(hcmEmployeeDocumentCompliance.requirementId))
      : Promise.resolve([]),
    db.select({ id: jobProfiles.id, title: jobProfiles.title, family: jobProfiles.family, level: jobProfiles.level })
      .from(jobProfiles)
      .where(and(eq(jobProfiles.organizationId, organizationId), eq(jobProfiles.active, true)))
      .orderBy(asc(jobProfiles.family), asc(jobProfiles.title), asc(jobProfiles.level)),
  ]);

  return Response.json({
    skills,
    jobProfiles: profiles,
    jobProfileSkills: profileSkills,
    employeeSkills,
    jobProfileCredentials: profileCredentials,
    documentRequirements,
    employeeDocumentCompliance: employeeDocuments,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage worker capabilities.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  if (action === "create_skill") {
    const code = String(body.code ?? "").trim().toUpperCase().slice(0, 80);
    const name = String(body.name ?? "").trim().slice(0, 160);
    const category = String(body.category ?? "General").trim().slice(0, 80) || "General";
    const description = String(body.description ?? "").trim().slice(0, 1000) || null;
    if (!code || !name) return Response.json({ error: "Skill code and name are required." }, { status: 400 });

    const [created] = await db.insert(hcmSkills).values({
      organizationId,
      code,
      name,
      category,
      description,
      createdByUserId: user.id,
      createdByName: user.name,
    }).onConflictDoNothing().returning();
    if (!created) return Response.json({ error: "That skill code already exists." }, { status: 409 });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM skill created",
      resource: code + " · " + name,
      metadata: { skillId: created.id, category },
    });
    return Response.json({ skill: created }, { status: 201 });
  }

  if (action === "set_job_skill") {
    const jobProfileId = Number(body.jobProfileId);
    const skillId = Number(body.skillId);
    const minimumProficiency = Number(body.minimumProficiency ?? 1);
    const mandatory = bool(body.mandatory, true);
    if (!Number.isInteger(jobProfileId) || !Number.isInteger(skillId)
      || !Number.isInteger(minimumProficiency) || minimumProficiency < 1 || minimumProficiency > 5) {
      return Response.json({ error: "Valid jobProfileId, skillId and proficiency 1-5 are required." }, { status: 400 });
    }
    const [[profile], [skill]] = await Promise.all([
      db.select().from(jobProfiles).where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1),
      db.select().from(hcmSkills).where(and(eq(hcmSkills.id, skillId), eq(hcmSkills.organizationId, organizationId), eq(hcmSkills.active, true))).limit(1),
    ]);
    if (!profile || !skill) return Response.json({ error: "Job profile or skill not found in this workspace." }, { status: 404 });

    const [saved] = await db.insert(hcmJobProfileSkillRequirements).values({
      organizationId,
      jobProfileId,
      skillId,
      minimumProficiency,
      mandatory,
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: [hcmJobProfileSkillRequirements.jobProfileId, hcmJobProfileSkillRequirements.skillId],
      set: { minimumProficiency, mandatory, updatedAt: new Date() },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM job skill requirement set",
      resource: profile.title + " · " + skill.name,
      metadata: { jobProfileId, skillId, minimumProficiency, mandatory },
    });
    return Response.json({ requirement: saved });
  }

  if (action === "set_employee_skill") {
    const employeeId = Number(body.employeeId);
    const skillId = Number(body.skillId);
    const proficiency = Number(body.proficiency ?? 1);
    const status = String(body.status ?? "verified");
    const effectiveFrom = String(body.effectiveFrom ?? "");
    const effectiveUntil = body.effectiveUntil ? String(body.effectiveUntil) : null;
    const notes = String(body.notes ?? "").trim().slice(0, 240) || null;
    if (!Number.isInteger(employeeId) || !Number.isInteger(skillId)
      || !Number.isInteger(proficiency) || proficiency < 1 || proficiency > 5
      || !["declared", "verified", "revoked"].includes(status)
      || !ISO_DATE.test(effectiveFrom)
      || (effectiveUntil != null && (!ISO_DATE.test(effectiveUntil) || effectiveUntil < effectiveFrom))) {
      return Response.json({ error: "Valid employee, skill, proficiency, status and effective dates are required." }, { status: 400 });
    }

    const [[employee], [skill]] = await Promise.all([
      db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1),
      db.select().from(hcmSkills).where(and(eq(hcmSkills.id, skillId), eq(hcmSkills.organizationId, organizationId), eq(hcmSkills.active, true))).limit(1),
    ]);
    if (!employee || !skill) return Response.json({ error: "Employee or skill not found in this workspace." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const verified = status === "verified";
    const [saved] = await db.insert(hcmEmployeeSkills).values({
      organizationId,
      employeeId,
      skillId,
      proficiency,
      status,
      effectiveFrom,
      effectiveUntil,
      verifiedAt: verified ? new Date() : null,
      verifiedByUserId: verified ? user.id : null,
      verifiedByName: verified ? user.name : null,
      notes,
    }).onConflictDoUpdate({
      target: [hcmEmployeeSkills.employeeId, hcmEmployeeSkills.skillId, hcmEmployeeSkills.effectiveFrom],
      set: {
        proficiency,
        status,
        effectiveUntil,
        verifiedAt: verified ? new Date() : null,
        verifiedByUserId: verified ? user.id : null,
        verifiedByName: verified ? user.name : null,
        notes,
        updatedAt: new Date(),
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: verified ? "HCM employee skill verified" : "HCM employee skill updated",
      resource: employee.employeeNo + " · " + skill.name,
      metadata: { employeeId, skillId, proficiency, status, effectiveFrom, effectiveUntil },
    });
    return Response.json({ employeeSkill: saved });
  }

  if (action === "link_credential") {
    const jobProfileId = Number(body.jobProfileId);
    const documentRequirementId = Number(body.documentRequirementId);
    const mandatory = bool(body.mandatory, true);
    const blocksWorkforceEligibility = bool(body.blocksWorkforceEligibility, true);
    if (!Number.isInteger(jobProfileId) || !Number.isInteger(documentRequirementId)) {
      return Response.json({ error: "jobProfileId and documentRequirementId are required." }, { status: 400 });
    }

    const [[profile], [requirement]] = await Promise.all([
      db.select().from(jobProfiles).where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1),
      db.select().from(hcmDocumentRequirements).where(and(
        eq(hcmDocumentRequirements.id, documentRequirementId),
        eq(hcmDocumentRequirements.organizationId, organizationId),
        eq(hcmDocumentRequirements.active, true),
      )).limit(1),
    ]);
    if (!profile || !requirement) return Response.json({ error: "Job profile or document requirement not found." }, { status: 404 });

    const [saved] = await db.insert(hcmJobProfileCredentialRequirements).values({
      organizationId,
      jobProfileId,
      documentRequirementId,
      mandatory,
      blocksWorkforceEligibility,
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: [hcmJobProfileCredentialRequirements.jobProfileId, hcmJobProfileCredentialRequirements.documentRequirementId],
      set: { mandatory, blocksWorkforceEligibility, updatedAt: new Date() },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM job credential requirement set",
      resource: profile.title + " · " + requirement.name,
      metadata: { jobProfileId, documentRequirementId, mandatory, blocksWorkforceEligibility },
    });
    return Response.json({ credentialRequirement: saved });
  }

  return Response.json({
    error: "Unsupported action. Use create_skill, set_job_skill, set_employee_skill or link_credential.",
  }, { status: 400 });
}
