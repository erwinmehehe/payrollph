import type { Metadata } from "next";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { SoftwareHome } from "@/components/marketing/software-home";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines | HRIS & Payroll System | Linaw",
  description:
    "Philippine payroll software for payroll automation, HRIS, attendance, SSS, PhilHealth, Pag-IBIG, TRAIN withholding, payslips, approvals and reporting.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const user = await getSessionUser();

  if (!user) return <SoftwareHome />;

  if (user.role === "employee") return <SelfServicePortal />;

  const data = await getDashboardData();
  return <LinawWorkspace initialData={data} />;
}
