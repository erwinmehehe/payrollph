import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

/** Fail closed at the route boundary; existing /v1 endpoints are unchanged. */
export async function authorizeExtendedV1Read(request: Request, scope: string) {
  if (!criticalReleaseFlagEnabled("apiV1ExtendedReads")) {
    return { ok: false as const, response: Response.json({ error: "API extension unavailable." }, { status: 404 }) };
  }
  const limit = await rateLimitDistributed(`api-v1-extended:${clientIp(request)}`, {
    limit: 120, windowMs: 60_000,
  });
  if (!limit.allowed) {
    return { ok: false as const, response: Response.json({ error: "Rate limit exceeded." }, { status: 429 }) };
  }
  const auth = await authenticateApiKey(request);
  if (!auth.ok) {
    return { ok: false as const, response: Response.json({ error: auth.error }, { status: auth.status }) };
  }
  if (!requireScope(auth.scopes, scope)) {
    return { ok: false as const, response: Response.json({ error: "Missing required API scope." }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}

export function apiV1Page(searchParams: URLSearchParams, maxPageSize = 100) {
  const limit = Number(searchParams.get("limit") ?? 50);
  const offset = Number(searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageSize
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return null;
  return { limit, offset };
}
