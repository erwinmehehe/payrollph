import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { priorEvidenceEnabled } from "@/lib/year-end-prior-evidence-server";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { explicitPayrollReviewEmployerId } from "@/lib/tenant-payroll-review-page";
import { canonicalPriorReviewWorkerId } from "@/lib/tenant-prior-review-worker";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";
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

  // Match the prior-evidence API's legal-employer policy before mounting its
  // private client, including when the worker selector has not yet been chosen.
  const entityScope = await resolveMultiEntityContext({ userId: user.id, organizationId });
  if (!entityScope.ok || (entityScope.context.enabled && entityScope.context.group)) notFound();

  const selectedWorkerId = canonicalPriorReviewWorkerId(employeeId);
  if (selectedWorkerId === false) notFound();
  if (selectedWorkerId !== null) {
    // An employer-wide payroll role alone does not bind a caller-supplied
    // employee ID. Prove both employer and worker before reflecting it into
    // the SSR input, and then confirm the employee's legal-employer grant.
    // SQL errors must fail closed; this check is not inside a fallback catch.
    const [worker] = await db.select({ id: employees.id, legalEntityId: employees.legalEntityId })
      .from(employees)
      .where(and(
        eq(employees.organizationId, organizationId),
        eq(employees.id, selectedWorkerId),
      )).limit(1);
    if (!worker || (entityScope.context.enabled &&
        assertEntityResource(entityScope.context, worker.legalEntityId))) notFound();
  }

  return <>
    <p data-organization-id={organizationId} className="mx-auto max-w-5xl px-6 pt-5 text-sm text-slate-600">
      Authorized payroll employer: #{organizationId}
    </p>
    <YearEndPriorReview organizationId={organizationId} userId={user.id}
      employeeId={employeeId} taxYear={taxYear} />
  </>;
}
