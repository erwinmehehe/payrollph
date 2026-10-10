import { notFound, redirect } from "next/navigation";
import { HcmMyTeamClient } from "@/components/hcm-my-team";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My Team | Linaw HCM",
  robots: { index: false, follow: false },
};

function positiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** Requires an explicitly chosen company, never a fallback employer. */
export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_MY_TEAM_ENABLED !== "true") notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const organizationId = positiveId(params.organizationId);
  if (!organizationId) notFound();

  const denied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "An authorized manager or HR account is required.",
  );
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !deriveMyTeamScope(access)) notFound();

  return <HcmMyTeamClient organizationId={organizationId} />;
}
