import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities } from "@/db/schema";
import { entityConfirmationMatches } from "@/lib/multi-entity-policy";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";

/** Release-flagged guard for resource-addressed payroll mutations and approvals. */
export async function requireRunEmployer(input: {
  request: Request; userId: number; organizationId: number;
  legalEntityId: number | null; confirmation?: string;
  requireConfirmation?: boolean;
}): Promise<Response | null> {
  const resolved = await resolveMultiEntityContext({
    userId: input.userId, organizationId: input.organizationId, request: input.request,
  });
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.context;
  if (!ctx.enabled) return null;
  const denied = assertEntityResource(ctx, input.legalEntityId);
  if (denied) return denied;
  const [entity] = await db.select({ legalName: legalEntities.legalName })
    .from(legalEntities).where(and(eq(legalEntities.organizationId, input.organizationId),
      eq(legalEntities.id, input.legalEntityId!))).limit(1);
  if (!entity) return Response.json({ error: "Payroll legal employer not found." }, { status: 404 });
  if (input.requireConfirmation && !entityConfirmationMatches(entity.legalName, input.confirmation ?? ""))
    return Response.json({
      error: "Type the exact legal employer name before approving or releasing payroll.",
      code: "ENTITY_CONFIRMATION_REQUIRED",
    }, { status: 422 });
  return null;
}
