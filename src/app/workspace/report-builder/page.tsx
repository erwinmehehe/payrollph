import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { TenantReportBuilder } from "@/components/workspace/tenant-report-builder";

export default async function ReportBuilderPage({
  searchParams,
}: { searchParams: Promise<{ organizationId?: string }> }) {
  const user = await getSessionUser();
  if (!user) return <p>Sign in to access reports.</p>;
  if (!criticalReleaseFlagEnabled("tenantReportBuilder")) return <p>Custom reports are not enabled.</p>;
  const params = await searchParams;
  const organizationId = Number(params.organizationId ?? 0);
  if (!Number.isSafeInteger(organizationId) || organizationId < 1) return <p>Select an employer first.</p>;
  return <TenantReportBuilder organizationId={organizationId} />;
}
