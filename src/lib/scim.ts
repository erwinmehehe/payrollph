import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { scimTokens } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { rateLimitDistributed } from "@/lib/rate-limit";

export function mintScimToken() {
  const secret = randomBytes(32).toString("base64url");
  const token = "scim_live_" + secret;
  return {
    token,
    prefix: token.slice(0, 18),
    tokenHash: sha256(token),
  };
}

export async function authenticateScim(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false as const, status: 401, error: "Missing SCIM bearer token." };

  const [row] = await db.select().from(scimTokens).where(and(
    eq(scimTokens.tokenHash, sha256(token)),
    isNull(scimTokens.revokedAt),
  )).limit(1);
  if (!row) return { ok: false as const, status: 401, error: "Invalid or revoked SCIM token." };

  const limited = await rateLimitDistributed("scim-token:" + row.id, { limit: 180, windowMs: 60_000 });
  if (!limited.allowed) return { ok: false as const, status: 429, error: "SCIM token rate limit exceeded." };

  await db.update(scimTokens).set({ lastUsedAt: new Date() }).where(eq(scimTokens.id, row.id));
  return { ok: true as const, organizationId: row.organizationId, tokenId: row.id };
}

export function scimError(status: number, detail: string) {
  return Response.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  }, {
    status,
    headers: { "Content-Type": "application/scim+json" },
  });
}
