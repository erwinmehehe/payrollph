import { authorizeExtendedApi } from "@/lib/public-api-v1-extended";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** Additive API feeds require BOTH the existing scoped public API gate and
 * the independent extension flag. The canonical API token authorization and
 * exact one-legal-employer boundary are reused, never reimplemented. */
export async function authorizeExtendedV1Read(request: Request, scope: string) {
  if (!criticalReleaseFlagEnabled("apiV1ExtendedReads")) {
    return { ok: false as const, response: Response.json({ error: "API extension unavailable." }, { status: 404 }) };
  }
  const gate = await authorizeExtendedApi(request, scope);
  if (!gate.ok) return { ok: false as const, response: gate.response };
  return { ok: true as const, auth: {
    organizationId: gate.organizationId,
    legalEntityId: gate.legalEntityId,
    keyId: gate.keyId,
  } };
}

export function apiV1Page(searchParams: URLSearchParams, maxPageSize = 100) {
  const limitRaw=searchParams.getAll("limit");
  const offsetRaw=searchParams.getAll("offset");
  // Reject duplicate and coercible forms such as hexadecimal and scientific
  // notation; clients must use a single canonical decimal pagination value.
  if(limitRaw.length>1||offsetRaw.length>1 ||
    (limitRaw.length===1&&!/^[1-9]\d*$/.test(limitRaw[0])) ||
    (offsetRaw.length===1&&!/^(?:0|[1-9]\d*)$/.test(offsetRaw[0])))return null;
  const limit=limitRaw.length?Number(limitRaw[0]):50;
  const offset=offsetRaw.length?Number(offsetRaw[0]):0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageSize
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return null;
  return { limit, offset };
}

/** A tenant-only token cannot choose a second or unverified employer. */
export function extendedV1NeedsEntityScope(activeLegalEmployers: number) {
  return !Number.isSafeInteger(activeLegalEmployers) || activeLegalEmployers !== 1;
}

export function scopedJournalEntityId(raw: string | null, authorized: number): number | null {
  if (!Number.isSafeInteger(authorized) || authorized <= 0) return null;
  if (raw === null) return authorized;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw) === authorized ? authorized : null;
}

export function validApiV1DateOnly(input: unknown): input is string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const timestamp = Date.parse(input + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === input;
}
