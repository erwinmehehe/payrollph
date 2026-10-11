import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HcmManagerDecisionInbox } from "@/components/hcm-manager-decision-inbox";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { deriveManagerDecisionScope } from "@/lib/hcm-manager-decision-contract";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Manager Decision Inbox | Linaw HCM",
  robots: { index: false, follow: false },
};

function positiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** The employer is always explicitly selected; never choose first membership. */
export default async function HcmManagerDecisionInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_MANAGER_DECISION_INBOX_ENABLED !== "true") notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const organizationId = positiveId((await searchParams).organizationId);
  if (!organizationId) notFound();
  const denied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "Manager or People oversight access is required.",
  );
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !deriveManagerDecisionScope(access)) notFound();

  // Key forces a complete query/filter reset on employer switches.
  return <HcmManagerDecisionInbox key={organizationId} organizationId={organizationId} />;
}
