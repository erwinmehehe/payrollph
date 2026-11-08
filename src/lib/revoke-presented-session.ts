import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { sha256 } from "@/lib/crypto";

/**
 * Logout-only revoke: an already-revoked cookie must not rewrite the original
 * revocation timestamp. The token hash and revoked_at NULL guard are applied
 * atomically in a single UPDATE; no user/session ID is supplied by the client.
 * The logout route enforces same-origin before invoking this helper.
 */
export async function revokePresentedSessionOnce(token: string) {
  await db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(sessions.tokenHash, sha256(token)),
      isNull(sessions.revokedAt),
    ));
}
