import { notFound, redirect } from "next/navigation";
import { Worker360Client } from "@/components/hcm-worker-360";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { philippineWorker360Date } from "@/lib/hcm-worker-360-projection";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Worker 360 | Linaw",
  robots: { index: false, follow: false },
};

function positiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Requires an explicitly requested, authorized employer. Never choose the first membership. */
export default async function Worker360Page({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string; employeeId?: string }>;
}) {
  if (process.env.HCM_WORKER_360_ENABLED !== "true") notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  const organizationId = positiveId(query.organizationId);
  const employeeId = positiveId(query.employeeId);
  if (!organizationId || !employeeId) notFound();

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide People administration is required.",
  );
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) notFound();

  return (
    <Worker360Client
      organizationId={organizationId}
      employeeId={employeeId}
      initialAsOfDate={philippineWorker360Date()}
    />
  );
}
