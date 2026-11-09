import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EngagementSurveyPage } from "@/components/engagement-survey-page";
import {
  assertMembership, assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES,
  primaryCompanyOrganizationId, primaryEmployeeOrganizationId,
} from "@/lib/access";
import { singleLegalEntityForTenant } from "@/lib/hcm-single-entity-scope";
import { canonicalPeoplePageOrganizationId } from "@/lib/tenant-people-page-employer";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Engagement Survey | Linaw", robots: { index: false } };

export default async function Page({ searchParams }: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (!criticalReleaseFlagEnabled("engagementSurvey")) notFound();
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const { organizationId: raw } = await searchParams;
  // Keep the authenticated primary-employer default for a missing selector,
  // but never turn a malformed/duplicated supplied selector into a fallback.
  const organizationId = raw === undefined
    ? session.role === "employee"
      ? await primaryEmployeeOrganizationId(session.id)
      : await primaryCompanyOrganizationId(session.id)
    : canonicalPeoplePageOrganizationId(raw);
  if (!organizationId) notFound();
  if (await assertMembership(session.id, organizationId)) notFound();

  // Match the underlying survey API's company-wide People/employee-only
  // boundary before mounting even its client shell. Group-wide surveys are
  // held until entity-scoped anonymity and privacy policy are reviewed.
  const access = await getAccess(session.id, organizationId);
  if (!access || (await singleLegalEntityForTenant(organizationId)) === null) notFound();
  if (access.role === "employee") {
    if (!Number.isSafeInteger(session.employeeId) || !session.employeeId) notFound();
  } else {
    if (!access.companyWide || !["owner", "admin", "hr"].includes(access.role)) notFound();
    if (await assertOrganizationRole(session.id, organizationId, PEOPLE_ADMIN_ROLES)) notFound();
  }
  return <EngagementSurveyPage organizationId={organizationId} />;
}
