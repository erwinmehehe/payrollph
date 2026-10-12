import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { userEntityPreferences } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Multi-entity is disabled." }, { status: 404 });

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("multiEntity")) return unavailable();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return Response.json({ error: "Invalid tenant." }, { status: 400 });
  const result = await resolveMultiEntityContext({ userId: user.id, organizationId });
  if (!result.ok) return result.response;
  return Response.json(result.context, { headers: { "Cache-Control": "no-store, private" } });
}

export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("multiEntity")) return unavailable();
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return Response.json({ error: "Invalid tenant." }, { status: 400 });
  const chosen = body.legalEntityId === null || body.legalEntityId === "all"
    ? "all" : String(body.legalEntityId ?? "");
  if (chosen !== "all" && !/^[1-9]\d*$/.test(chosen))
    return Response.json({ error: "Invalid legal entity." }, { status: 400 });
  const result = await resolveMultiEntityContext({
    userId: user.id, organizationId, requested: chosen,
  });
  if (!result.ok) return result.response;
  // The scoped role always has one fixed scope. There is no switcher for it.
  if (!result.context.group && chosen === "all")
    return Response.json({ error: "Only group roles can select all entities." }, { status: 403 });
  await db.insert(userEntityPreferences).values({
    userId: user.id, organizationId, legalEntityId: result.context.legalEntityId,
  }).onConflictDoUpdate({
    target: [userEntityPreferences.organizationId, userEntityPreferences.userId],
    set: { legalEntityId: result.context.legalEntityId, updatedAt: sql`now()` },
  });
  await recordAuditEvent({
    organizationId, actor: user.name, action: "Entity context changed",
    resource: result.context.legalEntityId ? "Legal entity" : "All entities",
    metadata: { legalEntityId: result.context.legalEntityId, actorUserId: user.id },
  });
  return Response.json({ legalEntityId: result.context.legalEntityId });
}
