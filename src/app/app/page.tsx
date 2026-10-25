import { parseDashboardSnapshotRead } from "@/lib/dashboard-snapshot-read";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { employeeHrCasesEnabled } from "@/lib/hr-case-activation";
import { spendPayrollEnabled } from "@/lib/spend-claim-evidence";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, PEOPLE_PAYROLL_ROLES, primaryCompanyOrganizationId, primaryEmployeeOrganizationId } from "@/lib/access";
import { explicitHcmEmployerId, canOpenPeopleHome, peopleHomeEnabledForOrganization } from "@/lib/hcm-people-home-scope";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { isSelfServeOrganization } from "@/lib/saas-workspace-access";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";
import { pilotFocusEnabledForOrganization } from "@/lib/pilot-navigation";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";
import { managerDirectReportsEnabledForEmployer } from "@/lib/hcm-manager-direct-reports";
import { hirePayrollReviewEnabledForEmployer } from "@/lib/hcm-hire-payroll-review";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { WorkflowUiProvider } from "@/components/workspace/workflow-ui-context";
import { resolveWorkflowUiFlags } from "@/lib/workflow-ui-flags";
import { firstPayrollInlineAvailable } from "@/lib/first-payroll-inline-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "App | Linaw",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[]; focusEmployeeId?: string | string[]; workspacePage?: string | string[] }> }) {
  const user = await getSessionUser();

  if (!user) redirect("/login");

  if (user.role === "employee") {
    const employeeOrganizationId = await primaryEmployeeOrganizationId(user.id);
    if (employeeOrganizationId) {
      const denied = await assertOrganizationSessionPolicy(user.id, employeeOrganizationId);
      if (denied) redirect("/login?ssoRequired=1");
    }
    return <WorkflowUiProvider flags={resolveWorkflowUiFlags()}><SelfServicePortal hrCasesEnabled={employeeHrCasesEnabled()} spendEnabled={spendPayrollEnabled()} /></WorkflowUiProvider>;
  }

  const { organizationId: requestedValue, focusEmployeeId: requestedEmployeeId, workspacePage: requestedWorkspacePage } = await searchParams;
  let companyOrganizationId: number | null;
  if (requestedValue !== undefined) {
    const requestedOrganizationId = explicitHcmEmployerId(requestedValue);
    const requestedAccess = requestedOrganizationId ? await getAccess(user.id, requestedOrganizationId) : null;
    // A user may be staff for one employer and employee-only for another.
    // An employee membership never grants access to the company workspace.
    if (!requestedAccess || requestedAccess.role === "employee") notFound();
    companyOrganizationId = requestedOrganizationId;
  } else {
    companyOrganizationId = await primaryCompanyOrganizationId(user.id);
  }
  if (!companyOrganizationId) {
    const employeeOrganizationId = await primaryEmployeeOrganizationId(user.id);
    if (employeeOrganizationId) {
      const denied = await assertOrganizationSessionPolicy(user.id, employeeOrganizationId);
      if (denied) redirect("/login?ssoRequired=1");
    }
    return <WorkflowUiProvider flags={resolveWorkflowUiFlags()}><SelfServicePortal hrCasesEnabled={employeeHrCasesEnabled()} spendEnabled={spendPayrollEnabled()} /></WorkflowUiProvider>;
  }

  // Newly self-registered company owners must authorize a successful
  // subscription before gaining payroll workspace access. Legacy pilot
  // organizations are not affected by the new signup gate.
  const isSelfServe = await isSelfServeOrganization(companyOrganizationId);
  if (isSelfServe) {
    const [billing] = await db.select({ status: subscriptions.status, periodEnd: subscriptions.periodEnd })
      .from(subscriptions).where(eq(subscriptions.organizationId, companyOrganizationId)).limit(1);
    if (!billing || billing.status === "pending_payment") redirect("/billing/setup");
  }

  const companyDenied = await assertOrganizationSessionPolicy(user.id, companyOrganizationId);
  if (companyDenied) redirect("/login?ssoRequired=1");

  // Fail closed before the dashboard loader: a manager with no assigned
  // organizational unit cannot use a company-wide fallback.
  const managerAccess = await getAccess(user.id, companyOrganizationId);
  if (!managerAccess ||
      (managerAccess.role === "manager" && deriveMyTeamScope(managerAccess)?.kind !== "unit")) {
    notFound();
  }
  let data: Awaited<ReturnType<typeof getDashboardData>> | null;
  try {
    const snapshot = await getDashboardData(companyOrganizationId);
    data = parseDashboardSnapshotRead(true, snapshot, companyOrganizationId) ? snapshot : null;
  } catch {
    data = null;
  }
  if (!data) return (
    <main className="mx-auto max-w-xl p-8" role="alert">
      <h1>Workspace unavailable</h1>
      <p>Payroll amounts and employee counts could not be verified for this employer.</p>
      <Link href={`/app?organizationId=${companyOrganizationId}`}>Retry workspace</Link>
    </main>
  );
  const pilotFocusEnabled = pilotFocusEnabledForOrganization(companyOrganizationId);
  const access = data.access;
  const inlineFirstPayrollEnabled = isSelfServe && !!data.firstPayrollReadiness && await firstPayrollInlineAvailable();

  // A guessed worker deep link cannot bypass the People Home tenant allowlist,
  // SSO/custom-deny role gate, or the client-side authorized roster check.
  const allowPeopleFocus = requestedWorkspacePage === "People" &&
    typeof requestedEmployeeId === "string" &&
    /^[1-9]\d*$/.test(requestedEmployeeId) &&
    peopleHomeEnabledForOrganization(companyOrganizationId) &&
    !(await assertOrganizationRole(user.id, companyOrganizationId, PEOPLE_ADMIN_ROLES));
  // Source review is opt-in for one legal employer and explicit HR permission.
  const allowHirePayrollReview = !pilotFocusEnabled &&
    hirePayrollReviewEnabledForEmployer(companyOrganizationId) &&
    !!access?.companyWide && ["owner", "admin", "hr"].includes(access.role) &&
    (await assertOrganizationRole(user.id, companyOrganizationId, PEOPLE_ADMIN_ROLES)) === null;
  const canSeeHrCases = employeeHrCasesEnabled() &&
    !!access && ["owner", "admin", "hr", "payroll"].includes(access.role) &&
    !(await assertOrganizationRole(user.id, companyOrganizationId, PEOPLE_PAYROLL_ROLES));
  const canSeeMyTeam = !pilotFocusEnabled && process.env.HCM_MY_TEAM_ENABLED === "true" &&
    process.env.NEXT_PUBLIC_HCM_MY_TEAM_ENABLED === "true" &&
    !!access && (
      ["owner", "admin", "hr"].includes(access.role) ||
      (access.role === "manager" && !access.companyWide && access.orgUnitId !== null)
    );
  const canSeeManagerDirectReports = !pilotFocusEnabled &&
    managerDirectReportsEnabledForEmployer(companyOrganizationId) &&
    process.env.NEXT_PUBLIC_HCM_MANAGER_TEAM_ENABLED === "true" &&
    access?.role === "manager" && !access.companyWide && access.orgUnitId !== null;
  return <WorkflowUiProvider flags={resolveWorkflowUiFlags()}>
    <div className="mx-auto flex max-w-7xl flex-wrap justify-end gap-3 px-5 pt-3">
      {canSeeHrCases && (
        <Link href={"/hcm/hr-cases?organizationId=" + data.selectedOrganization.id}
          className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
          HR Requests
        </Link>
      )}
      {access?.companyWide && ["owner", "admin", "hr"].includes(access.role) && criticalReleaseFlagEnabled("engagementSurvey") && (
        <Link href={`/app/engagement?organizationId=${companyOrganizationId}`} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Engagement survey</Link>
      )}
      {access?.companyWide && ["owner", "admin", "hr"].includes(access.role) && criticalReleaseFlagEnabled("goalsReviewCycle") && (
        <Link href={`/app/goals-reviews?organizationId=${companyOrganizationId}`} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Goals & reviews</Link>
      )}
      {canSeeMyTeam && (
        <Link
          href={"/hcm/my-team?organizationId=" + data.selectedOrganization.id}
          className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          My Team
        </Link>
      )}
      {canSeeMyTeam && access?.role === "manager" && (
        <span className="self-center text-xs text-slate-600">Assigned unit directory</span>
      )}
      {canSeeManagerDirectReports && (
        <Link href={"/hcm/manager-direct-reports?organizationId=" + data.selectedOrganization.id}
          className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-950">
          My direct reports
        </Link>
      )}
      {!pilotFocusEnabled && peopleHomeEnabledForOrganization(data.selectedOrganization.id) && canOpenPeopleHome(access) && (<Link href={`/hcm/command-center?organizationId=${data.selectedOrganization.id}`} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">HR Command Center</Link>) }
    </div>
    <LinawWorkspace initialData={data} isSelfServeCustomer={isSelfServe} inlineFirstPayrollEnabled={inlineFirstPayrollEnabled} pilotFocusEnabled={pilotFocusEnabled} allowPeopleFocus={allowPeopleFocus} allowHirePayrollReview={allowHirePayrollReview} reviewTeamHref={canSeeMyTeam ? "/hcm/my-team?organizationId=" + data.selectedOrganization.id : null} optionalUiCapabilities={{
      overpaymentPreview: criticalReleaseFlagEnabled("overpaymentPreview"),
      overpaymentInvestigation: criticalReleaseFlagEnabled("overpaymentInvestigation"),
      tenantReportBuilder: criticalReleaseFlagEnabled("tenantReportBuilder"),
    }} />
  </WorkflowUiProvider>;
}

