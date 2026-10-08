import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareInternalTalentEvidence,
  freezeTalentRoleSkills,
  parseTalentRoleSkills,
  TalentRoleArchitectureError,
  type RoleSkillDefinition,
  type RoleInheritedRequirement,
  type EmployeeTalentSkillEvidence,
} from "../src/lib/hcm-talent-continuity";

const profile = {
  id: 30, title: "Operations Lead", familyId: 2, levelId: 3, active: true,
};
const skills: RoleSkillDefinition[] = [
  { id: 1, code: "OPS", name: "Operations leadership", active: true },
  { id: 2, code: "COMM", name: "Communication", active: true },
  { id: 3, code: "SAFETY", name: "Safety", active: true },
];
const inherited: RoleInheritedRequirement[] = [
  { skillId: 1, jobFamilyId: 2, jobLevelId: null, minimumProficiency: 1, mandatory: true, active: true },
  { skillId: 1, jobFamilyId: null, jobLevelId: 3, minimumProficiency: 2, mandatory: true, active: true },
  { skillId: 1, jobFamilyId: 2, jobLevelId: 3, minimumProficiency: 4, mandatory: true, active: true },
  { skillId: 2, jobFamilyId: 2, jobLevelId: 3, minimumProficiency: 4, mandatory: false, active: true },
  { skillId: 3, jobFamilyId: 2, jobLevelId: null, minimumProficiency: 3, mandatory: true, active: true },
  { skillId: 3, jobFamilyId: 99, jobLevelId: null, minimumProficiency: 5, mandatory: true, active: true },
  { skillId: 2, jobFamilyId: 2, jobLevelId: null, minimumProficiency: 5, mandatory: true, active: false },
];
const freeze = (overrides: Partial<Parameters<typeof freezeTalentRoleSkills>[0]> = {}) =>
  freezeTalentRoleSkills({
    profile,
    skills,
    direct: [{ jobProfileId: 30, skillId: 1, minimumProficiency: 3, mandatory: true }],
    inherited,
    capturedAt: "2026-10-08T09:05:00.000Z",
    ...overrides,
  });

test("role snapshot uses profile > family+level > level > family, excluding inactive defaults", () => {
  const frozen = freeze();
  assert.equal(frozen.version, "hcm-talent-role-skills-v1");
  assert.deepEqual(frozen.requirements.map((r) => r.code), ["COMM", "OPS", "SAFETY"]);
  assert.equal(frozen.requirements[0].source, "family_level");
  assert.equal(frozen.requirements[0].minimumProficiency, 4);
  assert.equal(frozen.requirements[0].mandatory, false);
  assert.equal(frozen.requirements[1].source, "profile");
  assert.equal(frozen.requirements[1].minimumProficiency, 3);
  assert.equal(frozen.requirements[2].source, "family");
  assert.equal(frozen.requirements[2].minimumProficiency, 3);
  assert.equal(frozen.fingerprint.length, 64);
  assert.deepEqual(parseTalentRoleSkills(frozen), frozen);
});

test("frozen expectations are reproducible and bind to job, proficiency and required status", () => {
  const first = freeze();
  const second = freeze({ skills: [...skills].reverse(), inherited: [...inherited].reverse(),
    capturedAt: "2026-10-08T09:06:00.000Z" });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.capturedAt, second.capturedAt);
  assert.notEqual(first.fingerprint, freeze({ direct: [{
    jobProfileId: 30, skillId: 1, minimumProficiency: 4, mandatory: true,
  }] }).fingerprint);
  const altered = { ...first, requirements: first.requirements.map((r) =>
    r.skillId === 2 ? { ...r, mandatory: true } : r) };
  assert.throws(() => parseTalentRoleSkills(altered), /fingerprint/);
  assert.throws(() => parseTalentRoleSkills({ ...first, requirements: [...first.requirements, first.requirements[0]] }), /Duplicate/);
  assert.equal(parseTalentRoleSkills(null), null);
});

test("incorrect or conflicting role architecture blocks new immutable criteria", () => {
  assert.throws(() => freeze({ profile: { ...profile, active: false } }), /active job profile/);
  assert.throws(() => freeze({ skills: skills.map((s) =>
    s.id === 1 ? { ...s, active: false } : s) }), /inactive skill/);
  assert.throws(() => freeze({
    direct: [{ jobProfileId: 30, skillId: 1, minimumProficiency: 6, mandatory: true }],
  }), /invalid proficiency/);
  assert.throws(() => freeze({ inherited: [
    ...inherited,
    { skillId: 3, jobFamilyId: 2, jobLevelId: null, minimumProficiency: 5, mandatory: false, active: true },
  ] }), /Conflicting inherited/);
  assert.throws(() => parseTalentRoleSkills({ version: "other" }), TalentRoleArchitectureError);
});

test("empty job-profile skill architecture is explicitly unconfigured, never automatically ready", () => {
  const blank = freeze({ direct: [], inherited: [] });
  assert.equal(blank.requirements.length, 0);
  const result = compareInternalTalentEvidence({
    snapshot: blank, employeeSkills: [], completedReviews: [], developmentPlans: [], asOf: "2026-10-08",
  });
  assert.equal(result.configured, false);
  assert.equal(result.counts.mandatory, 0);
  assert.match(result.notice, /No applicant ranking/);
});

