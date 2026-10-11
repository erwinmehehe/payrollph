import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HcmTeamLeaveCalendar } from "@/components/hcm-team-leave-calendar";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  currentPhilippineMonth, deriveTeamLeaveScope,
} from "@/lib/hcm-team-leave-calendar-contract";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Team Leave Calendar | Linaw HCM",
  robots: { index: false, follow: false },
};

function positiveId(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** Explicit employer and server-side feature gate; no first-company fallback. */
export default async function TeamLeaveCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_TEAM_LEAVE_CALENDAR_ENABLED !== "true") notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  const organizationId = positiveId((await searchParams).organizationId);
  if (!organizationId) notFound();

  const denied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "An authorized manager or People oversight member is required.",
  );
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !deriveTeamLeaveScope(access)) notFound();

  const month = currentPhilippineMonth(new Date());
  return (
    <HcmTeamLeaveCalendar
      key={organizationId}
      organizationId={organizationId}
      initialMonth={month}
    />
  );
}
