import { sql as entityStorageSql } from "drizzle-orm";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { loadTenantModulePreferences, type TenantModulePreferences } from "./tenant-modules";
import { organizationModuleSettings, tenantModuleStorageAvailable } from "@/lib/tenant-module-storage";
import { maskBankAccount } from "@/lib/bank-account-crypto";
import { maskGovernmentId } from "@/lib/government-id-crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalDelegations,
  approvalTasks,
  auditEvents,
  bankTemplates,
  calamityAdvisories,
  complianceActionTasks,
  employeePayProfiles,
  employeePayRevisions,
  employeeRestDayRevisions,
  employeePayRetroAdjustments,
  employees,
  freelancerProfiles,
  leavePolicies,
  leaveRequestIntervals,
  leaveRequestIntervalSets,
  leaveRequests,
  minWageOrders,
  organizations,
  orgUnits,
  payrollEntries,
  payrollJobs,
  payrollRuns,
  pricingPlans,
  provisioningTasks,
  separationRecords,
  timePunches,
  userOrganizations,
} from "@/db/schema";
import { ensureSeedData } from "@/db/seed";
import { getAccess, PAYROLL_CHECKER_ROLES, PAYROLL_OPERATOR_ROLES, PAYROLL_VIEW_ROLES, PEOPLE_PAYROLL_ROLES, roleAllowed } from "@/lib/access";
import { roleApproverMatchesRole } from "@/lib/delegation";
import { getSessionUser, publicUser } from "@/lib/auth";
import { getEntitlements } from "@/lib/billing";
import { resolveAdvancedHcmPlan } from "@/lib/enterprise-advanced-plan-policy";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";
import { buildFirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import { canReadFirstPayrollProgress } from "@/lib/first-payroll-progress";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";
import { resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { employeeScopePredicate } from "@/lib/multi-entity-personnel-scope";

export async function getDashboardData(organizationId?: number, request?: Request) {
  await ensureCoreCompatibilitySchema();
  await ensureSeedData();
  await ensureLeavePayrollSchema();
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new Error("Authentication required to load workspace data.");
  }

  const memberships = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(and(
      eq(userOrganizations.userId, sessionUser.id),
      eq(userOrganizations.active, true),
      ne(userOrganizations.role, "employee"),
    ))
    .orderBy(asc(userOrganizations.organizationId));

  const organizationIds = memberships.map((membership) => membership.organizationId);
  if (organizationIds.length === 0) {
    throw new Error("This account is not a member of any workspace.");
  }

  const storedOrganizations = await db
    .select()
    .from(organizations)
    .where(inArray(organizations.id, organizationIds))
    .orderBy(asc(organizations.id));
  const orgs = storedOrganizations;

  // The optional 0122 columns are not part of the shared Drizzle organization model.
  // Never select them on a flag-off / pre-migration database; existing workspaces
  // must continue to function before the controlled DBA migration.
  const coreModuleNavigationEnabled = criticalReleaseFlagEnabled("coreModuleNavigation")
    && await tenantModuleStorageAvailable();
  const modulePreferenceById: Map<number, TenantModulePreferences> = coreModuleNavigationEnabled
    ? await loadTenantModulePreferences(organizationIds, () => db.select({
        id: organizationModuleSettings.id,
        mode: organizationModuleSettings.moduleNavigationMode,
        enabledModules: organizationModuleSettings.enabledModules,
      }).from(organizationModuleSettings)
        .where(inArray(organizationModuleSettings.id, organizationIds)))
    : new Map();
  const decorateOrganization = (org: (typeof orgs)[number]) => {
    const prefs = modulePreferenceById.get(org.id);
    return {
      ...org,
      moduleNavigationMode: coreModuleNavigationEnabled ? prefs?.mode ?? "all" : "all",
      enabledModules: coreModuleNavigationEnabled && Array.isArray(prefs?.enabledModules)
        ? prefs.enabledModules.filter((id): id is string => typeof id === "string")
        : [],
    };
  };

  const selectedOrganization = organizationId
    ? orgs.find((organization) => organization.id === organizationId)
    : orgs[0];

  if (!selectedOrganization) {
    throw new Error("The requested workspace is not available to this account.");
  }

  const policyDenied = await assertOrganizationSessionPolicy(sessionUser.id, selectedOrganization.id);
  if (policyDenied) {
    throw new Error("This workspace requires single sign-on.");
  }

  const access = await getAccess(sessionUser.id, selectedOrganization.id);
  if (!access) {
    throw new Error("The requested workspace is not available to this account.");
  }
  // A manager without a concrete supervisory unit must not silently receive
  // company-wide staff, leave, attendance or other dashboard records.
  if (access.role === "manager" && deriveMyTeamScope(access)?.kind !== "unit") {
    throw new Error("An assigned supervisory unit is required to load the manager workspace.");
  }

  const entityAccess = await resolveMultiEntityContext({
    userId: sessionUser.id, organizationId: selectedOrganization.id, request,
  });
  if (!entityAccess.ok) throw new Error("This legal employer is not available to your account.");
  const entityContext = entityAccess.context;
  const selectedEntityId = entityContext.enabled ? entityContext.legalEntityId : null;
  const allEmployeesVisible = access.companyWide && selectedEntityId === null;
  await ensureEmployeePayProfiles(selectedOrganization.id);

  // After verified session, employer and scope: a navigation hint only.
  // Each direct premium API retains its own authoritative gate.
  const advancedPlanningDecision = await resolveAdvancedHcmPlan(
    selectedOrganization.id, "planning", process.env, getEntitlements,
  );
  const advancedPlanningAllowed = advancedPlanningDecision === "not-enforced"
    || advancedPlanningDecision === "allowed";

  const canViewPayroll = roleAllowed(access.role, PAYROLL_VIEW_ROLES);
  const canViewPeoplePay = roleAllowed(access.role, PEOPLE_PAYROLL_ROLES);
  const canViewAudit = allEmployeesVisible && ["owner", "admin", "bookkeeper", "payroll", "checker"].includes(access.role);
  const canViewDelegations = roleAllowed(access.role, PAYROLL_CHECKER_ROLES);
  const canViewComplianceActions = allEmployeesVisible && roleAllowed(access.role, PAYROLL_OPERATOR_ROLES);

  const employeeFilter = employeeScopePredicate({
    organizationId: selectedOrganization.id,
    legalEntityId: selectedEntityId,
    orgUnitId: !access.companyWide && access.orgUnitId ? access.orgUnitId : null,
  });
  // Resolve the personnel boundary inside each SQL read, not after fetching
  // other employers' confidential time, leave or compensation evidence.
  // Group HR's All view intentionally includes all current-tenant entities.
  const restrictedEmployeeIds = db.select({ id: employees.id })
    .from(employees).where(employeeFilter);
  const restrictEntityEmployeeRows = entityContext.enabled && selectedEntityId !== null;

  const [employeeRows, payProfileRows, payRevisionRowsRaw, restDayRevisionRowsRaw, retroRowsRaw, runRows, taskRowsRaw, auditRows, plans, templates, advisories, freelancer, punchRowsRaw, delegationRows, leaveRowsRaw, leavePolicyRows, units, wages, provisionRowsRaw, separationRowsRaw] = await Promise.all([
    db.select().from(employees).where(employeeFilter).orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles).where(and(
      eq(employeePayProfiles.organizationId, selectedOrganization.id),
      restrictEntityEmployeeRows ? inArray(employeePayProfiles.employeeId, restrictedEmployeeIds) : undefined,
    )),
    canViewPeoplePay
      ? db.select().from(employeePayRevisions).where(and(
          eq(employeePayRevisions.organizationId, selectedOrganization.id),
          restrictEntityEmployeeRows ? inArray(employeePayRevisions.employeeId, restrictedEmployeeIds) : undefined,
        )).orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
      : Promise.resolve([]),
    canViewPeoplePay
      ? db.select().from(employeeRestDayRevisions).where(and(
          eq(employeeRestDayRevisions.organizationId, selectedOrganization.id),
          restrictEntityEmployeeRows ? inArray(employeeRestDayRevisions.employeeId, restrictedEmployeeIds) : undefined,
        )).orderBy(desc(employeeRestDayRevisions.effectiveDate), desc(employeeRestDayRevisions.id))
      : Promise.resolve([]),
    canViewPeoplePay
      ? db.select().from(employeePayRetroAdjustments).where(and(
          eq(employeePayRetroAdjustments.organizationId, selectedOrganization.id),
          restrictEntityEmployeeRows ? inArray(employeePayRetroAdjustments.employeeId, restrictedEmployeeIds) : undefined,
        )).orderBy(desc(employeePayRetroAdjustments.id))
      : Promise.resolve([]),
    canViewPayroll
      ? db.select().from(payrollRuns).where(
          and(
            eq(payrollRuns.organizationId, selectedOrganization.id),
            selectedEntityId === null ? undefined : eq(payrollRuns.legalEntityId, selectedEntityId),
            !access.companyWide ? eq(payrollRuns.scopeOrgUnitId, access.orgUnitId!) : undefined,
          ),
        ).orderBy(desc(payrollRuns.id))
      : Promise.resolve([]),
    (!entityContext.enabled || entityContext.group) && access.role !== "group_hr" &&
      (access.companyWide || ["manager", "checker"].includes(access.role))
      ? db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, selectedOrganization.id)).orderBy(asc(approvalTasks.id))
      : Promise.resolve([]),
    canViewAudit
      ? db.select().from(auditEvents).where(eq(auditEvents.organizationId, selectedOrganization.id)).orderBy(desc(auditEvents.createdAt))
      : Promise.resolve([]),
    db.select().from(pricingPlans).orderBy(asc(pricingPlans.id)),
    canViewPayroll
      ? db.select().from(bankTemplates).where(eq(bankTemplates.active, true)).orderBy(asc(bankTemplates.id))
      : Promise.resolve([]),
    db.select().from(calamityAdvisories).where(eq(calamityAdvisories.organizationId, selectedOrganization.id)),
    db.select().from(freelancerProfiles).where(eq(freelancerProfiles.organizationId, selectedOrganization.id)),
    db.select().from(timePunches).where(and(
      eq(timePunches.organizationId, selectedOrganization.id),
      restrictEntityEmployeeRows ? inArray(timePunches.employeeId, restrictedEmployeeIds) : undefined,
    )).orderBy(desc(timePunches.workDate)),
    canViewDelegations
      ? db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, selectedOrganization.id)).orderBy(desc(approvalDelegations.id))
      : Promise.resolve([]),
    db.select().from(leaveRequests).where(and(
      eq(leaveRequests.organizationId, selectedOrganization.id),
      restrictEntityEmployeeRows ? inArray(leaveRequests.employeeId, restrictedEmployeeIds) : undefined,
    )).orderBy(desc(leaveRequests.id)),
    db.select().from(leavePolicies).where(eq(leavePolicies.organizationId, selectedOrganization.id)).orderBy(asc(leavePolicies.id)),
    db.select().from(orgUnits).where(
      and(
        eq(orgUnits.organizationId, selectedOrganization.id),
        selectedEntityId === null ? undefined : eq(orgUnits.legalEntityId, selectedEntityId),
        !access.companyWide ? eq(orgUnits.id, access.orgUnitId!) : undefined,
      ),
    ),
    db.select().from(minWageOrders),
    db.select().from(provisioningTasks).where(and(
      eq(provisioningTasks.organizationId, selectedOrganization.id),
      restrictEntityEmployeeRows ? inArray(provisioningTasks.employeeId, restrictedEmployeeIds) : undefined,
    )),
    canViewPeoplePay
      ? db.select({
          id: separationRecords.id,
          employeeId: separationRecords.employeeId,
          separationType: separationRecords.separationType,
          noticeDate: separationRecords.noticeDate,
          lastDay: separationRecords.lastDay,
          status: separationRecords.status,
        }).from(separationRecords).where(and(
          eq(separationRecords.organizationId, selectedOrganization.id),
          selectedEntityId === null ? undefined : entityStorageSql`${separationRecords}."legal_entity_id" = ${selectedEntityId}`,
        ))
      : Promise.resolve([]),
  ]);

  const complianceActions = canViewComplianceActions
    ? await db
        .select({
          id: complianceActionTasks.id,
          sourceKey: complianceActionTasks.sourceKey,
          agency: complianceActionTasks.agency,
          applicableMonth: complianceActionTasks.applicableMonth,
          severity: complianceActionTasks.severity,
          title: complianceActionTasks.title,
          detail: complianceActionTasks.detail,
          dueDate: complianceActionTasks.dueDate,
          status: complianceActionTasks.status,
          assignedToUserId: complianceActionTasks.assignedToUserId,
          assignedToName: complianceActionTasks.assignedToName,
          acknowledgedByName: complianceActionTasks.acknowledgedByName,
          acknowledgedAt: complianceActionTasks.acknowledgedAt,
          resolvedAt: complianceActionTasks.resolvedAt,
          updatedAt: complianceActionTasks.updatedAt,
        })
        .from(complianceActionTasks)
        .where(and(
          eq(complianceActionTasks.organizationId, selectedOrganization.id),
          inArray(complianceActionTasks.sourceType, ["statutory_remittance", "employee_contribution_issue"]),
          ne(complianceActionTasks.status, "resolved"),
        ))
        .orderBy(desc(complianceActionTasks.updatedAt))
        .limit(20)
    : [];

  const handoffRunRows = canViewPayroll
    ? runRows
    : access.role === "hr" && access.companyWide
      ? await db
          .select({
            id: payrollRuns.id,
            periodLabel: payrollRuns.periodLabel,
            periodStart: payrollRuns.periodStart,
            periodEnd: payrollRuns.periodEnd,
            scopeLabel: payrollRuns.scopeLabel,
            scopeOrgUnitId: payrollRuns.scopeOrgUnitId,
            status: payrollRuns.status,
            payDate: payrollRuns.payDate,
          })
          .from(payrollRuns)
          .where(and(
            eq(payrollRuns.organizationId, selectedOrganization.id),
            selectedEntityId === null ? undefined : eq(payrollRuns.legalEntityId, selectedEntityId),
          ))
          .orderBy(desc(payrollRuns.id))
          .limit(12)
      : [];
  const handoffRun = canViewPayroll
    ? runRows.find((run) => run.status !== "Released") ?? runRows[0] ?? null
    : handoffRunRows.find((run) => run.status !== "Released") ?? handoffRunRows[0] ?? null;

  const visibleEmployeeIds = new Set(employeeRows.map((employee) => employee.id));
  const punchRows = allEmployeesVisible
    ? punchRowsRaw
    : punchRowsRaw.filter((punch) => visibleEmployeeIds.has(punch.employeeId));
  const leaveRows = allEmployeesVisible
    ? leaveRowsRaw
    : leaveRowsRaw.filter((leave) => visibleEmployeeIds.has(leave.employeeId));
  const currentLeaveIntervalSets = leaveRows.length
    ? await db.select().from(leaveRequestIntervalSets).where(and(
        eq(leaveRequestIntervalSets.organizationId, selectedOrganization.id),
        eq(leaveRequestIntervalSets.status, "current"),
        inArray(leaveRequestIntervalSets.leaveRequestId, leaveRows.map((leave) => leave.id)),
      ))
    : [];
  const currentLeaveIntervalSetIds = currentLeaveIntervalSets.map((row) => row.id);
  const currentLeaveIntervals = currentLeaveIntervalSetIds.length
    ? await db.select().from(leaveRequestIntervals).where(and(
        eq(leaveRequestIntervals.organizationId, selectedOrganization.id),
        inArray(leaveRequestIntervals.intervalSetId, currentLeaveIntervalSetIds),
      ))
    : [];
  const currentLeaveSetByRequest = new Map(
    currentLeaveIntervalSets.map((row) => [row.leaveRequestId, row]),
  );
  const leaveRowsWithTiming = leaveRows.map((leave) => {
    const intervalSet = currentLeaveSetByRequest.get(leave.id);
    return {
      ...leave,
      intervalRevision: intervalSet?.revision ?? null,
      intervals: intervalSet
        ? currentLeaveIntervals.filter((interval) => interval.intervalSetId === intervalSet.id)
        : [],
    };
  });

  const provisionRows = allEmployeesVisible
    ? provisionRowsRaw
    : provisionRowsRaw.filter((task) => visibleEmployeeIds.has(task.employeeId));
  const separationRows = allEmployeesVisible
    ? separationRowsRaw
    : separationRowsRaw.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const payRevisionRows = allEmployeesVisible
    ? payRevisionRowsRaw
    : payRevisionRowsRaw.filter((revision) => visibleEmployeeIds.has(revision.employeeId));
  const restDayRevisionRows = allEmployeesVisible
    ? restDayRevisionRowsRaw
    : restDayRevisionRowsRaw.filter((revision) => visibleEmployeeIds.has(revision.employeeId));
  const retroRows = allEmployeesVisible
    ? retroRowsRaw
    : retroRowsRaw.filter((retro) => visibleEmployeeIds.has(retro.employeeId));

  const delegatedToUser = new Set(
    delegationRows
      .filter((delegation) => delegation.active && delegation.toApprover.toLowerCase() === sessionUser.name.toLowerCase())
      .map((delegation) => delegation.fromApprover.toLowerCase()),
  );
  const taskRows =
    access.role === "manager" || access.role === "checker"
      ? taskRowsRaw.filter(
          (task) =>
            task.approver.toLowerCase() === sessionUser.name.toLowerCase() ||
            roleApproverMatchesRole(task.approver, access.role) ||
            delegatedToUser.has(task.approver.toLowerCase()),
        )
      : taskRowsRaw;

  const currentRun = canViewPayroll ? runRows.find((run) => run.status !== "Released") ?? runRows[0] : undefined;
  const entries = currentRun
    ? await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, currentRun.id)).orderBy(asc(payrollEntries.id))
    : [];
  const jobs = currentRun
    ? await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, currentRun.id))
    : [];

  const accountType = selectedOrganization.accountType;
  const capabilities = {
    orgStructure: accountType !== "freelancer",
    payroll: accountType !== "freelancer" && canViewPayroll,
    approvals: accountType !== "freelancer" && roleAllowed(access.role, ["owner", "admin", "bookkeeper", "payroll", "manager", "hr", "checker"]),
    multiBranch: accountType === "enterprise" || selectedOrganization.plan === "Scale" || selectedOrganization.plan === "Enterprise",
    developer: accountType !== "freelancer",
  };

  const canViewFirstPayrollReadiness =
    accountType !== "freelancer"
    && access.companyWide
    && canReadFirstPayrollProgress(access.role);
  const firstPayrollMemberships = canViewFirstPayrollReadiness
    ? await db
        .select({ role: userOrganizations.role })
        .from(userOrganizations)
        .where(and(
          eq(userOrganizations.organizationId, selectedOrganization.id),
          eq(userOrganizations.active, true),
        ))
    : [];
  const firstPayrollReadiness = canViewFirstPayrollReadiness
    ? buildFirstPayrollReadiness({
        workspaceName: selectedOrganization.legalName || selectedOrganization.name,
        employees: employeeRows,
        memberships: firstPayrollMemberships,
        payrollStatuses: (canViewPayroll ? runRows : handoffRunRows).map((run) => run.status),
      })
    : null;

  const payProfileByEmployee = new Map(payProfileRows.map((profile) => [profile.employeeId, profile]));
  const showPersonalIdentifiers = !(entityContext.enabled && access.role === "group_hr");
  const employeesWithPayBasis = employeeRows.map((employee) => {
    const profile = payProfileByEmployee.get(employee.id);
    return {
      ...employee,
      // Group HR is allowed cross-employer workforce reads, but never bank
      // destination details or a worker's government-ID fragments.
      bankAccount: showPersonalIdentifiers ? maskBankAccount(employee.bankAccount) : null,
      bankCode: showPersonalIdentifiers ? employee.bankCode : null,
      tin: showPersonalIdentifiers ? maskGovernmentId(employee.tin) : null,
      tinBranchCode: showPersonalIdentifiers ? maskGovernmentId(employee.tinBranchCode) : null,
      sssNo: showPersonalIdentifiers ? maskGovernmentId(employee.sssNo) : null,
      philHealthNo: showPersonalIdentifiers ? maskGovernmentId(employee.philHealthNo) : null,
      pagIbigNo: showPersonalIdentifiers ? maskGovernmentId(employee.pagIbigNo) : null,
      payBasis: profile?.payBasis ?? "monthly",
      payRate: profile?.rateAmount ?? employee.basicRate,
      standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
      standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
    };
  });

  return {
    firstPayrollReadiness,
    firstPayrollConnectedEnabled: criticalReleaseFlagEnabled("firstPayrollConnected"),
    payrollEmployerSetupNavigationEnabled: criticalReleaseFlagEnabled("payrollEmployerSetupNavigation"),
    advancedPlanningAllowed,
    coreModuleNavigationEnabled,
    employeeImportPreviewEnabled: criticalReleaseFlagEnabled("employeeImportPreview"),
    xenditPayoutsEnabled: criticalReleaseFlagEnabled("xenditPayrollPayouts"),
    bir1604cCandidateEnabled: criticalReleaseFlagEnabled("bir1604cReviewedCandidate"),
    yearEndPriorEvidenceEnabled: criticalReleaseFlagEnabled("yearEndPriorEvidence"),
    bir2316CertificateEnabled: criticalReleaseFlagEnabled("bir2316Certificate") && criticalReleaseFlagEnabled("bir2316Reconciliation") && criticalReleaseFlagEnabled("bir2316WithholdingEvidence"),
    compactMobileHeaderEnabled: criticalReleaseFlagEnabled("compactMobileHeader"),
    everydayHrHireEnabled: criticalReleaseFlagEnabled("everydayHrHire"),
    user: sessionUser ? { ...publicUser(sessionUser), role: access.role } : null,
    access,
    ...(entityContext.enabled ? { multiEntity: {
      enabled: true as const, group: entityContext.group,
      canSwitch: entityContext.canSwitch, role: entityContext.role,
      legalEntityId: entityContext.legalEntityId, entities: entityContext.entities,
    } } : {}),
    capabilities,
    organizations: orgs.map(decorateOrganization),
    selectedOrganization: decorateOrganization(selectedOrganization),
    employees: employeesWithPayBasis,
    orgUnits: units,
    payrollRuns: runRows,
    payrollHandoffRun: handoffRun
      ? {
          id: handoffRun.id,
          periodLabel: handoffRun.periodLabel,
          periodStart: handoffRun.periodStart,
          periodEnd: handoffRun.periodEnd,
          scopeLabel: "scopeLabel" in handoffRun ? handoffRun.scopeLabel : undefined,
          scopeOrgUnitId: "scopeOrgUnitId" in handoffRun ? handoffRun.scopeOrgUnitId : undefined,
          status: handoffRun.status,
          payDate: handoffRun.payDate,
        }
      : null,
    payrollEntries: entries,
    payrollJobs: jobs,
    tasks: taskRows,
    complianceActions,
    auditEvents: auditRows,
    plans,
    templates,
    advisories,
    punches: punchRows,
    delegations: allEmployeesVisible
      ? delegationRows
      : delegationRows.filter((delegation) =>
          delegation.fromApprover.toLowerCase() === sessionUser.name.toLowerCase()
          || delegation.toApprover.toLowerCase() === sessionUser.name.toLowerCase(),
        ),
    leaveRequests: leaveRowsWithTiming,
    leavePolicies: leavePolicyRows,
    wageOrders: wages,
    provisioning: provisionRows,
    separations: separationRows,
    payRevisions: payRevisionRows,
    restDayRevisions: restDayRevisionRows,
    retroAdjustments: retroRows,
    freelancer: freelancer[0] ?? null,
    security: {
      passwordAuth: true,
      totp: "available",
      totpMandatory: false,
      sessions: "server-side-revocable",
      rateLimit: "distributed-postgres (not CDN edge)",
      sso: "not configured",
    },
  };
}
