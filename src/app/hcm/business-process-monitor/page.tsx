import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import {
  denyBpMonitor, positiveBpMonitorId,
} from "@/lib/hcm-business-process-monitor-access";
import { HcmBusinessProcessMonitor } from "@/components/hcm-business-process-monitor";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Business Process Monitor | Linaw",
  robots: { index: false, follow: false },
};

/** Do not infer a membership/tenant. Access is checked before rendering UI. */
export default async function BusinessProcessMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  if (process.env.HCM_BP_MONITOR_ENABLED !== "true") notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const organizationId = positiveBpMonitorId(
    typeof query.organizationId === "string" ? query.organizationId : null,
  );
  if (!organizationId) notFound();
  const denied = await denyBpMonitor(user.id, organizationId);
  if (denied) notFound();

  return <HcmBusinessProcessMonitor organizationId={organizationId} />;
}
