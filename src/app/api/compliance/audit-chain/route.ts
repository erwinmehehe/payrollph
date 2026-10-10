import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { verifyAuditChain } from "@/lib/audit-chain";

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

  const report = await verifyAuditChain(organizationId);
  return Response.json({
    ...report,
    verifiedAt: new Date().toISOString(),
    note: report.legacyUnchainedEvents > 0
      ? "Events recorded before tamper-evident chaining was enabled are listed as legacy and are not covered by the hash chain."
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
