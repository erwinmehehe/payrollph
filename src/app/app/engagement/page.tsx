import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EngagementSurveyPage } from "@/components/engagement-survey-page";
import {
  assertMembership, primaryCompanyOrganizationId, primaryEmployeeOrganizationId,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Engagement Survey | Linaw", robots: { index: false } };

export default async function Page({ searchParams }: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  if (!criticalReleaseFlagEnabled("engagementSurvey")) notFound();
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const { organizationId: raw } = await searchParams;
  const organizationId = raw
    ? Number(raw)
    : session.role === "employee"
      ? await primaryEmployeeOrganizationId(session.id)
      : await primaryCompanyOrganizationId(session.id);
  if (!organizationId || !Number.isSafeInteger(organizationId)) notFound();
  if (await assertMembership(session.id, organizationId)) notFound();
  return <EngagementSurveyPage organizationId={organizationId} />;
}
