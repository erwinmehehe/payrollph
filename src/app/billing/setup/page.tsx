import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  BILLING_ADMIN_ROLES,
  getAccess,
  primaryCompanyOrganizationId,
} from "@/lib/access";
import { SubscriptionManager } from "@/components/billing/subscription-manager";
import { SiteNav, SiteFooter } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up billing | Linaw", robots: { index: false, follow: false } };

export default async function BillingSetupPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const organizationId = await primaryCompanyOrganizationId(user.id);
  if (!organizationId) redirect("/app");

  // The server-rendered page exposes the employer name and checkout entrypoint.
  // Enforce the same active, company-wide billing grant as the billing API
  // before reading or rendering any organization-specific information.
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    BILLING_ADMIN_ROLES,
    "Only billing administrators can view or change subscription billing.",
  );
  if (denied) notFound();

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) notFound();

  const [org] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) notFound();

  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <SiteNav />
      <main className="px-5 py-12 sm:px-8">
        <SubscriptionManager organizationId={organizationId} companyName={org.name} />
      </main>
      <SiteFooter />
    </div>
  );
}
