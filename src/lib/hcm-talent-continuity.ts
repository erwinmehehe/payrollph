import { createHash } from "node:crypto";

/**
 * Talent continuity is advisory evidence only. Recruitment sees public role
 * expectations; employee reviews and private development records stay behind
 * the manager's separately authorized Performance route.
 */
export type RoleSkill = {
  skillId: number;
  code: string;
  name: string;
  minimumProficiency: number;
  mandatory: boolean;
  source: "profile" | "family_level" | "level" | "family";
};
export type RoleSkillSnapshot = {
  version: "hcm-talent-role-skills-v1";
  jobProfileId: number;
  profileTitle: string;
  capturedAt: string;
  requirements: RoleSkill[];
  fingerprint: string;
};
export type RoleSkillProfile = {
  id: number; title: string; familyId: number | null; levelId: number | null; active: boolean;
};
export type RoleSkillDefinition = {
  id: number; code: string; name: string; active: boolean;
};
export type RoleDirectRequirement = {
  jobProfileId: number; skillId: number; minimumProficiency: number; mandatory: boolean;
};
export type RoleInheritedRequirement = {
  jobFamilyId: number | null;
  jobLevelId: number | null;
  skillId: number;
  minimumProficiency: number;
  mandatory: boolean;
  active: boolean;
};
export type EmployeeTalentSkillEvidence = {
  skillId: number; proficiency: number; status: string;
  effectiveFrom: string; effectiveUntil: string | null;
};
export type TalentFinalReviewEvidence = {
  skillId: number; finalScore: string | number | null; cycleEndDate: string;
  reviewId: number; completed: boolean;
};
export type TalentDevelopmentEvidence = {
  skillId: number; id: number; status: string; targetProficiency: string;
  targetDate: string; updatedAt: string;
};

export class TalentRoleArchitectureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TalentRoleArchitectureError";
  }
}

function validLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function fingerprintBody(snapshot: Omit<RoleSkillSnapshot, "capturedAt" | "fingerprint">) {
  return JSON.stringify([
    snapshot.version, snapshot.jobProfileId, snapshot.profileTitle,
    snapshot.requirements.map((r) => [
      r.skillId, r.code, r.name, r.minimumProficiency, r.mandatory, r.source,
    ]),
  ]);
}
function hash(snapshot: Omit<RoleSkillSnapshot, "capturedAt" | "fingerprint">) {
  return createHash("sha256").update(fingerprintBody(snapshot)).digest("hex");
}

export function freezeTalentRoleSkills(input: {
  profile: RoleSkillProfile;
  skills: RoleSkillDefinition[];
  direct: RoleDirectRequirement[];
  inherited: RoleInheritedRequirement[];
  capturedAt: string;
}): RoleSkillSnapshot {
  const { profile } = input;
  if (!validId(profile.id) || !profile.active || !profile.title.trim()) {
    throw new TalentRoleArchitectureError("Recruitment requires a current active job profile.");
  }
  const available = new Map(input.skills.map((skill) => [skill.id, skill]));
  const expectations = new Map<number, RoleSkill & { precedence: number }>();
  for (const row of input.inherited) {
    if (!row.active) continue;
    if (row.jobFamilyId == null && row.jobLevelId == null) continue;
    if (row.jobFamilyId != null && row.jobFamilyId !== profile.familyId) continue;
    if (row.jobLevelId != null && row.jobLevelId !== profile.levelId) continue;
    const precedence = row.jobFamilyId != null && row.jobLevelId != null
      ? 3 : row.jobLevelId != null ? 2 : 1;
    const source: RoleSkill["source"] = precedence === 3 ? "family_level" : precedence === 2 ? "level" : "family";
    const skill = available.get(row.skillId);
    if (!skill?.active || !validLevel(row.minimumProficiency)) {
      throw new TalentRoleArchitectureError("Active inherited role expectation refers to an inactive skill or invalid proficiency.");
    }
    const previous = expectations.get(row.skillId);
    if (previous && previous.precedence === precedence &&
      (previous.minimumProficiency !== row.minimumProficiency || previous.mandatory !== row.mandatory)) {
      throw new TalentRoleArchitectureError("Conflicting inherited role expectations require People administrator reconciliation.");
    }
    if (!previous || precedence > previous.precedence) {
      expectations.set(row.skillId, {
        skillId: row.skillId, code: skill.code, name: skill.name,
        minimumProficiency: row.minimumProficiency, mandatory: row.mandatory, source, precedence,
      });
    }
  }
  for (const row of input.direct) {
    if (row.jobProfileId !== profile.id) continue;
    const skill = available.get(row.skillId);
    if (!skill?.active || !validLevel(row.minimumProficiency)) {
      throw new TalentRoleArchitectureError("Direct job-profile expectation refers to an inactive skill or invalid proficiency.");
    }
    expectations.set(row.skillId, {
      skillId: row.skillId, code: skill.code, name: skill.name,
      minimumProficiency: row.minimumProficiency, mandatory: row.mandatory,
      source: "profile", precedence: 4,
    });
  }
  const requirements: RoleSkill[] = [...expectations.values()]
    .sort((a, b) => a.code.localeCompare(b.code) || a.skillId - b.skillId)
    .map(({ precedence: _precedence, ...row }) => row);
  const body = {
    version: "hcm-talent-role-skills-v1" as const,
    jobProfileId: profile.id,
    profileTitle: profile.title,
    requirements,
  };
  const capturedAt = new Date(input.capturedAt).toISOString();
  return { ...body, capturedAt, fingerprint: hash(body) };
}

/**
 * Fingerprint detects corrupted/partial snapshots but is not a substitute for
 * DB authorization or a digital signature. Only Recruitment may write it.
 */
