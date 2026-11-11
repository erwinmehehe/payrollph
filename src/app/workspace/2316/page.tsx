import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, separationRecords } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { certificateDraftEnabled } from "@/lib/bir-2316-certificate-server";
import { frozenFinalPayLegalEntityId } from "@/lib/bir-2316-employer";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { explicitPayrollReviewEmployerId } from "@/lib/tenant-payroll-review-page";
import { canonicalPriorReviewWorkerId } from "@/lib/tenant-prior-review-worker";
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
  // Missing employer is guidance; a supplied employer must be canonical.
  if (query.organizationId === undefined) return <p>Select an employer in the payroll workspace first.</p>;
  const organizationId = explicitPayrollReviewEmployerId(query.organizationId);
  if (!organizationId) notFound();

  // Never mount employee-specific annual tax controls from company membership
  // alone: check the active payroll role, session policy and company scope.
  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide) notFound();

  const { employeeId, taxYear, separationId } = query;
  if ((employeeId !== undefined && typeof employeeId !== "string") ||
      (taxYear !== undefined && typeof taxYear !== "string") ||
      (separationId !== undefined && typeof separationId !== "string")) notFound();

  const selectedWorkerId = canonicalPriorReviewWorkerId(employeeId);
  if (selectedWorkerId === false) notFound();
  const selectedSeparationId = separationId === undefined
    ? null : explicitPayrollReviewEmployerId(separationId);
  if (separationId !== undefined && selectedSeparationId === null) notFound();
  if (selectedSeparationId !== null && selectedWorkerId === null) notFound();

  const selectedYear = taxYear === undefined ? new Date().getFullYear()
    : /^[1-9]\d{3}$/.test(taxYear) ? Number(taxYear) : null;
  if (selectedYear === null || selectedYear < 2021 || selectedYear > 2100) notFound();

  // Match the certificate API's current legal-employer grants, including
  // denying group-wide identities for an individual employee's tax review.
  const entityScope = await resolveMultiEntityContext({ userId: user.id, organizationId });
  if (!entityScope.ok || (entityScope.context.enabled && entityScope.context.group)) notFound();

  if (selectedWorkerId !== null) {
    // A caller-supplied employeeId is not proof of tenancy. Prove persisted
    // employer + worker binding before reflecting it into the private client.
    const [worker] = await db.select({ id: employees.id }).from(employees)
      .where(and(
        eq(employees.organizationId, organizationId),
        eq(employees.id, selectedWorkerId),
      )).limit(1);
    if (!worker) notFound();
  }

  if (selectedSeparationId !== null) {
    // The historic BIR employer is the released final-pay employer, not the
    // worker's current entity after a transfer. Bind all three source IDs.
    const [separation] = await db.select({
      status: separationRecords.status,
      lastDay: separationRecords.lastDay,
      snapshot: separationRecords.computationSnapshot,
    }).from(separationRecords).where(and(
      eq(separationRecords.organizationId, organizationId),
      eq(separationRecords.employeeId, selectedWorkerId!),
      eq(separationRecords.id, selectedSeparationId),
    )).limit(1);
    if (!separation || separation.status !== "released" ||
        !separation.lastDay.startsWith(String(selectedYear) + "-")) notFound();
    if (entityScope.context.enabled && assertEntityResource(
      entityScope.context, frozenFinalPayLegalEntityId(separation.snapshot),
    )) notFound();
  }

  // Multi-entity 2316 is available only against a released, frozen final-pay
  // employer. Do not mount an unusable or misleading tenant-wide preview.
  if (entityScope.context.enabled && selectedSeparationId === null) {
    return <p>Select a released final-pay separation to prepare Form 2316.</p>;
  }

  return <>
    <p data-organization-id={organizationId} className="mx-auto max-w-5xl px-6 pt-5 text-sm text-slate-600">
      Authorized payroll employer: #{organizationId}
    </p>
    <Certificate2316Review
      key={String(organizationId) + ":" + String(selectedWorkerId ?? "none") + ":" + String(selectedSeparationId ?? "none")}
      organizationId={organizationId}
      initialEmployeeId={selectedWorkerId === null ? "" : String(selectedWorkerId)}
      initialTaxYear={String(selectedYear)}
      separationId={selectedSeparationId === null ? undefined : String(selectedSeparationId)} />
  </>;
}
