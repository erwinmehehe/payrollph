import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { certificateDraftEnabled } from "@/lib/bir-2316-certificate-server";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { Certificate2316Review } from "@/components/workspace/certificate-2316-review";
export const dynamic = "force-dynamic";
export const metadata = { title: "2316 certificate preparation | Linaw", robots: { index: false, follow: false } };
export default async function CertificatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!certificateDraftEnabled()) notFound();
  const user = await getSessionUser(); if (!user) redirect("/login");
  const query = await searchParams, organizationId = Number(query.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return <p>Select an employer in the payroll workspace first.</p>;
  if (await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES) || !(await getAccess(user.id, organizationId))?.companyWide) return <p role="alert">Company-wide payroll access is required.</p>;
  return <Certificate2316Review organizationId={organizationId} initialEmployeeId={query.employeeId ?? ""} initialTaxYear={query.taxYear ?? String(new Date().getFullYear())} separationId={query.separationId} />;
}
