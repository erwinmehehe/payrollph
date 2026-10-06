import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizationSecurityPolicies, sessions, userOrganizations, users } from "@/db/schema";

export type EffectiveSessionPolicy = {
  idleMinutes: number;
  maxHours: number;
  maxActiveSessions: number;
  requireMfa: boolean;
};

const DEFAULT_POLICY: EffectiveSessionPolicy = {
  idleMinutes: 24 * 60,
  maxHours: 14 * 24,
  maxActiveSessions: 10,
  requireMfa: false,
};

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export async function effectiveSessionPolicyForUser(userId: number): Promise<EffectiveSessionPolicy> {
  const memberships = await db.select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)));
  if (memberships.length === 0) return DEFAULT_POLICY;

  const policies = await db.select().from(organizationSecurityPolicies)
    .where(inArray(organizationSecurityPolicies.organizationId, memberships.map((row) => row.organizationId)));
  if (policies.length === 0) return DEFAULT_POLICY;

  return {
    idleMinutes: Math.min(DEFAULT_POLICY.idleMinutes, ...policies.map((row) => clampInt(row.sessionIdleMinutes, 15, 7 * 24 * 60, DEFAULT_POLICY.idleMinutes))),
    maxHours: Math.min(DEFAULT_POLICY.maxHours, ...policies.map((row) => clampInt(row.sessionMaxHours, 1, 30 * 24, DEFAULT_POLICY.maxHours))),
    maxActiveSessions: Math.min(DEFAULT_POLICY.maxActiveSessions, ...policies.map((row) => clampInt(row.maxActiveSessions, 1, 20, DEFAULT_POLICY.maxActiveSessions))),
    requireMfa: policies.some((row) => row.requireMfa),
  };
}

export async function organizationSecurityPolicy(organizationId: number) {
  const [row] = await db.select().from(organizationSecurityPolicies)
    .where(eq(organizationSecurityPolicies.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

export async function organizationMfaReadiness(organizationId: number) {
  const memberships = await db.select({ userId: userOrganizations.userId })
    .from(userOrganizations)
    .where(and(eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.active, true)));
  if (memberships.length === 0) return { total: 0, ready: 0, notReadyUserIds: [] as number[] };
  const memberUsers = await db.select({ id: users.id, totpEnabled: users.totpEnabled, active: users.active, localPasswordEnabled: users.localPasswordEnabled })
    .from(users)
    .where(inArray(users.id, memberships.map((row) => row.userId)));
  const localActive = memberUsers.filter((row) => row.active && row.localPasswordEnabled);
  const notReadyUserIds = localActive.filter((row) => !row.totpEnabled).map((row) => row.id);
  return { total: localActive.length, ready: localActive.length - notReadyUserIds.length, notReadyUserIds };
}

export async function enforceActiveSessionLimit(userId: number, keepSessionId: number, maxActiveSessions: number) {
  const active = await db.select({ id: sessions.id }).from(sessions)
    .where(and(
      eq(sessions.userId, userId),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
    ))
    .orderBy(asc(sessions.createdAt), asc(sessions.id));

  const excess = Math.max(0, active.length - maxActiveSessions);
  if (excess === 0) return 0;
  const ids = active.filter((row) => row.id !== keepSessionId).slice(0, excess).map((row) => row.id);
  if (ids.length === 0) return 0;
  await db.update(sessions).set({ revokedAt: new Date() }).where(inArray(sessions.id, ids));
  return ids.length;
}
