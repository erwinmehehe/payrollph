import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
  hcmEmployeeSkills,
  hcmJobProfileCredentialRequirements,
  hcmJobProfileSkillRequirements,
  hcmSkills,
} from "@/db/schema";
import {
  evaluateCapabilityEligibility,
  type CapabilityEligibility,
} from "@/lib/hcm-workforce-eligibility";

export type CapabilityEligibilityData = Awaited<ReturnType<typeof loadCapabilityEligibilityData>>;

export async function loadCapabilityEligibilityData(input: {
  organizationId: number;
  employeeIds: number[];
  jobProfileIds: number[];
}) {
  const employeeIds = [...new Set(input.employeeIds.filter((id) => Number.isInteger(id) && id > 0))];
  const jobProfileIds = [...new Set(input.jobProfileIds.filter((id) => Number.isInteger(id) && id > 0))];

  if (!employeeIds.length || !jobProfileIds.length) {
    return {
      skillRequirements: [],
      employeeSkills: [],
      credentialRequirements: [],
      credentialCompliance: [],
    };
  }

  const [skillRequirementRows, employeeSkillRows, credentialRequirementRows] = await Promise.all([
    db.select({
      jobProfileId: hcmJobProfileSkillRequirements.jobProfileId,
      skillId: hcmJobProfileSkillRequirements.skillId,
      minimumProficiency: hcmJobProfileSkillRequirements.minimumProficiency,
      mandatory: hcmJobProfileSkillRequirements.mandatory,
      skillName: hcmSkills.name,
    }).from(hcmJobProfileSkillRequirements)
      .innerJoin(hcmSkills, eq(hcmJobProfileSkillRequirements.skillId, hcmSkills.id))
      .where(and(
        eq(hcmJobProfileSkillRequirements.organizationId, input.organizationId),
        inArray(hcmJobProfileSkillRequirements.jobProfileId, jobProfileIds),
        eq(hcmSkills.active, true),
      )),
    db.select().from(hcmEmployeeSkills).where(and(
      eq(hcmEmployeeSkills.organizationId, input.organizationId),
      inArray(hcmEmployeeSkills.employeeId, employeeIds),
    )),
    db.select({
      jobProfileId: hcmJobProfileCredentialRequirements.jobProfileId,
      documentRequirementId: hcmJobProfileCredentialRequirements.documentRequirementId,
      mandatory: hcmJobProfileCredentialRequirements.mandatory,
      blocksWorkforceEligibility: hcmJobProfileCredentialRequirements.blocksWorkforceEligibility,
      name: hcmDocumentRequirements.name,
    }).from(hcmJobProfileCredentialRequirements)
      .innerJoin(
        hcmDocumentRequirements,
        eq(hcmJobProfileCredentialRequirements.documentRequirementId, hcmDocumentRequirements.id),
      )
      .where(and(
        eq(hcmJobProfileCredentialRequirements.organizationId, input.organizationId),
        inArray(hcmJobProfileCredentialRequirements.jobProfileId, jobProfileIds),
        eq(hcmDocumentRequirements.active, true),
      )),
  ]);

  const documentRequirementIds = [...new Set(
    credentialRequirementRows.map((row) => row.documentRequirementId),
  )];
  const credentialCompliance = documentRequirementIds.length
    ? await db.select().from(hcmEmployeeDocumentCompliance).where(and(
        eq(hcmEmployeeDocumentCompliance.organizationId, input.organizationId),
        inArray(hcmEmployeeDocumentCompliance.employeeId, employeeIds),
        inArray(hcmEmployeeDocumentCompliance.requirementId, documentRequirementIds),
      ))
    : [];

  return {
    skillRequirements: skillRequirementRows,
    employeeSkills: employeeSkillRows,
    credentialRequirements: credentialRequirementRows,
    credentialCompliance,
  };
}

export function evaluateEmployeeFromCapabilityData(input: {
  data: CapabilityEligibilityData;
  employeeId: number;
  jobProfileId: number;
  workDate: string;
}): CapabilityEligibility {
  return evaluateCapabilityEligibility({
    workDate: input.workDate,
    skillRequirements: input.data.skillRequirements
      .filter((row) => row.jobProfileId === input.jobProfileId)
      .map((row) => ({
        skillId: row.skillId,
        skillName: row.skillName,
        minimumProficiency: row.minimumProficiency,
        mandatory: row.mandatory,
      })),
    employeeSkills: input.data.employeeSkills
      .filter((row) => row.employeeId === input.employeeId)
      .map((row) => ({
        skillId: row.skillId,
        proficiency: row.proficiency,
        status: row.status,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      })),
    credentialRequirements: input.data.credentialRequirements
      .filter((row) => row.jobProfileId === input.jobProfileId)
      .map((row) => ({
        documentRequirementId: row.documentRequirementId,
        name: row.name,
        mandatory: row.mandatory,
        blocksWorkforceEligibility: row.blocksWorkforceEligibility,
      })),
    credentialCompliance: input.data.credentialCompliance
      .filter((row) => row.employeeId === input.employeeId)
      .map((row) => ({
        requirementId: row.requirementId,
        status: row.status,
        expiresAt: row.expiresAt ? String(row.expiresAt) : null,
        waivedAt: row.waivedAt,
      })),
  });
}

export async function loadEmployeeWfmEligibility(input: {
  organizationId: number;
  employeeId: number;
  jobProfileId: number;
  workDate: string;
}) {
  const data = await loadCapabilityEligibilityData({
    organizationId: input.organizationId,
    employeeIds: [input.employeeId],
    jobProfileIds: [input.jobProfileId],
  });
  return evaluateEmployeeFromCapabilityData({ data, ...input });
}
