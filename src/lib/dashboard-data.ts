import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalDelegations,
  approvalTasks,
  auditEvents,
  bankTemplates,
  calamityAdvisories,
  employees,
  freelancerProfiles,
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
} from "@/db/schema";
import { ensureSeedData } from "@/db/seed";
import { getAccess } from "@/lib/access";
import { getSessionUser, publicUser } from "@/lib/auth";

export async function getDashboardData(organizationId?: number) {
  await ensureSeedData();
  const sessionUser = await getSessionUser();
  const orgs = await db.select().from(organizations).orderBy(asc(organizations.id));
  const selectedOrganization = organizationId
    ? orgs.find((organization) => organization.id === organizationId) ?? orgs[0]
    : orgs[0];

  const access = sessionUser
    ? await getAccess(sessionUser.id, selectedOrganization.id)
    : { organizationId: selectedOrganization.id, role: "admin", orgUnitId: null, orgUnitName: null, companyWide: true };

  const employeeFilter = access && !access.companyWide && access.orgUnitId
    ? and(eq(employees.organizationId, selectedOrganization.id), eq(employees.orgUnitId, access.orgUnitId))
    : eq(employees.organizationId, selectedOrganization.id);

  const [employeeRows, runRows, taskRows, auditRows, plans, templates, advisories, freelancer, punchRows, delegationRows, leaveRows, units, wages, provisionRows] = await Promise.all([
    db.select().from(employees).where(employeeFilter).orderBy(asc(employees.id)),
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, selectedOrganization.id)).orderBy(desc(payrollRuns.id)),
    db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, selectedOrganization.id)).orderBy(asc(approvalTasks.id)),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, selectedOrganization.id)).orderBy(desc(auditEvents.createdAt)),
    db.select().from(pricingPlans).orderBy(asc(pricingPlans.id)),
    db.select().from(bankTemplates).where(eq(bankTemplates.active, true)).orderBy(asc(bankTemplates.id)),
    db.select().from(calamityAdvisories).where(eq(calamityAdvisories.organizationId, selectedOrganization.id)),
    db.select().from(freelancerProfiles).where(eq(freelancerProfiles.organizationId, selectedOrganization.id)),
    db.select().from(timePunches).where(eq(timePunches.organizationId, selectedOrganization.id)).orderBy(desc(timePunches.workDate)),
    db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, selectedOrganization.id)).orderBy(desc(approvalDelegations.id)),
    db.select().from(leaveRequests).where(eq(leaveRequests.organizationId, selectedOrganization.id)).orderBy(desc(leaveRequests.id)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, selectedOrganization.id)),
    db.select().from(minWageOrders),
    db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, selectedOrganization.id)),
  ]);

  const currentRun = runRows.find((run) => run.status !== "Released") ?? runRows[0];
  const entries = currentRun
    ? await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, currentRun.id)).orderBy(asc(payrollEntries.id))
    : [];
  const jobs = currentRun
    ? await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, currentRun.id))
    : [];

  const accountType = selectedOrganization.accountType;
  const capabilities = {
    orgStructure: accountType !== "freelancer",
    payroll: accountType !== "freelancer",
    approvals: accountType !== "freelancer",
    multiBranch: accountType === "enterprise" || selectedOrganization.plan === "Scale" || selectedOrganization.plan === "Enterprise",
    developer: accountType !== "freelancer",
  };

  return {
    user: sessionUser ? publicUser(sessionUser) : null,
    access,
    capabilities,
    organizations: orgs,
    selectedOrganization,
    employees: employeeRows,
    orgUnits: units,
    payrollRuns: runRows,
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
    wageOrders: wages,
    provisioning: provisionRows,
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
