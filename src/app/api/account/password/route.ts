import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { primaryOrganizationId } from "@/lib/access";
import {
  createSession,
  getSessionUser,
  revokeAllSessions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { passwordChangeIssues } from "@/lib/account";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { demoMutationBlocked } from "@/lib/demo";

export const dynamic = "force-dynamic";

/**
 * Change password with the current password required.
 *
 * Every session is revoked and a fresh one is issued to this browser, so a
 * stolen cookie cannot outlive the credential it was minted from. Rate limited
 * because the endpoint accepts a password.
 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`pwchange:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes.", mode: limited.mode }, { status: 429 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (user.demo) return demoMutationBlocked("Changing the password");

  const body = await request.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!account) return Response.json({ error: "Account not found." }, { status: 404 });

  const currentOk = verifyPassword(currentPassword, account.passwordHash);
  // Two distinct facts, previously conflated: does the supplied current password
  // authenticate, and is the NEW password identical to the existing one.
  const reusesCurrent = newPassword.length > 0 && verifyPassword(newPassword, account.passwordHash);
  const problems = passwordChangeIssues({
    currentPassword,
    newPassword,
    confirmPassword,
    reusesCurrent,
  });
  if (currentPassword && !currentOk) {
    problems.unshift("Your current password is not correct.");
  }
  if (problems.length > 0) {
    return Response.json({ error: "Password not changed.", problems: [...new Set(problems)] }, { status: 422 });
  }

  const changedAt = new Date();
  await db.update(users).set({
    passwordHash: hashPassword(newPassword),
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(users.id, account.id));

  const revoked = await revokeAllSessions(account.id);

  // Issue the replacement session for this device only.
  const { token, expiresAt } = await createSession(
    account.id,
    requestMeta(request),
    { passwordChangedAt: changedAt },
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  await recordAuditEvent({
    organizationId: await primaryOrganizationId(account.id),
    actor: user.name,
    action: "Password changed",
    resource: account.email,
    metadata: { sessionsRevoked: revoked, method: "self-service" },
  });

  return Response.json({
    ok: true,
    message: "Password updated.",
    otherSessionsRevoked: Math.max(0, revoked - 1),
    note: "Your other devices have been signed out.",
  });
}
