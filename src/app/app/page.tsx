import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import { getAccess, primaryCompanyOrganizationId, primaryEmployeeOrganizationId } from "@/lib/access";
import { explicitHcmEmployerId, canOpenPeopleHome, peopleHomeEnabledForOrganization } from "@/lib/hcm-people-home-scope";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { isSelfServeOrganization } from "@/lib/saas-workspace-access";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";
import { pilotFocusEnabledForOrganization } from "@/lib/pilot-navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "App | Linaw",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[] }> }) {
  const user = await getSessionUser();

  if (!user) redirect("/login");

  if (user.role === "employee") {
    const employeeOrganizationId = await primaryEmployeeOrganizationId(user.id);
    if (employeeOrganizationId) {
      const denied = await assertOrganizationSessionPolicy(user.id, employeeOrganizationId);
      if (denied) redirect("/login?ssoRequired=1");
    }
    return <SelfServicePortal />;
  }

  const { organizationId: requestedValue } = await searchParams;
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
    return <SelfServicePortal />;
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

  const data = await getDashboardData(companyOrganizationId);
  const pilotFocusEnabled = pilotFocusEnabledForOrganization(companyOrganizationId);
  const access = data.access;
  const canSeeMyTeam = !pilotFocusEnabled && process.env.NEXT_PUBLIC_HCM_MY_TEAM_ENABLED === "true" &&
    !!access && (
      ["owner", "admin", "hr"].includes(access.role) ||
      (access.role === "manager" && !access.companyWide && access.orgUnitId !== null)
    );
  return <>
    <div className="mx-auto flex max-w-7xl flex-wrap justify-end gap-3 px-5 pt-3">
      {canSeeMyTeam && (
        <Link
          href={"/hcm/my-team?organizationId=" + data.selectedOrganization.id}
          className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          My Team
        </Link>
      )}
      {!pilotFocusEnabled && peopleHomeEnabledForOrganization(data.selectedOrganization.id) && canOpenPeopleHome(access) && (<Link href={`/hcm/command-center?organizationId=${data.selectedOrganization.id}`} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">HR Command Center</Link>) }
    </div>
    <LinawWorkspace initialData={data} pilotFocusEnabled={pilotFocusEnabled} />
  </>;
}

