import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities } from "@/db/schema";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { loadBirAnnualEmployerSource } from "@/lib/bir-annual-employer-source";
import { requireSensitiveActionMfa } from "@/lib/security-request";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";

export const dynamic = "force-dynamic";

/** Read-only. Never exposes decrypted TINs or changes annual settlements. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const taxYear = Number(url.searchParams.get("taxYear"));
  const legalEntityId = Number(url.searchParams.get("legalEntityId") ?? 0);
  const mode = url.searchParams.get("mode") ?? "reconcile";
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(taxYear) || taxYear < 2018 || taxYear > 2100) {
    return Response.json({ error: "A valid organizationId and taxYear are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll operators may review annual BIR records.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Annual BIR reporting requires company-wide payroll access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const scope = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!scope.ok) return scope.response;

  if (mode === "employers") {
    const options = await db.select({
      id: legalEntities.id, code: legalEntities.code, legalName: legalEntities.legalName,
      primaryEntity: legalEntities.primaryEntity,
    }).from(legalEntities).where(and(
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
      scope.context.enabled && scope.context.legalEntityId !== null
        ? eq(legalEntities.id, scope.context.legalEntityId) : undefined,
    ));
    return Response.json({ employers: options }, {
      headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
    });
  }
  if (mode !== "reconcile") {
    return Response.json({ error: "Unknown BIR reconciliation mode." }, { status: 400 });
  }
  if (!Number.isSafeInteger(legalEntityId) || legalEntityId <= 0) {
    return Response.json({ error: "Select the exact legal employer before reconciling BIR compensation." }, { status: 400 });
  }
  const [employer] = await db.select({
    id: legalEntities.id, code: legalEntities.code, legalName: legalEntities.legalName,
  }).from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId),
    eq(legalEntities.organizationId, organizationId),
    eq(legalEntities.active, true),
  )).limit(1);
  if (!employer) return Response.json({ error: "Legal employer not found in this organization." }, { status: 404 });
  const entityDenied = assertEntityResource(scope.context, employer.id);
  if (entityDenied) return entityDenied;

  const source = await loadBirAnnualEmployerSource(organizationId, legalEntityId, taxYear);
  if (!source) return Response.json({ error: "Legal employer not found in this organization." }, { status: 404 });

  return Response.json({
    employer: source.employer,
    reconciliation: source.reconciliation,
    note: "Source cross-check only. No BIR DAT or official Form 2316 is generated or submitted.",
  }, { headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}