export function parseTalentRoleSkills(value: unknown): RoleSkillSnapshot | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TalentRoleArchitectureError("Role skill snapshot is invalid.");
  const raw = value as Record<string, unknown>;
  if (raw.version !== "hcm-talent-role-skills-v1" ||
    !validId(raw.jobProfileId) || typeof raw.profileTitle !== "string" || !raw.profileTitle.trim() ||
    typeof raw.capturedAt !== "string" || !Number.isFinite(Date.parse(raw.capturedAt)) ||
    !Array.isArray(raw.requirements) || raw.requirements.length > 500 ||
    typeof raw.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(raw.fingerprint)) {
    throw new TalentRoleArchitectureError("Frozen job-profile skills are missing or invalid.");
  }
  const requirements: RoleSkill[] = raw.requirements.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TalentRoleArchitectureError("Invalid frozen skill row.");
    const row = value as Record<string, unknown>;
    if (!validId(row.skillId) || typeof row.code !== "string" || !row.code ||
      typeof row.name !== "string" || !row.name || !validLevel(row.minimumProficiency) ||
      typeof row.mandatory !== "boolean" ||
      !["profile", "family_level", "level", "family"].includes(String(row.source))) {
      throw new TalentRoleArchitectureError("Frozen skill row is incomplete.");
    }
    return {
      skillId: row.skillId, code: row.code, name: row.name,
      minimumProficiency: row.minimumProficiency, mandatory: row.mandatory,
      source: row.source as RoleSkill["source"],
    };
  });
  if (new Set(requirements.map((r) => r.skillId)).size !== requirements.length) {
    throw new TalentRoleArchitectureError("Duplicate frozen role skills are invalid.");
  }
  const body = {
    version: "hcm-talent-role-skills-v1" as const,
    jobProfileId: raw.jobProfileId,
    profileTitle: raw.profileTitle,
    requirements,
  };
  if (hash(body) !== raw.fingerprint) {
    throw new TalentRoleArchitectureError("Frozen role skill evidence differs from its fingerprint.");
  }
  return { ...body, capturedAt: raw.capturedAt, fingerprint: raw.fingerprint };
}

export function compareInternalTalentEvidence(input: {
  snapshot: RoleSkillSnapshot;
  employeeSkills: EmployeeTalentSkillEvidence[];
  completedReviews: TalentFinalReviewEvidence[];
  developmentPlans: TalentDevelopmentEvidence[];
  asOf: string;
}) {
  const validSnapshot = parseTalentRoleSkills(input.snapshot);
  if (!validSnapshot) throw new TalentRoleArchitectureError("Role expectations are not frozen.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new TalentRoleArchitectureError("Invalid evidence date.");

  const rows = validSnapshot.requirements.map((requirement) => {
    // Latest ledger row determines whether evidence is currently verified.
    // Do not re-use an earlier verified row after a later unverified revision.
    const live = input.employeeSkills.filter((r) =>
      r.skillId === requirement.skillId && r.effectiveFrom <= input.asOf &&
      (r.effectiveUntil == null || r.effectiveUntil >= input.asOf))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    const verified = live?.status === "verified" && validLevel(live.proficiency);
    const status = verified
      ? live!.proficiency >= requirement.minimumProficiency ? "verified_meets" : "verified_below"
      : "unverified";
    // Finalized cycle + completed review only. A review score is private
    // developmental evidence, not a verified worker capability credential.
    const review = input.completedReviews.filter((r) =>
      r.skillId === requirement.skillId && r.completed &&
      r.cycleEndDate <= input.asOf && r.finalScore != null &&
      Number.isFinite(Number(r.finalScore)) && Number(r.finalScore) >= 1 &&
      Number(r.finalScore) <= 5)
      .sort((a, b) => b.cycleEndDate.localeCompare(a.cycleEndDate) || b.reviewId - a.reviewId)[0];
    const plan = input.developmentPlans.filter((r) => r.skillId === requirement.skillId)
      .sort((a, b) => {
        const active = (s: string) => ["planned", "in_progress"].includes(s) ? 1 : 0;
        return active(b.status) - active(a.status) || b.updatedAt.localeCompare(a.updatedAt);
      })[0];
    return {
      ...requirement,
      status: status as "verified_meets" | "verified_below" | "unverified",
      verifiedProficiency: verified ? live!.proficiency : null,
      lastCompletedReviewScore: review ? Number(review.finalScore) : null,
      lastCompletedReviewDate: review?.cycleEndDate ?? null,
      developmentPlan: plan ? {
        id: plan.id, status: plan.status,
        targetProficiency: Number(plan.targetProficiency),
        targetDate: plan.targetDate,
      } : null,
    };
  });
  const mandatory = rows.filter((r) => r.mandatory);
  const counts = {
    total: rows.length,
    mandatory: mandatory.length,
    verifiedMeeting: mandatory.filter((r) => r.status === "verified_meets").length,
    verifiedBelow: mandatory.filter((r) => r.status === "verified_below").length,
    unverified: mandatory.filter((r) => r.status === "unverified").length,
    activeDevelopmentPlans: rows.filter((r) =>
      ["planned", "in_progress"].includes(r.developmentPlan?.status ?? "")).length,
  };
  return {
    version: "hcm-private-talent-continuity-v1" as const,
    asOf: input.asOf,
    target: {
      jobProfileId: validSnapshot.jobProfileId,
      profileTitle: validSnapshot.profileTitle,
      fingerprint: validSnapshot.fingerprint,
      capturedAt: validSnapshot.capturedAt,
    },
    configured: rows.length > 0,
    counts,
    rows,
    notice: "Evidence comparison only. No applicant ranking, automatic promotion, hiring decision or new qualification is granted. Completed development plans and review scores never substitute for verified skill credentials.",
  };
}
