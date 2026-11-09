import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { priorEvidenceEnabled } from "@/lib/year-end-prior-evidence-server";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { explicitPayrollReviewEmployerId } from "@/lib/tenant-payroll-review-page";
import { YearEndPriorReview } from "@/components/workspace/year-end-prior-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Previous employer & PERA review | Linaw", robots: { index: false, follow: false } };

export default async function PriorPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!priorEvidenceEnabled()) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  if (query.organizationId === undefined) return <p>Select an employer first.</p>;
  const organizationId = explicitPayrollReviewEmployerId(query.organizationId);
  if (!organizationId) notFound();

  // Deny cross-employer, unit-scoped, revoked, group-HR and custom-denied
  // sessions before mounting the private prior-employment review client.
  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide) notFound();

  const { employeeId, taxYear } = query;
  if ((employeeId !== undefined && typeof employeeId !== "string") ||
      (taxYear !== undefined && typeof taxYear !== "string")) notFound();

  return <>
    <p data-organization-id={organizationId} className="mx-auto max-w-5xl px-6 pt-5 text-sm text-slate-600">
      Authorized payroll employer: #{organizationId}
    </p>
    <YearEndPriorReview organizationId={organizationId} userId={user.id}
      employeeId={employeeId} taxYear={taxYear} />
  </>;
}
