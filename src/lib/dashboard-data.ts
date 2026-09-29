import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalDelegations,
  approvalTasks,
  auditEvents,
  bankTemplates,
  calamityAdvisories,
  employeePayProfiles,
  employeePayRevisions,
  employeePayRetroAdjustments,
  employees,
  freelancerProfiles,
  leavePolicies,
  leaveRequests,
  minWageOrders,
  organizations,
  orgUnits,
  payrollEntries,
  payrollJobs,
  payrollRuns,
  pricingPlans,
  provisioningTasks,
  timePunches,
  userOrganizations,
} from "@/db/schema";
import { ensureSeedData } from "@/db/seed";
import { getAccess, PAYROLL_CHECKER_ROLES, PAYROLL_VIEW_ROLES, PEOPLE_PAYROLL_ROLES, roleAllowed } from "@/lib/access";
import { getSessionUser, publicUser } from "@/lib/auth";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";

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
    .where(eq(userOrganizations.userId, sessionUser.id))
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

  const access = await getAccess(sessionUser.id, selectedOrganization.id);
  if (!access) {
    throw new Error("The requested workspace is not available to this account.");
  }

  await ensureEmployeePayProfiles(selectedOrganization.id);

  const canViewPayroll = roleAllowed(access.role, PAYROLL_VIEW_ROLES);
  const canViewPeoplePay = roleAllowed(access.role, PEOPLE_PAYROLL_ROLES);
  const canViewAudit = ["owner", "admin", "bookkeeper", "payroll", "checker"].includes(access.role);
  const canViewDelegations = roleAllowed(access.role, PAYROLL_CHECKER_ROLES);

  const employeeFilter = access && !access.companyWide && access.orgUnitId
    ? and(eq(employees.organizationId, selectedOrganization.id), eq(employees.orgUnitId, access.orgUnitId))
    : eq(employees.organizationId, selectedOrganization.id);

  const [employeeRows, payProfileRows, payRevisionRowsRaw, retroRowsRaw, runRows, taskRowsRaw, auditRows, plans, templates, advisories, freelancer, punchRowsRaw, delegationRows, leaveRowsRaw, leavePolicyRows, units, wages, provisionRowsRaw] = await Promise.all([
    db.select().from(employees).where(employeeFilter).orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, selectedOrganization.id)),
    canViewPeoplePay
      ? db.select().from(employeePayRevisions).where(eq(employeePayRevisions.organizationId, selectedOrganization.id)).orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
      : Promise.resolve([]),
    canViewPeoplePay
      ? db.select().from(employeePayRetroAdjustments).where(eq(employeePayRetroAdjustments.organizationId, selectedOrganization.id)).orderBy(desc(employeePayRetroAdjustments.id))
      : Promise.resolve([]),
    canViewPayroll
      ? db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, selectedOrganization.id)).orderBy(desc(payrollRuns.id))
      : Promise.resolve([]),
    db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, selectedOrganization.id)).orderBy(asc(approvalTasks.id)),
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
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, selectedOrganization.id)),
    db.select().from(minWageOrders),
    db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, selectedOrganization.id)),
  ]);

  const handoffRunRows = canViewPayroll
    ? runRows
    : access.role === "hr" && access.companyWide
      ? await db
          .select({
            id: payrollRuns.id,
            periodLabel: payrollRuns.periodLabel,
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
  const provisionRows = access.companyWide
    ? provisionRowsRaw
    : provisionRowsRaw.filter((task) => visibleEmployeeIds.has(task.employeeId));
  const payRevisionRows = access.companyWide
    ? payRevisionRowsRaw
    : payRevisionRowsRaw.filter((revision) => visibleEmployeeIds.has(revision.employeeId));
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

  const payProfileByEmployee = new Map(payProfileRows.map((profile) => [profile.employeeId, profile]));
  const employeesWithPayBasis = employeeRows.map((employee) => {
    const profile = payProfileByEmployee.get(employee.id);
    return {
      ...employee,
      payBasis: profile?.payBasis ?? "monthly",
      payRate: profile?.rateAmount ?? employee.basicRate,
      standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
      standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
    };
  });

  return {
    user: sessionUser ? publicUser(sessionUser) : null,
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
          status: handoffRun.status,
          payDate: handoffRun.payDate,
        }
      : null,
    payrollEntries: entries,
    payrollJobs: jobs,
    tasks: taskRows,
    auditEvents: auditRows,
    plans,
    templates,
    advisories,
    punches: punchRows,
    delegations: delegationRows,
    leaveRequests: leaveRows,
    leavePolicies: leavePolicyRows,
    wageOrders: wages,
    provisioning: provisionRows,
    payRevisions: payRevisionRows,
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
