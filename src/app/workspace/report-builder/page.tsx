import { notFound } from "next/navigation";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES, roleAllowed } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { explicitReportBuilderEmployerId } from "@/lib/tenant-report-builder";
import { TenantReportBuilder } from "@/components/workspace/tenant-report-builder";

export const dynamic = "force-dynamic";

export default async function ReportBuilderPage({
  searchParams,
}: { searchParams: Promise<{ organizationId?: string | string[] }> }) {
  const user = await getSessionUser();
  if (!user) return <p>Sign in to access reports.</p>;
  // Keep feature-OFF output unchanged. Flag-OFF content is not an own-page
  // tenant authorization positive.
  if (!criticalReleaseFlagEnabled("tenantReportBuilder")) return <p>Custom reports are not enabled.</p>;

  const params = await searchParams;
  const organizationId = explicitReportBuilderEmployerId(params.organizationId);
  if (!organizationId) notFound();

  // Never hand a caller-selected employer to the client report controls until
  // server-side active membership, company-wide role and deny-only permissions
  // have all passed. The API independently repeats its own report-data checks.
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !roleAllowed(access.role, PEOPLE_PAYROLL_ROLES)) notFound();
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES);
  if (denied) notFound();

  const [employer] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!employer) notFound();

  return <>
    <p className="mx-auto max-w-5xl px-6 pt-6 text-sm text-slate-600">
      Employer: <strong>{employer.name}</strong>
    </p>
    <TenantReportBuilder organizationId={organizationId} />
  </>;
}
