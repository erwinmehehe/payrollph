import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { organizations, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { isSelfServeOrganization } from "@/lib/saas-workspace-access";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES, primaryCompanyOrganizationId } from "@/lib/access";
import { canonicalPeoplePageOrganizationId } from "@/lib/tenant-people-page-employer";
import { resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { PeopleAnalyticsDashboard } from "@/components/people-analytics-dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "People Analytics | Linaw",
  robots: { index: false, follow: false },
};

export default async function PeopleAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { organizationId: raw } = await searchParams;
  const organizationId = raw === undefined
    ? await primaryCompanyOrganizationId(user.id)
    : canonicalPeoplePageOrganizationId(raw);
  if (!organizationId) notFound();

  // Mirror GET /api/reports company-wide role and custom permission gates.
  // Links, employee memberships and a bare organizationId never grant access.
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide) notFound();
  // Preserve the same self-service billing entry gate as /app.
  // A direct guide/dashboard URL must not bypass pending-payment access.
  if (await isSelfServeOrganization(organizationId)) {
    const [billing] = await db.select({ status: subscriptions.status })
      .from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
    if (!billing || billing.status === "pending_payment") {
      redirect(`/billing/setup?organizationId=${organizationId}`);
    }
  }

  const scope = await resolveMultiEntityContext({ userId: user.id, organizationId });
  if (!scope.ok || (scope.context.enabled && scope.context.legalEntityId !== null)) notFound();

  const [organization] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) notFound();

  return <PeopleAnalyticsDashboard key={organizationId}
    organizationId={organizationId} organizationName={organization.name} />;
}
