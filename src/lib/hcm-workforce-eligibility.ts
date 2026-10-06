export type CapabilitySkillRequirement = {
  skillId: number;
  skillName: string;
  minimumProficiency: number;
  mandatory: boolean;
};

export type CapabilityEmployeeSkill = {
  skillId: number;
  proficiency: number;
  status: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type CapabilityCredentialRequirement = {
  documentRequirementId: number;
  name: string;
  mandatory: boolean;
  blocksWorkforceEligibility: boolean;
};

export type CapabilityCredentialCompliance = {
  requirementId: number;
  status: string;
  expiresAt: string | null;
  waivedAt?: Date | string | null;
};

export type CapabilityEligibility = {
  status: "eligible" | "warning" | "ineligible";
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  evidence: {
    requiredSkills: number;
    satisfiedSkills: number;
    requiredCredentials: number;
    satisfiedCredentials: number;
  };
};

function activeOnDate(row: { effectiveFrom: string; effectiveUntil: string | null }, date: string) {
  return row.effectiveFrom <= date && (row.effectiveUntil == null || row.effectiveUntil >= date);
}

function credentialPasses(row: CapabilityCredentialCompliance | undefined, date: string) {
  if (!row) return false;
  if (row.waivedAt || row.status === "waived") return true;
  if (!["current", "expiring"].includes(row.status)) return false;
  return row.expiresAt == null || row.expiresAt >= date;
}

export function evaluateCapabilityEligibility(input: {
  workDate: string;
  skillRequirements: CapabilitySkillRequirement[];
  employeeSkills: CapabilityEmployeeSkill[];
  credentialRequirements: CapabilityCredentialRequirement[];
  credentialCompliance: CapabilityCredentialCompliance[];
}): CapabilityEligibility {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let satisfiedSkills = 0;
  let satisfiedCredentials = 0;

  for (const requirement of input.skillRequirements) {
    const active = input.employeeSkills
      .filter((row) => row.skillId === requirement.skillId && activeOnDate(row, input.workDate))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

    const verified = active?.status === "verified";
    const proficient = Number(active?.proficiency ?? 0) >= requirement.minimumProficiency;
    if (verified && proficient) {
      satisfiedSkills += 1;
      continue;
    }

    const detail = !active
      ? `Missing skill: ${requirement.skillName} (level ${requirement.minimumProficiency}+ required).`
      : !verified
        ? `Skill not verified: ${requirement.skillName}.`
        : `Skill below required level: ${requirement.skillName} needs ${requirement.minimumProficiency}+, worker has ${active.proficiency}.`;
    if (requirement.mandatory) blockers.push(detail);
    else warnings.push(detail);
  }

  const complianceByRequirement = new Map(
    input.credentialCompliance.map((row) => [row.requirementId, row]),
  );
  for (const requirement of input.credentialRequirements) {
    const compliance = complianceByRequirement.get(requirement.documentRequirementId);
    const passes = credentialPasses(compliance, input.workDate);
    if (passes) {
      satisfiedCredentials += 1;
      if (compliance?.status === "expiring") {
        warnings.push(`Credential expiring: ${requirement.name}.`);
      }
      continue;
    }

    const detail = !compliance
      ? `Missing credential: ${requirement.name}.`
      : compliance.status === "expired" || (compliance.expiresAt != null && compliance.expiresAt < input.workDate)
        ? `Credential expired: ${requirement.name}.`
        : `Credential not verified/current: ${requirement.name}.`;

    if (requirement.mandatory && requirement.blocksWorkforceEligibility) blockers.push(detail);
    else warnings.push(detail);
  }

  return {
    status: blockers.length ? "ineligible" : warnings.length ? "warning" : "eligible",
    eligible: blockers.length === 0,
    blockers,
    warnings,
    evidence: {
      requiredSkills: input.skillRequirements.length,
      satisfiedSkills,
      requiredCredentials: input.credentialRequirements.length,
      satisfiedCredentials,
    },
  };
}
