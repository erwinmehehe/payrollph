import { sessions } from "@/db/schema";

/**
 * Column projection for any session query whose rows reach a client response.
 *
 * `tokenHash` is the sole bearer of session validity, returning it (even
 * hashed) would hand a reusable credential fragment to the browser for no
 * reason, and would let one listed device impersonate another. Every account
 * screen selects through this instead of a bare `db.select().from(sessions)`.
 */
export const safeSessionSelect = {
  id: sessions.id,
  userId: sessions.userId,
  createdAt: sessions.createdAt,
  expiresAt: sessions.expiresAt,
  revokedAt: sessions.revokedAt,
  lastSeenAt: sessions.lastSeenAt,
  userAgent: sessions.userAgent,
  ip: sessions.ip,
};
