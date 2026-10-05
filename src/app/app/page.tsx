import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import { primaryCompanyOrganizationId } from "@/lib/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "App | Linaw",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage() {
  const user = await getSessionUser();

  if (!user) redirect("/login");

  const companyOrganizationId = await primaryCompanyOrganizationId(user.id);
  if (!companyOrganizationId) return <SelfServicePortal />;

  const data = await getDashboardData(companyOrganizationId);
  return <LinawWorkspace initialData={data} />;
}
