import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities } from "@/db/schema";
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
  // API tokens are tenant-scoped, not legal-employer scoped. Do not expose
  // multi-employer payroll data until RFC B-8 defines group-HR token grants.
  const employerRows = await db.select({id:legalEntities.id}).from(legalEntities)
    .where(and(eq(legalEntities.organizationId,auth.organizationId),
      eq(legalEntities.active,true))).limit(2);
  if (extendedV1NeedsEntityScope(employerRows.length)) {
    return { ok: false as const, response: Response.json({
      error:"Exactly one verified active legal employer is required for this tenant-scoped API extension.",
    },{status:403}) };
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

/** Tenant-level API keys cannot infer employer ownership from zero or multiple active entities. */
export function extendedV1NeedsEntityScope(activeLegalEmployers: number) {
  return !Number.isSafeInteger(activeLegalEmployers) || activeLegalEmployers !== 1;
}

/** Invalid ISO dates return HTTP 400; do not throw from toISOString on NaN. */
export function validApiV1DateOnly(input: unknown): input is string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const timestamp = Date.parse(input + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === input;
}
