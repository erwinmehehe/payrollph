import { eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities } from "@/db/schema";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { publicApiV1RateGate } from "@/lib/public-api-v1-rate-guard";

export type ExtendedApiAccess =
  | { ok: true; organizationId: number; legalEntityId: number; keyId: number }
  | { ok: false; response: Response };

export async function authorizeExtendedApi(request: Request, scope: string): Promise<ExtendedApiAccess> {
  if (!criticalReleaseFlagEnabled("publicApiV1Extended")) {
    return { ok: false, response: Response.json({ error: "Not found." }, { status: 404 }) };
  }
  const limited = await rateLimitDistributed(`extended-api:${clientIp(request)}`, { limit: 120, windowMs: 60_000 });
  const rateDenied = publicApiV1RateGate(limited);
  if (rateDenied) return { ok: false, response: rateDenied };
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return { ok: false, response: Response.json({ error: auth.error }, { status: auth.status }) };
  if (!requireScope(auth.scopes, scope)) {
    return { ok: false, response: Response.json({ error: `API key requires ${scope}.` }, { status: 403 }) };
  }
  const entityRows = await db.select({ id: legalEntities.id }).from(legalEntities)
    .where(eq(legalEntities.organizationId, auth.organizationId)).limit(2);
  if (entityRows.length !== 1) {
    return { ok: false, response: Response.json({
      error: "This API is limited to one verified legal employer until entity-scoped tokens are reviewed.",
    }, { status: 409 }) };
  }
  return { ok: true, organizationId: auth.organizationId, legalEntityId: entityRows[0].id, keyId: auth.keyId };
}

export function pagination(url: URL, maxLimit = 100) {
  const rawLimit = Number(url.searchParams.get("limit") ?? 25);
  const rawCursor = Number(url.searchParams.get("after") ?? 0);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > maxLimit
      || !Number.isSafeInteger(rawCursor) || rawCursor < 0) return null;
  return { limit: rawLimit, after: rawCursor };
}
