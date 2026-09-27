import type { Metadata } from "next";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { SelfServicePortal } from "@/components/self-service-portal";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";
import { PublicHomepage } from "@/components/public-homepage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines & HRIS Payroll System | Linaw",
  description: "Philippine payroll software and HRIS for payroll calculation, attendance, statutory deductions, payslips, approvals, reporting, and employee self-service.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const user = await getSessionUser();

  // Signed out: show the public product page so the design is previewable
  // without an account. Sign-in lives at /login.
  if (!user) return <PublicHomepage />;

  // Employees get the self-service portal; admins get the workspace.
  if (user.role === "employee") return <SelfServicePortal demoMode={user.demo} />;

  const data = await getDashboardData();
  return <LinawWorkspace initialData={data} demoMode={user.demo} />;
}
