import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { isTenantModuleId, TENANT_MODULES } from "@/lib/tenant-modules";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";
export const dynamic = "force-dynamic";

async function authorize(organizationId: number) {
  if (!criticalReleaseFlagEnabled("coreModuleNavigation")) return Response.json({ error: "Module disclosure is disabled." }, { status: 404 });
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const denied = await assertOrganizationRole(user.id, organizationId, ORG_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide administrator access required." }, { status: 403 });
  return user;
}
export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const auth = await authorize(organizationId);
  if (auth instanceof Response) return auth;
  const rows = await db.execute<{ mode: string; enabledModules: unknown }>(sql`
    SELECT module_navigation_mode AS mode, enabled_modules AS "enabledModules"
    FROM organizations WHERE id = ${organizationId} LIMIT 1`);
  const org = rows.rows[0];
  return Response.json({ ...org, catalog: TENANT_MODULES }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const user = await authorize(organizationId);
  if (user instanceof Response) return user;
  const demoDenied = publicDemoMutationDenied(user.email, "Module preferences");
  if (demoDenied) return demoDenied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const paidDenied = await requireSaasPaidWrites(organizationId);
  if (paidDenied) return paidDenied;
  if (!isTenantModuleId(body.moduleId) || typeof body.enabled !== "boolean") return Response.json({ error: "Choose a known module and an enable/disable value." }, { status: 400 });
  const saved = await db.transaction(async tx => {
    const rows = await tx.execute<{ mode: string; enabledModules: unknown }>(sql`
      SELECT module_navigation_mode AS mode, enabled_modules AS "enabledModules"
      FROM organizations WHERE id = ${organizationId} FOR UPDATE`);
    const org = rows.rows[0];
    if (!org) throw new Error("Employer not found.");
    const enabled = new Set((Array.isArray(org.enabledModules) ? org.enabledModules : []).filter(isTenantModuleId));
    if (body.enabled) enabled.add(body.moduleId); else enabled.delete(body.moduleId);
    const updated = await tx.execute<{ mode: string; enabledModules: unknown }>(sql`
      UPDATE organizations SET enabled_modules = ${JSON.stringify([...enabled])}::jsonb
      WHERE id = ${organizationId}
      RETURNING module_navigation_mode AS mode, enabled_modules AS "enabledModules"`);
    const result = updated.rows[0];
    // State and the immutable audit receipt must commit or roll back together.
    await tx.insert(auditEvents).values({ organizationId, actor: user.name, action: "Tenant module visibility updated", resource: body.moduleId, metadata: { enabled: body.enabled } });
    return result;
  });
  return Response.json(saved);
}
