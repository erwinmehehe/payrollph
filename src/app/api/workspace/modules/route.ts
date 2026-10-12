import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { recordAuditEvent } from "@/lib/audit";
import { ALL_ITEMS, CORE_ONLY_PAGES } from "@/components/workspace/nav";
export const dynamic = "force-dynamic";
const allowed = new Set(ALL_ITEMS.map(item => item.name).filter(name => ![...CORE_ONLY_PAGES, "More modules"].includes(name)));
export async function PATCH(request: Request) {
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser(); if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Module visibility"); if (demo) return demo;
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return Response.json({ error: "Invalid organization" }, { status: 400 });
  const denied = await assertOrganizationRole(user.id, organizationId, ["owner", "admin"], "Administrator access required");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide access required" }, { status: 403 });
  if (!["core_only", "all"].includes(body.mode) || !Array.isArray(body.modules) ||
      body.modules.length > allowed.size || body.modules.some((name: unknown) => typeof name !== "string" || !allowed.has(name)))
    return Response.json({ error: "Invalid module selection" }, { status: 422 });
  const enabledModules = [...new Set(body.modules as string[])];
  const [updated] = await db.update(organizations).set({ moduleVisibility: body.mode, enabledModules })
    .where(eq(organizations.id, organizationId)).returning({ id: organizations.id });
  if (!updated) return Response.json({ error: "Organization not found" }, { status: 404 });
  await recordAuditEvent({ organizationId, actor: user.name, action: "Workspace modules changed", resource: String(organizationId), metadata: { mode: body.mode, enabledModules } });
  return Response.json({ ok: true });
}
