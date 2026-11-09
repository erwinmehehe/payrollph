import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import HcmWorkQueue from "@/components/hcm-work-queue";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { parseHcmWorkItemsEmployerId } from "@/lib/hcm-work-items-page-tenancy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "HR Work Queue | Linaw",
  robots: { index: false, follow: false },
};

/**
 * Page-level authorization is required before mounting the interactive queue.
 * The GET/PATCH API independently repeats membership, role and company-wide checks.
 */
export default async function HcmWorkItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const organizationId = parseHcmWorkItemsEmployerId((await searchParams).organizationId);
  if (!organizationId) notFound();

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) notFound();
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) notFound();

  return <HcmWorkQueue key={organizationId} authorizedOrganizationId={organizationId} />;
}
