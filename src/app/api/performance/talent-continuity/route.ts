import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees, hcmEmployeeSkills, jobRequisitions, performanceCycles,
  performanceReviewItems, performanceReviews, performanceSkillDevelopmentPlans,
  positions,
} from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { hcmManilaDay } from "@/lib/hcm-people-intelligence";
import {
  compareInternalTalentEvidence, parseTalentRoleSkills, TalentRoleArchitectureError,
} from "@/lib/hcm-talent-continuity";

export const dynamic = "force-dynamic";
const PRIVATE_TALENT_ROLES = ["owner", "admin", "hr", "manager"] as const;

const privateJson = (payload: unknown, init?: ResponseInit) =>
  Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...init?.headers },
  });

/**
 * Independent authorization boundary: Recruitment may see role-only criteria,
 * but MUST NOT receive employee review scores, private development plans,
 * verified worker skill evidence or comparative internal mobility results.
 */
export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return privateJson({ error: "Authentication required." }, { status: 401 });

  const query = new URL(request.url).searchParams;
  const organizationId = Number(query.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return privateJson({ error: "Valid organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    session.id, organizationId, PRIVATE_TALENT_ROLES,
    "Only scoped People or performance managers can review private talent evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access) return privateJson({ error: "No active organization access." }, { status: 403 });

  const [staff, openings, positionRows] = await Promise.all([
    db.select({
      id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
      orgUnitId: employees.orgUnitId, status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      id: jobRequisitions.id, positionId: jobRequisitions.positionId,
      title: jobRequisitions.title, status: jobRequisitions.status,
      roleSkillSnapshot: jobRequisitions.roleSkillSnapshot,
    }).from(jobRequisitions).where(eq(jobRequisitions.organizationId, organizationId)),
    db.select({
      id: positions.id, orgUnitId: positions.orgUnitId,
      jobProfileId: positions.jobProfileId, status: positions.status,
    }).from(positions).where(eq(positions.organizationId, organizationId)),
  ]);
  const positionById = new Map(positionRows.map((row) => [row.id, row]));
  const visibleEmployees = staff.filter((employee) =>
    employee.status.toLowerCase() === "active" && assertScope(access, employee.orgUnitId).ok);
  const visibleRequisitions = openings.filter((row) => {
    if (!["open", "interviewing"].includes(row.status) || row.positionId == null) return false;
    const position = positionById.get(row.positionId);
    return Boolean(position && assertScope(access, position.orgUnitId).ok);
  });

  const employeeId = Number(query.get("employeeId") ?? "0");
  const requisitionId = Number(query.get("requisitionId") ?? "0");
  if (!query.has("employeeId") && !query.has("requisitionId")) {
    return privateJson({
      employees: visibleEmployees.map((worker) => ({
        id: worker.id, label: `${worker.firstName} ${worker.lastName}`,
      })),
      requisitions: visibleRequisitions.map((row) => {
        const candidateSnapshot = row.roleSkillSnapshot as Record<string, unknown> | null;
        return {
          id: row.id, title: row.title,
          roleCriteriaRecorded: candidateSnapshot?.version === "hcm-talent-role-skills-v1",
        };
      }),
      notice: "Internal evidence is private to authorized managers. Recruitment only sees role criteria.",
    });
  }
  if (!Number.isSafeInteger(employeeId) || !Number.isSafeInteger(requisitionId) ||
      employeeId <= 0 || requisitionId <= 0) {
    return privateJson({ error: "Positive employeeId and requisitionId are required together." }, { status: 400 });
  }

  const employee = visibleEmployees.find((worker) => worker.id === employeeId);
  const requisition = visibleRequisitions.find((row) => row.id === requisitionId);
  if (!employee || !requisition) {
    // Avoid exposing whether a different tenant/unit's employee or vacancy exists.
    return privateJson({ error: "Employee or active requisition not found in authorized performance scope." }, { status: 404 });
  }
  const position = positionById.get(requisition.positionId!);
  if (!position) return privateJson({ error: "Authoritative position not available." }, { status: 409 });
  let role;
  try {
    role = parseTalentRoleSkills(requisition.roleSkillSnapshot);
    if (!role) {
      return privateJson({ error: "This historical requisition predates frozen job-profile expectations. Open a new approved requisition to establish role criteria." }, { status: 409 });
    }
  } catch (error) {
    return privateJson({ error: error instanceof TalentRoleArchitectureError ? error.message : "Invalid role expectation evidence." }, { status: 409 });
  }
  if (role.jobProfileId !== position.jobProfileId) {
    return privateJson({ error: "Position job profile changed after role criteria were captured; People must reconcile the requisition." }, { status: 409 });
  }
  const skillIds = role.requirements.map((r) => r.skillId);
  const [skillEvidence, development, reviewRows] = await Promise.all([
    skillIds.length ? db.select({
      skillId: hcmEmployeeSkills.skillId,
      proficiency: hcmEmployeeSkills.proficiency,
      status: hcmEmployeeSkills.status,
      effectiveFrom: hcmEmployeeSkills.effectiveFrom,
      effectiveUntil: hcmEmployeeSkills.effectiveUntil,
    }).from(hcmEmployeeSkills).where(and(
      eq(hcmEmployeeSkills.organizationId, organizationId),
      eq(hcmEmployeeSkills.employeeId, employeeId),
      inArray(hcmEmployeeSkills.skillId, skillIds),
    )) : Promise.resolve([]),
    skillIds.length ? db.select({
      id: performanceSkillDevelopmentPlans.id, skillId: performanceSkillDevelopmentPlans.skillId,
      status: performanceSkillDevelopmentPlans.status,
      targetProficiency: performanceSkillDevelopmentPlans.targetProficiency,
      targetDate: performanceSkillDevelopmentPlans.targetDate,
      updatedAt: performanceSkillDevelopmentPlans.updatedAt,
    }).from(performanceSkillDevelopmentPlans).where(and(
      eq(performanceSkillDevelopmentPlans.organizationId, organizationId),
      eq(performanceSkillDevelopmentPlans.employeeId, employeeId),
      inArray(performanceSkillDevelopmentPlans.skillId, skillIds),
    )) : Promise.resolve([]),
    skillIds.length ? db.select({
      skillId: performanceReviewItems.skillId,
      finalScore: performanceReviewItems.finalScore,
      cycleEndDate: performanceCycles.endDate,
      reviewId: performanceReviews.id,
    }).from(performanceReviewItems)
      .innerJoin(performanceReviews, and(
        eq(performanceReviewItems.reviewId, performanceReviews.id),
        eq(performanceReviews.organizationId, organizationId),
      ))
      .innerJoin(performanceCycles, and(
        eq(performanceReviews.cycleId, performanceCycles.id),
        eq(performanceCycles.organizationId, organizationId),
      )).where(and(
        eq(performanceReviewItems.organizationId, organizationId),
        eq(performanceReviews.employeeId, employeeId),
        eq(performanceReviews.status, "completed"),
        eq(performanceCycles.status, "completed"),
        inArray(performanceReviewItems.skillId, skillIds),
      )) : Promise.resolve([]),
  ]);
  const comparison = compareInternalTalentEvidence({
    snapshot: role,
    asOf: hcmManilaDay(new Date()),
    employeeSkills: skillEvidence.map((row) => ({
      ...row, effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil == null ? null : String(row.effectiveUntil),
    })),
    completedReviews: reviewRows.flatMap((row) => row.skillId == null ? [] : [{
      ...row, skillId: row.skillId, cycleEndDate: String(row.cycleEndDate), completed: true,
    }]),
    developmentPlans: development.map((row) => ({
      ...row, targetDate: String(row.targetDate), updatedAt: row.updatedAt.toISOString(),
    })),
  });
  await recordAuditEvent({
    organizationId, actor: session.name,
    action: "Private talent role evidence reviewed",
    resource: `Employee #${employeeId} / requisition #${requisitionId}`,
    metadata: {
      employeeId, requisitionId, positionId: position.id,
      roleSkillFingerprint: role.fingerprint,
      // Never store individual scores, development objectives or evaluations here.
    },
  });
  return privateJson({
    employee: { id: employee.id, label: `${employee.firstName} ${employee.lastName}` },
    requisition: { id: requisition.id, title: requisition.title, positionId: position.id },
    comparison,
  });
}