test("internal comparison uses current VERIFIED worker skills; reviews and plans cannot certify a skill", () => {
  const employeeSkills: EmployeeTalentSkillEvidence[] = [
    { skillId: 1, proficiency: 3, status: "verified", effectiveFrom: "2026-01-01", effectiveUntil: null },
    { skillId: 2, proficiency: 2, status: "verified", effectiveFrom: "2026-01-01", effectiveUntil: null },
    { skillId: 3, proficiency: 5, status: "declared", effectiveFrom: "2026-01-01", effectiveUntil: null },
  ];
  const result = compareInternalTalentEvidence({
    snapshot: freeze(), employeeSkills, asOf: "2026-10-08",
    completedReviews: [
      { skillId: 3, finalScore: "5.00", cycleEndDate: "2026-09-01", reviewId: 22, completed: true },
      { skillId: 3, finalScore: "2.00", cycleEndDate: "2026-10-20", reviewId: 23, completed: true },
      { skillId: 2, finalScore: "5.00", cycleEndDate: "2026-08-01", reviewId: 24, completed: false },
    ],
    developmentPlans: [
      { skillId: 3, id: 11, status: "in_progress", targetProficiency: "4.00", targetDate: "2026-12-01", updatedAt: "2026-09-01" },
      { skillId: 3, id: 10, status: "completed", targetProficiency: "5.00", targetDate: "2026-08-01", updatedAt: "2026-09-15" },
    ],
  });
  assert.deepEqual(result.counts, {
    total: 3, mandatory: 2, verifiedMeeting: 1,
    verifiedBelow: 0, unverified: 1, activeDevelopmentPlans: 1,
  });
  assert.equal(result.rows.find((r) => r.skillId === 1)?.status, "verified_meets");
  assert.equal(result.rows.find((r) => r.skillId === 2)?.status, "verified_below");
  const missing = result.rows.find((r) => r.skillId === 3);
  assert.equal(missing?.status, "unverified");
  assert.equal(missing?.lastCompletedReviewScore, 5);
  assert.equal(missing?.developmentPlan?.status, "in_progress");
  assert.equal(missing?.verifiedProficiency, null);
  assert.equal(result.rows.find((r) => r.skillId === 2)?.lastCompletedReviewScore, null);
  assert.match(result.notice, /never substitute/);
});

test("expired verified records and later declared skill updates fail closed", () => {
  const snapshot = freeze();
  const result = compareInternalTalentEvidence({
    snapshot,
    employeeSkills: [
      { skillId: 1, proficiency: 5, status: "verified", effectiveFrom: "2026-01-01", effectiveUntil: "2026-04-30" },
      { skillId: 1, proficiency: 2, status: "declared", effectiveFrom: "2026-05-01", effectiveUntil: null },
    ],
    completedReviews: [], developmentPlans: [], asOf: "2026-10-08",
  });
  assert.equal(result.rows.find((r) => r.skillId === 1)?.status, "unverified");
});

test("recruitment keeps role-only snapshots, while manager comparison retains a separate access boundary", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0099_talent_role_requisition_skills.sql", "utf8");
  const recruitment = readFileSync("src/app/api/recruitment/route.ts", "utf8");
  const manager = readFileSync("src/app/api/performance/talent-continuity/route.ts", "utf8");
  const recruitmentUi = readFileSync("src/components/recruitment-panel.tsx", "utf8");
  const privateUi = readFileSync("src/components/talent-continuity-panel.tsx", "utf8");
  const performanceUi = readFileSync("src/components/performance-panel.tsx", "utf8");
  assert.match(schema, /roleSkillSnapshot: jsonb\("role_skill_snapshot"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "role_skill_snapshot" jsonb/);
  assert.match(recruitment, /freezeTalentRoleSkills\(/);
  assert.match(recruitment, /roleSkillSnapshot: roleSkills/);
  assert.match(recruitment, /ROLE_SKILL_ARCHITECTURE_INCOMPLETE/);
  assert.doesNotMatch(recruitment, /performanceReviews|performanceReviewItems|performanceSkillDevelopmentPlans|hcmEmployeeSkills/);
  assert.match(manager, /PRIVATE_TALENT_ROLES = \["owner", "admin", "hr", "manager"\]/);
  assert.match(manager, /assertOrganizationRole\(/);
  assert.match(manager, /assertScope\(access, employee.orgUnitId\)/);
  assert.match(manager, /assertScope\(access, position.orgUnitId\)/);
  assert.match(manager, /eq\(performanceCycles.status, "completed"\)/);
  assert.match(manager, /eq\(performanceReviews.status, "completed"\)/);
  assert.match(manager, /role.jobProfileId !== position.jobProfileId/);
  assert.match(manager, /private, no-store/);
  assert.match(manager, /Private talent role evidence reviewed/);
  assert.match(recruitmentUi, /Role criteria · frozen at requisition opening/);
  assert.doesNotMatch(recruitmentUi, /lastCompletedReviewScore|developmentPlan|verifiedProficiency/);
  assert.match(performanceUi, /TalentContinuityPanel/);
  assert.match(privateUi, /lastCompletedReviewScore/);
  assert.match(privateUi, /No applicant ranking|does not rank people/);
});
