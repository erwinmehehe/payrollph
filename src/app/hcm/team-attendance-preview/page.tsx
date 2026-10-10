import { notFound, redirect } from "next/navigation";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";
import { HcmTeamAttendancePreviewClient } from "@/components/hcm-team-attendance-preview";
export const dynamic = "force-dynamic";
export const metadata = { title: "Team Attendance Preview | Linaw HCM", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_TEAM_ATTENDANCE_PREVIEW_ENABLED !== "true") notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  if (typeof params.organizationId !== "string" || !/^[1-9][0-9]*$/.test(params.organizationId)) notFound();
  const organizationId = Number(params.organizationId);
  if (!Number.isSafeInteger(organizationId)) notFound();
  const denied = await assertOrganizationRole(user.id, organizationId, WORKFORCE_MANAGER_ROLES);
  if (denied || !deriveMyTeamScope(await getAccess(user.id, organizationId))) notFound();
  return <HcmTeamAttendancePreviewClient key={organizationId} organizationId={organizationId} />;
}
