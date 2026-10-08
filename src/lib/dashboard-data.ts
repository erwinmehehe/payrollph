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
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";
import { buildFirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";

export async function getDashboardData(organizationId?: number) {
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

  const orgs = await db
    .select()
    .from(organizations)
    .where(inArray(organizations.id, organizationIds))
    .orderBy(asc(organizations.id));

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

  await ensureEmployeePayProfiles(selectedOrganization.id);

  const canViewPayroll = roleAllowed(access.role, PAYROLL_VIEW_ROLES);
  const canViewPeoplePay = roleAllowed(access.role, PEOPLE_PAYROLL_ROLES);
  const canViewAudit = access.companyWide && ["owner", "admin", "bookkeeper", "payroll", "checker"].includes(access.role);
  const canViewDelegations = roleAllowed(access.role, PAYROLL_CHECKER_ROLES);
  const canViewComplianceActions = access.companyWide && roleAllowed(access.role, PAYROLL_OPERATOR_ROLES);

  const employeeFilter = access && !access.companyWide && access.orgUnitId
    ? and(eq(employees.organizationId, selectedOrganization.id), eq(employees.orgUnitId, access.orgUnitId))
    : eq(employees.organizationId, selectedOrganization.id);

  const [employeeRows, payProfileRows, payRevisionRowsRaw, restDayRevisionRowsRaw, retroRowsRaw, runRows, taskRowsRaw, auditRows, plans, templates, advisories, freelancer, punchRowsRaw, delegationRows, leaveRowsRaw, leavePolicyRows, units, wages, provisionRowsRaw, separationRowsRaw] = await Promise.all([
    db.select().from(employees).where(employeeFilter).orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, selectedOrganization.id)),
    canViewPeoplePay
      ? db.select().from(employeePayRevisions).where(eq(employeePayRevisions.organizationId, selectedOrganization.id)).orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
      : Promise.resolve([]),
    canViewPeoplePay
      ? db.select().from(employeeRestDayRevisions).where(eq(employeeRestDayRevisions.organizationId, selectedOrganization.id)).orderBy(desc(employeeRestDayRevisions.effectiveDate), desc(employeeRestDayRevisions.id))
      : Promise.resolve([]),
    canViewPeoplePay
      ? db.select().from(employeePayRetroAdjustments).where(eq(employeePayRetroAdjustments.organizationId, selectedOrganization.id)).orderBy(desc(employeePayRetroAdjustments.id))
      : Promise.resolve([]),
    canViewPayroll
      ? db.select().from(payrollRuns).where(
          access.companyWide
            ? eq(payrollRuns.organizationId, selectedOrganization.id)
            : and(
                eq(payrollRuns.organizationId, selectedOrganization.id),
                eq(payrollRuns.scopeOrgUnitId, access.orgUnitId!),
              ),
        ).orderBy(desc(payrollRuns.id))
      : Promise.resolve([]),
    access.companyWide || ["manager", "checker"].includes(access.role)
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
    db.select().from(timePunches).where(eq(timePunches.organizationId, selectedOrganization.id)).orderBy(desc(timePunches.workDate)),
    canViewDelegations
      ? db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, selectedOrganization.id)).orderBy(desc(approvalDelegations.id))
      : Promise.resolve([]),
    db.select().from(leaveRequests).where(eq(leaveRequests.organizationId, selectedOrganization.id)).orderBy(desc(leaveRequests.id)),
    db.select().from(leavePolicies).where(eq(leavePolicies.organizationId, selectedOrganization.id)).orderBy(asc(leavePolicies.id)),
    db.select().from(orgUnits).where(
      access.companyWide
        ? eq(orgUnits.organizationId, selectedOrganization.id)
        : and(eq(orgUnits.organizationId, selectedOrganization.id), eq(orgUnits.id, access.orgUnitId!)),
    ),
    db.select().from(minWageOrders),
    db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, selectedOrganization.id)),
    canViewPeoplePay
      ? db.select({
          id: separationRecords.id,
          employeeId: separationRecords.employeeId,
          separationType: separationRecords.separationType,
          noticeDate: separationRecords.noticeDate,
          lastDay: separationRecords.lastDay,
          status: separationRecords.status,
        }).from(separationRecords).where(eq(separationRecords.organizationId, selectedOrganization.id))
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
          .where(eq(payrollRuns.organizationId, selectedOrganization.id))
          .orderBy(desc(payrollRuns.id))
          .limit(12)
      : [];
  const handoffRun = canViewPayroll
    ? runRows.find((run) => run.status !== "Released") ?? runRows[0] ?? null
    : handoffRunRows.find((run) => run.status !== "Released") ?? handoffRunRows[0] ?? null;

  const visibleEmployeeIds = new Set(employeeRows.map((employee) => employee.id));
  const punchRows = access.companyWide
    ? punchRowsRaw
    : punchRowsRaw.filter((punch) => visibleEmployeeIds.has(punch.employeeId));
  const leaveRows = access.companyWide
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

  const provisionRows = access.companyWide
    ? provisionRowsRaw
    : provisionRowsRaw.filter((task) => visibleEmployeeIds.has(task.employeeId));
  const separationRows = access.companyWide
    ? separationRowsRaw
    : separationRowsRaw.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const payRevisionRows = access.companyWide
    ? payRevisionRowsRaw
    : payRevisionRowsRaw.filter((revision) => visibleEmployeeIds.has(revision.employeeId));
  const restDayRevisionRows = access.companyWide
    ? restDayRevisionRowsRaw
    : restDayRevisionRowsRaw.filter((revision) => visibleEmployeeIds.has(revision.employeeId));
  const retroRows = access.companyWide
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
    && ["owner", "admin", "bookkeeper", "payroll"].includes(access.role);
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
        payrollStatuses: runRows.map((run) => run.status),
      })
    : null;

  const payProfileByEmployee = new Map(payProfileRows.map((profile) => [profile.employeeId, profile]));
  const employeesWithPayBasis = employeeRows.map((employee) => {
    const profile = payProfileByEmployee.get(employee.id);
    return {
      ...employee,
      // The browser never needs the full account number, and it used to receive
      // it for every employee. Last four only; the real value stays server-side.
      bankAccount: maskBankAccount(employee.bankAccount),
      tin: maskGovernmentId(employee.tin),
      tinBranchCode: maskGovernmentId(employee.tinBranchCode),
      sssNo: maskGovernmentId(employee.sssNo),
      philHealthNo: maskGovernmentId(employee.philHealthNo),
      pagIbigNo: maskGovernmentId(employee.pagIbigNo),
      payBasis: profile?.payBasis ?? "monthly",
      payRate: profile?.rateAmount ?? employee.basicRate,
      standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
      standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
    };
  });

  return {
    firstPayrollReadiness,
    user: sessionUser ? { ...publicUser(sessionUser), role: access.role } : null,
    access,
    capabilities,
    organizations: orgs,
    selectedOrganization,
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
    delegations: access.companyWide
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
