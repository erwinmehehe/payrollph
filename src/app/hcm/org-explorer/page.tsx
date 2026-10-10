import { notFound, redirect } from "next/navigation";
import { HcmOrgExplorerClient } from "@/components/hcm-org-explorer";
import { getSessionUser } from "@/lib/auth";
import { denyHcmOrgExplorer, hcmOrgExplorerPositiveId } from "@/lib/hcm-org-explorer-access";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Organization & Positions | Linaw",
  robots: { index: false, follow: false },
};

/** No primary employer fallbacks: the selected employer must be explicit. */
export default async function HcmOrgExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_ORG_EXPLORER_ENABLED !== "true") notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const organizationId = hcmOrgExplorerPositiveId(
    typeof params.organizationId === "string" ? params.organizationId : null,
  );
  if (!organizationId) notFound();

  const denied = await denyHcmOrgExplorer(user.id, organizationId);
  if (denied) notFound();

  return <HcmOrgExplorerClient organizationId={organizationId} />;
}
