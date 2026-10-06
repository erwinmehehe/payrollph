import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { shouldRevokeOnCredentialChange } from "@/lib/account";
import { effectiveSessionPolicyForUser, enforceActiveSessionLimit } from "@/lib/enterprise-session";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-linaw_session" : "linaw_session";
export const SESSION_DAYS = 14;
const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
// Only write a "last seen" timestamp if it is older than this, so the read path
// does not issue a database write on every single request.
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export type SessionMeta = { userAgent?: string | null; ip?: string | null };

export async function createSession(
  userId: number,
  meta: SessionMeta = {},
  options: {
    passwordChangedAt?: Date;
    mfaVerifiedAt?: Date | null;
    authMethod?: "local" | "oidc";
    identityProviderId?: number | null;
  } = {},
) {
  const token = randomToken(32);
  const policy = await effectiveSessionPolicyForUser(userId);
  const expiresAt = new Date(Date.now() + policy.maxHours * 60 * 60 * 1000);
  const [created] = await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
    ip: meta.ip ? meta.ip.slice(0, 64) : null,
    lastSeenAt: new Date(),
    passwordChangedAt: options.passwordChangedAt ?? null,
    mfaVerifiedAt: options.mfaVerifiedAt ?? null,
    authMethod: options.authMethod ?? "local",
    identityProviderId: options.identityProviderId ?? null,
  }).returning({ id: sessions.id });
  await enforceActiveSessionLimit(userId, created.id, policy.maxActiveSessions);
  return { token, expiresAt };
}

/**
 * Revokes every session for a user. Used by the password change, which then
 * issues a brand-new session: if the old token were merely "kept", the browser
 * cookie would move to the new token while the old one stayed valid and could
 * no longer be revoked from the UI.
 */
export async function revokeAllSessions(userId: number) {
  return revokeOtherSessions(userId, null);
}

export async function revokeSession(token: string) {
  await db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, sha256(token)));
}

/**
 * Used after a password or email change: every session except the one that made
 * the change is revoked, so a stolen token cannot outlive the credential it was
 * issued against. Returns how many sessions were revoked.
 */
export async function revokeOtherSessions(userId: number, keepSessionId: number | null) {
  const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));

  // The tested predicate decides what is revoked so the rule cannot drift from
  // the tests: keep the live session, drop every other non-revoked one.
  const toRevoke = rows
    .filter((row) => shouldRevokeOnCredentialChange(row, keepSessionId))
    .map((row) => row.id);
  if (toRevoke.length === 0) return 0;

  await db.update(sessions).set({ revokedAt: new Date() }).where(inArray(sessions.id, toRevoke));
  return toRevoke.length;
}

export async function revokeSessionsByIds(ids: number[]) {
  if (ids.length === 0) return 0;
  await db.update(sessions).set({ revokedAt: new Date() }).where(inArray(sessions.id, ids));
  return ids.length;
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      user: users,
      session: sessions,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.tokenHash, sha256(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
    ))
    .limit(1);

  if (!row) return null;

  if (!row.user.active) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.session.id));
    return null;
  }

  const policy = await effectiveSessionPolicyForUser(row.user.id);
  const createdAt = new Date(row.session.createdAt).getTime();
  if (Date.now() - createdAt > policy.maxHours * 60 * 60 * 1000) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (policy.requireMfa && !row.session.mfaVerifiedAt) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.session.id));
    return null;
  }
  const lastSeen = row.session.lastSeenAt ? new Date(row.session.lastSeenAt).getTime() : 0;
  const idleTimeoutMs = Number.isFinite(policy.idleMinutes)
    ? policy.idleMinutes * 60 * 1000
    : SESSION_IDLE_TIMEOUT_MS;
  if (lastSeen && Date.now() - lastSeen > idleTimeoutMs) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.session.id));
    return null;
  }
  await enforceActiveSessionLimit(row.user.id, row.session.id, policy.maxActiveSessions);
  if (Date.now() - lastSeen > LAST_SEEN_WRITE_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  }

  return {
    id: row.user.id,
    employeeId: row.user.employeeId ?? null,
    email: row.user.email,
    name: row.user.name,
    role: row.user.role,
    totpEnabled: row.user.totpEnabled,
    sessionToken: token,
    sessionId: row.session.id,
    sessionExpiresAt: row.session.expiresAt,
    passwordChangedAt: row.session.passwordChangedAt ?? null,
    mfaVerifiedAt: row.session.mfaVerifiedAt ?? null,
    authMethod: row.session.authMethod ?? "local",
    identityProviderId: row.session.identityProviderId ?? null,
    sessionPolicy: policy,
  };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    priority: "high" as const,
  };
}

export function publicUser(user: {
  id: number;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  employeeId?: number | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    totpEnabled: user.totpEnabled,
    employeeId: user.employeeId ?? null,
  };
}
