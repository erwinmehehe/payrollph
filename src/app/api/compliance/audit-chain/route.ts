import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { sealAuditEvents, verifyAuditChain } from "@/lib/audit-chain";

export const dynamic = "force-dynamic";

const AUDIT_CHAIN_ROLES = ["owner", "admin", "bookkeeper", "checker"] as const;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    AUDIT_CHAIN_ROLES,
    "Only company-wide Owner, Admin, Bookkeeper or Checker roles can verify the audit trail.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Audit trail verification is company-wide and is not available to unit-scoped roles." }, { status: 403 });
  }

  // Sealing is idempotent chain bookkeeping, not a business mutation; doing it
  // first keeps the report current when the scheduler is not enabled.
  await sealAuditEvents(5000);
  const report = await verifyAuditChain(organizationId);
  return Response.json({
    ...report,
    verifiedAt: new Date().toISOString(),
    note: report.pendingSealEvents > 0
      ? "Some events are not sealed into the hash chain yet. They are still protected from edits and deletes, and will be sealed on the next run."
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
