import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canonicalTenantPageId } from "@/lib/tenant-page-id";
import {
  assertOrganizationRole,
  BILLING_ADMIN_ROLES,
  getAccess,
  primaryCompanyOrganizationId,
} from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Manage billing | Linaw",
  robots: { index: false, follow: false },
};

/**
 * Legacy billing URL. Redirect only after confirming that the selected company
 * belongs to this session and that the member has company-wide billing access.
 * In particular, never send a B-company administrator to A's subscription
 * screen by silently dropping the organizationId query parameter.
 */
export default async function ManageBilling({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const selected = (await searchParams).organizationId;
  const organizationId = selected === undefined
    ? await primaryCompanyOrganizationId(user.id)
    : canonicalTenantPageId(selected);
  // An explicitly supplied invalid/duplicate employer never falls back.
  if (!organizationId) notFound();

  const denied = await assertOrganizationRole(user.id, organizationId, BILLING_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide) notFound();

  // A temporary, explicitly scoped redirect cannot be cached as a permanent
  // cross-tenant target. Billing setup rechecks the full permission gate.
  redirect(`/billing/setup?organizationId=${organizationId}`);
}
