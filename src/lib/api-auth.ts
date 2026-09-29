import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { isPublicDemoOrganization } from "@/lib/public-demo-guard";

export { mintApiKey, requireScope } from "@/lib/api-keys";

export async function authenticateApiKey(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : request.headers.get("x-api-key")?.trim() ?? "";

  if (!token) {
    return { ok: false as const, status: 401, error: "Missing API key. Send 'Authorization: Bearer sk_live_...'." };
  }

  const [row] = await db.select().from(apiKeys).where(and(
    eq(apiKeys.keyHash, sha256(token)),
    isNull(apiKeys.revokedAt),
  )).limit(1);

  if (!row || await isPublicDemoOrganization(row.organizationId)) {
    return { ok: false as const, status: 401, error: "Invalid or revoked API key." };
  }

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

  return {
    ok: true as const,
    organizationId: row.organizationId,
    scopes: Array.isArray(row.scopes) ? row.scopes as string[] : [],
    keyId: row.id,
  };
}


