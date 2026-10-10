import { notFound, redirect } from "next/navigation";
import { HcmBpMonitorClient } from "@/components/hcm-bp-monitor";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Business Process Monitor | Linaw",
  robots: { index: false, follow: false },
};

function positiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Explicit selected employer: no fallback to an unrelated first membership. */
export default async function HcmBpMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_BP_MONITOR_ENABLED !== "true") notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const organizationId = positiveId(params.organizationId);
  if (!organizationId) notFound();

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide HR monitoring is required.",
  );
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    notFound();
  }

  return <HcmBpMonitorClient organizationId={organizationId} />;
}
