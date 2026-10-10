import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import { primaryCompanyOrganizationId, primaryEmployeeOrganizationId } from "@/lib/access";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { isSelfServeOrganization } from "@/lib/saas-workspace-access";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "App | Linaw",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage() {
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

  const companyOrganizationId = await primaryCompanyOrganizationId(user.id);
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
  return <>
    <div className="mx-auto flex max-w-7xl justify-end px-5 pt-3">
      <Link href="/hcm/command-center" className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">HR Command Center</Link>
    </div>
    <LinawWorkspace initialData={data} isSelfServeCustomer={isSelfServe} />
  </>;
}

