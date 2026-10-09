import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  automationExecutions,
  automationRules,
  compensationProposals,
  benefitEnrollments,
  benefitPlans,
  costCenters,
  employeeWorksiteAssignments,
  employees,
  externalIdentities,
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
  hcmEmployeeSkills,
  hcmEmploymentTermDecisions,
  hcmEmploymentTerms,
  hcmWorkArrangements,
  hcmWorksiteAuthorizations,
  hcmJobProfileCredentialRequirements,
  hcmJobProfileSkillRequirements,
  hcmSkills,
  jobApplicants,
  jobRequisitions,
  payrollEntries,
  payrollRuns,
  performanceReviews,
  hcmPolicyAssignments,
  hcmPolicyVersions,
  jobProfiles,
  legalEntities,
  orgUnits,
  permissionSets,
  positionAssignments,
  positions,
  provisioningTasks,
  scimIdentities,
  separationRecords,
  userOrganizations,
  userPermissionAssignments,
  users,
  workerEffectiveChanges,
  workerEmploymentEvents,
  worksites,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { loadEmployeeWfmEligibility } from "@/lib/hcm-workforce-eligibility-server";
import { employeeSiteEligibility } from "@/lib/hcm-worksite-eligibility-server";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { employmentTermLifecycle } from "@/lib/hcm-employment-terms";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  PAYROLL_VIEW_ROLES,
  roleAllowed,
} from "@/lib/access";
import { roleGateAllowed } from "@/lib/permissions";
import { buildHcmWorkerJourney } from "@/lib/hcm-worker-journey";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId"));
  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view the connected worker profile.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [employee] = await db.select({
    id: employees.id,
    organizationId: employees.organizationId,
    orgUnitId: employees.orgUnitId,
    legalEntityId: employees.legalEntityId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
    employmentType: employees.employmentType,
    status: employees.status,
    email: employees.email,
    startDate: employees.startDate,
  }).from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);

  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  const [
    assignmentRows,
    assignmentHistoryRows,
    employmentEventRows,
    benefitRows,
    assetRows,
    taskRows,
    executionRows,
    linkedUsers,
    separationRows,
    policyRows,
    documentComplianceRows,
    employeeSkillRows,
    employmentTermRows,
    employmentTermDecisionRows,
  ] = await Promise.all([
    db.select().from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, employeeId),
      eq(positionAssignments.assignmentType, "primary"),
      isNull(positionAssignments.effectiveUntil),
    )).limit(1),
    db.select().from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, employeeId),
    )).orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id)),
    db.select().from(workerEmploymentEvents).where(and(
      eq(workerEmploymentEvents.organizationId, organizationId),
      eq(workerEmploymentEvents.employeeId, employeeId),
    )).orderBy(desc(workerEmploymentEvents.effectiveDate), desc(workerEmploymentEvents.id)),
    db.select({
      id: benefitEnrollments.id,
      planId: benefitEnrollments.planId,
      status: benefitEnrollments.status,
      monthlyContribution: benefitEnrollments.monthlyContribution,
      startedOn: benefitEnrollments.startedOn,
      endedOn: benefitEnrollments.endedOn,
      planName: benefitPlans.name,
      category: benefitPlans.category,
      provider: benefitPlans.provider,
      employeeShare: benefitPlans.employeeShare,
      employerShare: benefitPlans.employerShare,
    }).from(benefitEnrollments)
      .innerJoin(benefitPlans, eq(benefitEnrollments.planId, benefitPlans.id))
      .where(and(
        eq(benefitEnrollments.organizationId, organizationId),
        eq(benefitEnrollments.employeeId, employeeId),
      )),
    db.select({
      id: assets.id,
      type: assets.type,
      name: assets.name,
      serialNumber: assets.serialNumber,
      status: assets.status,
      assignedOn: assets.assignedOn,
      returnedOn: assets.returnedOn,
    }).from(assets).where(and(
      eq(assets.organizationId, organizationId),
      eq(assets.employeeId, employeeId),
    )).orderBy(desc(assets.id)),
    db.select().from(provisioningTasks).where(and(
      eq(provisioningTasks.organizationId, organizationId),
      eq(provisioningTasks.employeeId, employeeId),
    )).orderBy(desc(provisioningTasks.id)),
    db.select().from(automationExecutions).where(and(
      eq(automationExecutions.organizationId, organizationId),
      eq(automationExecutions.employeeId, employeeId),
    )).orderBy(desc(automationExecutions.id)).limit(12),
    db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      active: users.active,
      localPasswordEnabled: users.localPasswordEnabled,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.employeeId, employeeId)),
    db.select({
      id: separationRecords.id,
      separationType: separationRecords.separationType,
      noticeDate: separationRecords.noticeDate,
      lastDay: separationRecords.lastDay,
      clearanceStatus: separationRecords.clearanceStatus,
      status: separationRecords.status,
      coeIssued: separationRecords.coeIssued,
      createdAt: separationRecords.createdAt,
    }).from(separationRecords).where(and(
      eq(separationRecords.organizationId, organizationId),
      eq(separationRecords.employeeId, employeeId),
    )).orderBy(desc(separationRecords.id)).limit(1),
    db.select({
      assignmentId: hcmPolicyAssignments.id,
      status: hcmPolicyAssignments.status,
      dueAt: hcmPolicyAssignments.dueAt,
      acknowledgedAt: hcmPolicyAssignments.acknowledgedAt,
      policyId: hcmPolicyVersions.id,
      policyCode: hcmPolicyVersions.policyCode,
      title: hcmPolicyVersions.title,
      version: hcmPolicyVersions.version,
    }).from(hcmPolicyAssignments)
      .innerJoin(hcmPolicyVersions, eq(hcmPolicyAssignments.policyId, hcmPolicyVersions.id))
      .where(and(
        eq(hcmPolicyAssignments.organizationId, organizationId),
        eq(hcmPolicyAssignments.employeeId, employeeId),
        eq(hcmPolicyVersions.status, "published"),
      ))
      .orderBy(desc(hcmPolicyAssignments.id)),
    db.select({
      complianceId: hcmEmployeeDocumentCompliance.id,
      status: hcmEmployeeDocumentCompliance.status,
      dueAt: hcmEmployeeDocumentCompliance.dueAt,
      expiresAt: hcmEmployeeDocumentCompliance.expiresAt,
      documentId: hcmEmployeeDocumentCompliance.documentId,
      requirementId: hcmDocumentRequirements.id,
      code: hcmDocumentRequirements.code,
      name: hcmDocumentRequirements.name,
      kind: hcmDocumentRequirements.kind,
    }).from(hcmEmployeeDocumentCompliance)
      .innerJoin(hcmDocumentRequirements, eq(hcmEmployeeDocumentCompliance.requirementId, hcmDocumentRequirements.id))
      .where(and(
        eq(hcmEmployeeDocumentCompliance.organizationId, organizationId),
        eq(hcmEmployeeDocumentCompliance.employeeId, employeeId),
        eq(hcmDocumentRequirements.active, true),
      ))
      .orderBy(desc(hcmEmployeeDocumentCompliance.id)),
    db.select({
      id: hcmEmployeeSkills.id,
      skillId: hcmEmployeeSkills.skillId,
      skillName: hcmSkills.name,
      skillCode: hcmSkills.code,
      category: hcmSkills.category,
      proficiency: hcmEmployeeSkills.proficiency,
      status: hcmEmployeeSkills.status,
      effectiveFrom: hcmEmployeeSkills.effectiveFrom,
      effectiveUntil: hcmEmployeeSkills.effectiveUntil,
      verifiedAt: hcmEmployeeSkills.verifiedAt,
      verifiedByName: hcmEmployeeSkills.verifiedByName,
      notes: hcmEmployeeSkills.notes,
    }).from(hcmEmployeeSkills)
      .innerJoin(hcmSkills, eq(hcmEmployeeSkills.skillId, hcmSkills.id))
      .where(and(
        eq(hcmEmployeeSkills.organizationId, organizationId),
        eq(hcmEmployeeSkills.employeeId, employeeId),
        eq(hcmSkills.active, true),
      ))
      .orderBy(asc(hcmSkills.category), asc(hcmSkills.name), desc(hcmEmployeeSkills.effectiveFrom)),
    db.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.organizationId, organizationId),
      eq(hcmEmploymentTerms.employeeId, employeeId),
    )).orderBy(desc(hcmEmploymentTerms.effectiveFrom), desc(hcmEmploymentTerms.id)),
    db.select().from(hcmEmploymentTermDecisions).where(and(
      eq(hcmEmploymentTermDecisions.organizationId, organizationId),
      eq(hcmEmploymentTermDecisions.employeeId, employeeId),
    )).orderBy(desc(hcmEmploymentTermDecisions.createdAt), desc(hcmEmploymentTermDecisions.id)),
  ]);

  const assignment = assignmentRows[0] ?? null;
  let position: null | {
    id: number;
    code: string;
    status: string;
    annualBudget: string;
    employmentType: string;
    orgUnitId: number | null;
    supervisoryOrgUnitId: number | null;
    legalEntityId: number | null;
    costCenterId: number | null;
    managerEmployeeId: number | null;
    jobProfileId: number;
    profile: null | {
      id: number;
      title: string;
      family: string;
      level: string;
      grade: string | null;
    };
    orgUnit: null | { id: number; name: string; code: string; type: string };
    supervisoryOrg: null | { id: number; name: string; code: string; type: string };
    legalEntity: null | { id: number; code: string; displayName: string; legalName: string };
    costCenter: null | { id: number; code: string; name: string };
    manager: null | { id: number; employeeNo: string; firstName: string; lastName: string; title: string };
    assignmentType: string;
    fte: string;
    effectiveFrom: string;
  } = null;

  if (assignment) {
    const [positionRow] = await db.select().from(positions).where(and(
      eq(positions.id, assignment.positionId),
      eq(positions.organizationId, organizationId),
    )).limit(1);

    if (positionRow) {
      const [profileRows, unitRows, supervisoryRows, legalEntityRows, costCenterRows, managerRows] = await Promise.all([
        db.select({
          id: jobProfiles.id,
          title: jobProfiles.title,
          family: jobProfiles.family,
          level: jobProfiles.level,
          grade: jobProfiles.grade,
        }).from(jobProfiles).where(and(
          eq(jobProfiles.id, positionRow.jobProfileId),
          eq(jobProfiles.organizationId, organizationId),
        )).limit(1),
        positionRow.orgUnitId
          ? db.select({
              id: orgUnits.id,
              name: orgUnits.name,
              code: orgUnits.code,
              type: orgUnits.type,
            }).from(orgUnits).where(and(
              eq(orgUnits.id, positionRow.orgUnitId),
              eq(orgUnits.organizationId, organizationId),
            )).limit(1)
          : Promise.resolve([]),
        positionRow.supervisoryOrgUnitId
          ? db.select({
              id: orgUnits.id,
              name: orgUnits.name,
              code: orgUnits.code,
              type: orgUnits.type,
            }).from(orgUnits).where(and(
              eq(orgUnits.id, positionRow.supervisoryOrgUnitId),
              eq(orgUnits.organizationId, organizationId),
            )).limit(1)
          : Promise.resolve([]),
        positionRow.legalEntityId
          ? db.select({
              id: legalEntities.id,
              code: legalEntities.code,
              displayName: legalEntities.displayName,
              legalName: legalEntities.legalName,
            }).from(legalEntities).where(and(
              eq(legalEntities.id, positionRow.legalEntityId),
              eq(legalEntities.organizationId, organizationId),
            )).limit(1)
          : Promise.resolve([]),
        positionRow.costCenterId
          ? db.select({
              id: costCenters.id,
              code: costCenters.code,
              name: costCenters.name,
            }).from(costCenters).where(and(
              eq(costCenters.id, positionRow.costCenterId),
              eq(costCenters.organizationId, organizationId),
            )).limit(1)
          : Promise.resolve([]),
        positionRow.managerEmployeeId
          ? db.select({
              id: employees.id,
              employeeNo: employees.employeeNo,
              firstName: employees.firstName,
              lastName: employees.lastName,
              title: employees.title,
            }).from(employees).where(and(
              eq(employees.id, positionRow.managerEmployeeId),
              eq(employees.organizationId, organizationId),
            )).limit(1)
          : Promise.resolve([]),
      ]);

      position = {
        id: positionRow.id,
        code: positionRow.code,
        status: positionRow.status,
        annualBudget: positionRow.annualBudget,
        employmentType: positionRow.employmentType,
        orgUnitId: positionRow.orgUnitId,
        supervisoryOrgUnitId: positionRow.supervisoryOrgUnitId,
        legalEntityId: positionRow.legalEntityId,
        costCenterId: positionRow.costCenterId,
        managerEmployeeId: positionRow.managerEmployeeId,
        jobProfileId: positionRow.jobProfileId,
        profile: profileRows[0] ?? null,
        orgUnit: unitRows[0] ?? null,
        supervisoryOrg: supervisoryRows[0] ?? null,
        legalEntity: legalEntityRows[0] ?? null,
        costCenter: costCenterRows[0] ?? null,
        manager: managerRows[0] ?? null,
        assignmentType: assignment.assignmentType,
        fte: assignment.fte,
        effectiveFrom: String(assignment.effectiveFrom),
      };
    }
  }

  const positionHistory = await Promise.all(assignmentHistoryRows.map(async (row) => {
    const [positionRow] = await db.select().from(positions).where(and(
      eq(positions.id, row.positionId),
      eq(positions.organizationId, organizationId),
    )).limit(1);
    if (!positionRow) {
      return {
        ...row,
        position: null,
      };
    }

    const [profileRows, unitRows, supervisoryRows, entityRows, costCenterRows, managerRows] = await Promise.all([
      db.select({
        id: jobProfiles.id,
        title: jobProfiles.title,
        family: jobProfiles.family,
        level: jobProfiles.level,
        grade: jobProfiles.grade,
      }).from(jobProfiles).where(and(
        eq(jobProfiles.id, positionRow.jobProfileId),
        eq(jobProfiles.organizationId, organizationId),
      )).limit(1),
      positionRow.orgUnitId
        ? db.select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code, type: orgUnits.type })
            .from(orgUnits).where(and(
              eq(orgUnits.id, positionRow.orgUnitId),
              eq(orgUnits.organizationId, organizationId),
            )).limit(1)
        : Promise.resolve([]),
      positionRow.supervisoryOrgUnitId
        ? db.select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code, type: orgUnits.type })
            .from(orgUnits).where(and(
              eq(orgUnits.id, positionRow.supervisoryOrgUnitId),
              eq(orgUnits.organizationId, organizationId),
            )).limit(1)
        : Promise.resolve([]),
      positionRow.legalEntityId
        ? db.select({ id: legalEntities.id, code: legalEntities.code, displayName: legalEntities.displayName })
            .from(legalEntities).where(and(
              eq(legalEntities.id, positionRow.legalEntityId),
              eq(legalEntities.organizationId, organizationId),
            )).limit(1)
        : Promise.resolve([]),
      positionRow.costCenterId
        ? db.select({ id: costCenters.id, code: costCenters.code, name: costCenters.name })
            .from(costCenters).where(and(
              eq(costCenters.id, positionRow.costCenterId),
              eq(costCenters.organizationId, organizationId),
            )).limit(1)
        : Promise.resolve([]),
      positionRow.managerEmployeeId
        ? db.select({
            id: employees.id,
            employeeNo: employees.employeeNo,
            firstName: employees.firstName,
            lastName: employees.lastName,
            title: employees.title,
          }).from(employees).where(and(
            eq(employees.id, positionRow.managerEmployeeId),
            eq(employees.organizationId, organizationId),
          )).limit(1)
        : Promise.resolve([]),
    ]);

    return {
      ...row,
      position: {
        id: positionRow.id,
        code: positionRow.code,
        status: positionRow.status,
        employmentType: positionRow.employmentType,
        profile: profileRows[0] ?? null,
        orgUnit: unitRows[0] ?? null,
        supervisoryOrg: supervisoryRows[0] ?? null,
        legalEntity: entityRows[0] ?? null,
        costCenter: costCenterRows[0] ?? null,
        manager: managerRows[0] ?? null,
      },
    };
  }));

  const ruleIds = [...new Set(executionRows.map((row) => row.ruleId))];
  const ruleRows = ruleIds.length
    ? await db.select({
        id: automationRules.id,
        name: automationRules.name,
        trigger: automationRules.trigger,
      }).from(automationRules).where(and(
        eq(automationRules.organizationId, organizationId),
        inArray(automationRules.id, ruleIds),
      ))
    : [];
  const ruleById = new Map(ruleRows.map((row) => [row.id, row]));

  const identities = await Promise.all(linkedUsers.map(async (linkedUser) => {
    const [membershipRows, scimRows, externalRows] = await Promise.all([
      db.select().from(userOrganizations).where(and(
        eq(userOrganizations.userId, linkedUser.id),
        eq(userOrganizations.organizationId, organizationId),
      )).limit(1),
      db.select({
        id: scimIdentities.id,
        externalId: scimIdentities.externalId,
        active: scimIdentities.active,
        lastSyncedAt: scimIdentities.lastSyncedAt,
      }).from(scimIdentities).where(and(
        eq(scimIdentities.userId, linkedUser.id),
        eq(scimIdentities.organizationId, organizationId),
      )).limit(1),
      db.select({
        id: externalIdentities.id,
        email: externalIdentities.email,
        lastLoginAt: externalIdentities.lastLoginAt,
      }).from(externalIdentities).where(and(
        eq(externalIdentities.userId, linkedUser.id),
        eq(externalIdentities.organizationId, organizationId),
      )),
    ]);
    const membership = membershipRows[0] ?? null;
    let permissionSet: null | { id: number; name: string } = null;
    if (membership) {
      const [assignmentRows] = await Promise.all([
        db.select({
          permissionSetId: userPermissionAssignments.permissionSetId,
        }).from(userPermissionAssignments).where(and(
          eq(userPermissionAssignments.organizationId, organizationId),
          eq(userPermissionAssignments.userOrganizationId, membership.id),
        )).limit(1),
      ]);
      const permissionAssignment = assignmentRows[0] ?? null;
      if (permissionAssignment) {
        const [set] = await db.select({
          id: permissionSets.id,
          name: permissionSets.name,
        }).from(permissionSets).where(and(
          eq(permissionSets.id, permissionAssignment.permissionSetId),
          eq(permissionSets.organizationId, organizationId),
        )).limit(1);
        permissionSet = set ?? null;
      }
    }

    return {
      user: linkedUser,
      membership: membership ? {
        id: membership.id,
        role: membership.role,
        orgUnitId: membership.orgUnitId,
        active: membership.active,
      } : null,
      permissionSet,
      scim: scimRows[0] ?? null,
      externalIdentities: externalRows,
    };
  }));

  const [
    effectiveChangeRows,
    optionPositions,
    optionAssignments,
    optionUnits,
    optionEntities,
    optionCenters,
    optionManagers,
    optionProfiles,
  ] = await Promise.all([
    db.select().from(workerEffectiveChanges).where(and(
      eq(workerEffectiveChanges.organizationId, organizationId),
      eq(workerEffectiveChanges.employeeId, employeeId),
    )).orderBy(desc(workerEffectiveChanges.effectiveDate), desc(workerEffectiveChanges.id)),
    access.companyWide
      ? db.select().from(positions).where(eq(positions.organizationId, organizationId)).orderBy(positions.code)
      : Promise.resolve([]),
    access.companyWide
      ? db.select({ positionId: positionAssignments.positionId }).from(positionAssignments).where(and(
          eq(positionAssignments.organizationId, organizationId),
          isNull(positionAssignments.effectiveUntil),
        ))
      : Promise.resolve([]),
    access.companyWide
      ? db.select().from(orgUnits).where(and(
          eq(orgUnits.organizationId, organizationId),
          eq(orgUnits.active, true),
        )).orderBy(orgUnits.name)
      : Promise.resolve([]),
    access.companyWide
      ? db.select().from(legalEntities).where(and(
          eq(legalEntities.organizationId, organizationId),
          eq(legalEntities.active, true),
        )).orderBy(legalEntities.displayName)
      : Promise.resolve([]),
    access.companyWide
      ? db.select().from(costCenters).where(and(
          eq(costCenters.organizationId, organizationId),
          eq(costCenters.active, true),
        )).orderBy(costCenters.name)
      : Promise.resolve([]),
    access.companyWide
      ? db.select({
          id: employees.id,
          employeeNo: employees.employeeNo,
          firstName: employees.firstName,
          lastName: employees.lastName,
          title: employees.title,
        }).from(employees).where(and(
          eq(employees.organizationId, organizationId),
          eq(employees.status, "Active"),
        )).orderBy(employees.lastName, employees.firstName)
      : Promise.resolve([]),
    access.companyWide
      ? db.select({
          id: jobProfiles.id,
          title: jobProfiles.title,
          family: jobProfiles.family,
          level: jobProfiles.level,
          grade: jobProfiles.grade,
        }).from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId))
      : Promise.resolve([]),
  ]);

  const occupiedPositionIds = new Set(optionAssignments.map((row) => row.positionId));
  const optionProfileById = new Map(optionProfiles.map((row) => [row.id, row]));
  const availablePositions = optionPositions
    .filter((row) => row.status === "approved" && !occupiedPositionIds.has(row.id))
    .map((row) => ({
      ...row,
      profile: optionProfileById.get(row.jobProfileId) ?? null,
    }));

  const capabilityJobProfileId = position?.jobProfileId ?? null;
  const [jobSkillRequirementRows, jobCredentialRequirementRows] = capabilityJobProfileId
    ? await Promise.all([
        db.select({
          id: hcmJobProfileSkillRequirements.id,
          skillId: hcmJobProfileSkillRequirements.skillId,
          skillName: hcmSkills.name,
          skillCode: hcmSkills.code,
          category: hcmSkills.category,
          minimumProficiency: hcmJobProfileSkillRequirements.minimumProficiency,
          mandatory: hcmJobProfileSkillRequirements.mandatory,
        }).from(hcmJobProfileSkillRequirements)
          .innerJoin(hcmSkills, eq(hcmJobProfileSkillRequirements.skillId, hcmSkills.id))
          .where(and(
            eq(hcmJobProfileSkillRequirements.organizationId, organizationId),
            eq(hcmJobProfileSkillRequirements.jobProfileId, capabilityJobProfileId),
            eq(hcmSkills.active, true),
          ))
          .orderBy(asc(hcmSkills.category), asc(hcmSkills.name)),
        db.select({
          id: hcmJobProfileCredentialRequirements.id,
          documentRequirementId: hcmJobProfileCredentialRequirements.documentRequirementId,
          name: hcmDocumentRequirements.name,
          code: hcmDocumentRequirements.code,
          kind: hcmDocumentRequirements.kind,
          mandatory: hcmJobProfileCredentialRequirements.mandatory,
          blocksWorkforceEligibility: hcmJobProfileCredentialRequirements.blocksWorkforceEligibility,
        }).from(hcmJobProfileCredentialRequirements)
          .innerJoin(
            hcmDocumentRequirements,
            eq(hcmJobProfileCredentialRequirements.documentRequirementId, hcmDocumentRequirements.id),
          )
          .where(and(
            eq(hcmJobProfileCredentialRequirements.organizationId, organizationId),
            eq(hcmJobProfileCredentialRequirements.jobProfileId, capabilityJobProfileId),
            eq(hcmDocumentRequirements.active, true),
          ))
          .orderBy(asc(hcmDocumentRequirements.name)),
      ])
    : [[], []];

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const workforceEligibility = capabilityJobProfileId
    ? await loadEmployeeWfmEligibility({
        organizationId,
        employeeId,
        jobProfileId: capabilityJobProfileId,
        workDate: today,
      })
    : null;

  const [workArrangementRows, worksiteAssignmentRows, worksiteAuthorizationRows, worksiteRows] = await Promise.all([
    db.select().from(hcmWorkArrangements).where(and(
      eq(hcmWorkArrangements.organizationId, organizationId),
      eq(hcmWorkArrangements.employeeId, employeeId),
    )).orderBy(desc(hcmWorkArrangements.effectiveFrom), desc(hcmWorkArrangements.id)),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      eq(employeeWorksiteAssignments.employeeId, employeeId),
    )).orderBy(desc(employeeWorksiteAssignments.effectiveFrom), desc(employeeWorksiteAssignments.id)),
    db.select().from(hcmWorksiteAuthorizations).where(and(
      eq(hcmWorksiteAuthorizations.organizationId, organizationId),
      eq(hcmWorksiteAuthorizations.employeeId, employeeId),
    )).orderBy(desc(hcmWorksiteAuthorizations.effectiveFrom), desc(hcmWorksiteAuthorizations.id)),
    db.select().from(worksites).where(eq(worksites.organizationId, organizationId)).orderBy(asc(worksites.name)),
  ]);
  const currentWorkArrangement = workArrangementRows.find((row) =>
    String(row.effectiveFrom) <= today
    && (row.effectiveUntil == null || String(row.effectiveUntil) >= today)
  ) ?? null;
  const effectivePrimaryAssignment = selectEffectiveWorksiteAssignment(
    worksiteAssignmentRows.map((row) => ({
      id: row.id,
      worksiteId: row.worksiteId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })),
    today,
  );
  const worksiteById = new Map(worksiteRows.map((row) => [row.id, row]));
  const primaryWorksite = effectivePrimaryAssignment
    ? {
        ...effectivePrimaryAssignment,
        worksite: worksiteById.get(effectivePrimaryAssignment.worksiteId) ?? null,
      }
    : null;
  const currentPrimaryEligibility = primaryWorksite
    ? await employeeSiteEligibility({
        organizationId,
        employeeId,
        date: today,
        worksiteId: primaryWorksite.worksiteId,
      })
    : null;

  const activeBenefits = benefitRows.filter((row) => row.status === "active" && !row.endedOn);
  const assignedAssets = assetRows.filter((row) => row.status === "assigned" && !row.returnedOn);
  const openTasks = taskRows.filter((row) => !row.done);
  const latestSeparation = separationRows[0] ?? null;
  const pendingPolicyAcknowledgements = policyRows.filter((row) => row.status === "assigned");
  const documentRisks = documentComplianceRows.filter((row) =>
    ["missing", "submitted", "expiring", "expired"].includes(row.status),
  );
  const activeEmploymentTerm = employmentTermRows.find((row) => row.status === "active") ?? null;
  const employmentTermLifecycleState = activeEmploymentTerm
    ? employmentTermLifecycle({
        termKind: activeEmploymentTerm.termKind,
        probationReviewDate: activeEmploymentTerm.probationReviewDate ? String(activeEmploymentTerm.probationReviewDate) : null,
        contractEndDate: activeEmploymentTerm.contractEndDate ? String(activeEmploymentTerm.contractEndDate) : null,
        effectiveUntil: activeEmploymentTerm.effectiveUntil ? String(activeEmploymentTerm.effectiveUntil) : null,
      }, today)
    : null;


  // The connected journey is a read-only join across governed source modules.
  // Employee and organization membership are validated above. Every source
  // query remains tenant-bound; unauthorized financial rows are not fetched.
  const compensationVisible = access.companyWide;
  const payrollVisible = roleAllowed(access.role, PAYROLL_VIEW_ROLES)
    && (await roleGateAllowed(user.id, organizationId, "payroll.view")).allowed;
  const [
    linkedApplicantRows,
    latestReviewRows,
    latestCompensationRows,
    releasedPayrollRows,
  ] = await Promise.all([
    db.select({
      applicantId: jobApplicants.id,
      stage: jobApplicants.stage,
      requisitionId: jobRequisitions.id,
      requisitionPositionId: jobRequisitions.positionId,
    }).from(jobApplicants)
      .innerJoin(jobRequisitions, and(
        eq(jobApplicants.requisitionId, jobRequisitions.id),
        eq(jobRequisitions.organizationId, organizationId),
      ))
      .where(and(
        eq(jobApplicants.organizationId, organizationId),
        eq(jobApplicants.hiredEmployeeId, employeeId),
      ))
      .orderBy(desc(jobApplicants.id)).limit(1),
    db.select({
      id: performanceReviews.id,
      status: performanceReviews.status,
    }).from(performanceReviews).where(and(
      eq(performanceReviews.organizationId, organizationId),
      eq(performanceReviews.employeeId, employeeId),
    )).orderBy(desc(performanceReviews.createdAt), desc(performanceReviews.id)).limit(1),
    compensationVisible
      ? db.select({
          id: compensationProposals.id,
          status: compensationProposals.status,
        }).from(compensationProposals).where(and(
          eq(compensationProposals.organizationId, organizationId),
          eq(compensationProposals.employeeId, employeeId),
        )).orderBy(desc(compensationProposals.createdAt), desc(compensationProposals.id)).limit(1)
      : Promise.resolve([]),
    payrollVisible
      ? db.select({
          runId: payrollRuns.id,
          periodEnd: payrollRuns.periodEnd,
        }).from(payrollEntries)
          .innerJoin(payrollRuns, and(
            eq(payrollEntries.payrollRunId, payrollRuns.id),
            eq(payrollRuns.organizationId, organizationId),
          ))
          .where(and(
            eq(payrollEntries.employeeId, employeeId),
            eq(payrollRuns.organizationId, organizationId),
            eq(payrollRuns.status, "Released"),
          ))
          .orderBy(desc(payrollRuns.periodEnd), desc(payrollRuns.id)).limit(1)
      : Promise.resolve([]),
  ]);
  const journey = buildHcmWorkerJourney({
    employeeStatus: employee.status,
    asOfDate: today,
    recruitment: linkedApplicantRows[0] ?? null,
    currentPositionId: position?.id ?? null,
    currentPositionEffectiveFrom: position?.effectiveFrom ?? null,
    lastPositionAssignmentId: assignmentHistoryRows.find((row) => String(row.effectiveFrom) <= today)?.id ?? null,
    onboarding: taskRows.filter((row) => row.kind === "onboarding"),
    offboarding: taskRows.filter((row) => row.kind === "offboarding"),
    latestPerformance: latestReviewRows[0] ?? null,
    compensationVisible,
    latestCompensation: latestCompensationRows[0] ?? null,
    payrollVisible,
    lastReleasedPayroll: releasedPayrollRows[0]
      ? {
          runId: releasedPayrollRows[0].runId,
          periodEnd: String(releasedPayrollRows[0].periodEnd),
        }
      : null,
    separation: latestSeparation
      ? { id: latestSeparation.id, status: latestSeparation.status }
      : null,
    outstandingAssets: assignedAssets.length,
  });

  return Response.json({
    employee,
    position,
    journey,
    benefits: benefitRows,
    assets: assetRows,
    lifecycle: {
      tasks: taskRows,
      automations: executionRows.map((row) => ({
        ...row,
        ruleName: ruleById.get(row.ruleId)?.name ?? `Rule #${row.ruleId}`,
      })),
      separation: latestSeparation,
    },
    identities,
    documents: {
      policies: policyRows,
      requirements: documentComplianceRows,
    },
    capabilities: {
      skills: employeeSkillRows,
      jobSkillRequirements: jobSkillRequirementRows,
      jobCredentialRequirements: jobCredentialRequirementRows,
      workforceEligibility,
    },
    worksiteGovernance: {
      arrangement: currentWorkArrangement,
      primaryWorksite,
      authorizations: worksiteAuthorizationRows.map((row) => ({
        ...row,
        worksite: worksiteById.get(row.worksiteId) ?? null,
      })),
      currentEligibilitySummary: currentPrimaryEligibility,
    },
    effectiveChanges: effectiveChangeRows,
    employmentTerms: {
      history: employmentTermRows,
      active: activeEmploymentTerm,
      lifecycle: employmentTermLifecycleState,
    },
    employmentTermDecisions: employmentTermDecisionRows,
    changeOptions: {
      canManage: access.companyWide,
      positions: availablePositions,
      orgUnits: optionUnits,
      legalEntities: optionEntities,
      costCenters: optionCenters,
      managers: optionManagers.filter((row) => row.id !== employeeId),
      employmentTypes: ["Regular", "Probationary", "Part-time", "Contractual"],
      employeeStatuses: ["Active", "On leave"],
    },
    history: {
      employmentEvents: employmentEventRows,
      positionAssignments: positionHistory,
    },
    summary: {
      authoritativePosition: Boolean(position),
      linkedLogin: identities.length > 0,
      scimManaged: identities.some((identity) => Boolean(identity.scim?.active)),
      activeBenefits: activeBenefits.length,
      assignedAssets: assignedAssets.length,
      openLifecycleTasks: openTasks.length,
      pendingPolicyAcknowledgements: pendingPolicyAcknowledgements.length,
      documentComplianceRisks: documentRisks.length,
      verifiedSkills: employeeSkillRows.filter((row) => row.status === "verified").length,
      workforceEligible: workforceEligibility?.eligible ?? null,
      workforceEligibilityBlockers: workforceEligibility?.blockers.length ?? 0,
      separationOpen: Boolean(latestSeparation && latestSeparation.status !== "released"),
      pendingEffectiveChanges: effectiveChangeRows.filter((row) => ["pending_approval", "scheduled", "failed"].includes(row.status)).length,
      employmentTermsOpen: employmentTermRows.filter((row) => ["pending_approval", "scheduled", "failed"].includes(row.status)).length,
      employmentTermsLifecycleState: employmentTermLifecycleState?.state ?? null,
      employmentTermDecisionsOpen: employmentTermDecisionRows.filter((row) =>
        ["pending_approval", "scheduled", "failed"].includes(row.status),
      ).length,
      separationHandoffReady: employmentTermDecisionRows.some((row) =>
        row.decisionKind === "non_renew"
        && row.status === "applied"
        && row.separationHandoffStatus === "ready",
      ),
      separationHandoffStarted: employmentTermDecisionRows.some((row) =>
        row.decisionKind === "non_renew"
        && row.status === "applied"
        && row.separationHandoffStatus === "started"
        && row.separationRecordId != null,
      ),
      separationHandoffCompleted: employmentTermDecisionRows.some((row) =>
        row.decisionKind === "non_renew"
        && row.status === "applied"
        && row.separationHandoffStatus === "completed"
        && row.separationRecordId != null,
      ),
    },
  });
}
