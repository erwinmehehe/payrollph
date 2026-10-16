import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { priorEvidenceEnabled } from "@/lib/year-end-prior-evidence-server";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { YearEndPriorReview } from "@/components/workspace/year-end-prior-review";
export const dynamic = "force-dynamic";
export const metadata = { title: "Previous employer & PERA review | Linaw", robots: { index: false, follow: false } };
export default async function PriorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!priorEvidenceEnabled()) notFound();
  const user = await getSessionUser(); if (!user) redirect("/login");
  const query = await searchParams, organizationId = Number(query.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return <p>Select an employer first.</p>;
  if (await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES) || !(await getAccess(user.id, organizationId))?.companyWide) return <p role="alert">Company-wide payroll access required.</p>;
  return <YearEndPriorReview organizationId={organizationId} userId={user.id} employeeId={query.employeeId} taxYear={query.taxYear} />;
}
