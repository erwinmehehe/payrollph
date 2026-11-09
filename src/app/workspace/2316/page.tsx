import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { certificateDraftEnabled } from "@/lib/bir-2316-certificate-server";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { explicitPayrollReviewEmployerId } from "@/lib/tenant-payroll-review-page";
import { Certificate2316Review } from "@/components/workspace/certificate-2316-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "2316 certificate preparation | Linaw", robots: { index: false, follow: false } };

export default async function CertificatePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!certificateDraftEnabled()) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  // An absent selector keeps the existing guidance. An explicitly forged,
  // duplicated or noncanonical selector never falls back to another employer.
  if (query.organizationId === undefined) return <p>Select an employer in the payroll workspace first.</p>;
  const organizationId = explicitPayrollReviewEmployerId(query.organizationId);
  if (!organizationId) notFound();

  // Check the active tenant role, custom deny and company-wide scope before
  // mounting a client capable of requesting private annual tax evidence.
  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide) notFound();

  const { employeeId, taxYear, separationId } = query;
  if ((employeeId !== undefined && typeof employeeId !== "string") ||
      (taxYear !== undefined && typeof taxYear !== "string") ||
      (separationId !== undefined && typeof separationId !== "string")) notFound();

  return <>
    <p data-organization-id={organizationId} className="mx-auto max-w-5xl px-6 pt-5 text-sm text-slate-600">
      Authorized payroll employer: #{organizationId}
    </p>
    <Certificate2316Review organizationId={organizationId}
      initialEmployeeId={employeeId ?? ""}
      initialTaxYear={taxYear ?? String(new Date().getFullYear())}
      separationId={separationId} />
  </>;
}
