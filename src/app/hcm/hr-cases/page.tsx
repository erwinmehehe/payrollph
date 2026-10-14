import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { employeeHrCasesEnabled } from "@/lib/hr-case-activation";
import { hrCaseRoleCanWork } from "@/lib/hr-case-policy";
import { EmployeeHrCaseStaffQueue } from "@/components/employee-hr-case-staff-queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "HR Requests | Linaw",
  robots: { index: false, follow: false },
};

export default async function HrCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (!employeeHrCasesEnabled()) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { organizationId: raw } = await searchParams;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) notFound();
  const organizationId = Number(raw);
  if (!Number.isSafeInteger(organizationId)) notFound();

  const access = await getAccess(user.id, organizationId);
  if (!access || (
    !hrCaseRoleCanWork(access.role, "hr") &&
    !hrCaseRoleCanWork(access.role, "payroll")
  )) notFound();
  // Canonical role-gate also enforces the organization's custom permission sets
  // and session security policy, not just the displayed membership role.
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES);
  if (denied) notFound();

  const canApproveCoe = access.companyWide && ["owner", "admin", "hr"].includes(access.role);
  return <main className="mx-auto max-w-6xl px-5 py-8">
    <nav className="mb-6 text-sm">
      <Link href={"/app?organizationId=" + organizationId}
        className="font-medium text-emerald-800 hover:underline">
        ← Back to workspace
      </Link>
    </nav>
    <header className="mb-8">
      <h1 className="text-3xl font-bold tracking-tight">Employee HR requests</h1>
      <p className="mt-2 text-sm text-slate-600">
        Review only your assigned HR or payroll cases. Private notes stay with staff.
        Certificates require an independent authorized approver.
      </p>
    </header>
    <EmployeeHrCaseStaffQueue organizationId={organizationId}
      canApproveCoe={canApproveCoe} />
  </main>;
}
