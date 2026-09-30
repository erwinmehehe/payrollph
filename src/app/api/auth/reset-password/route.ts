import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { hashPassword, sha256 } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import { primaryOrganizationId } from "@/lib/access";
import { revokeAllSessions } from "@/lib/auth";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { passwordIssues } from "@/lib/validation";
import { enforceSameOriginMutation } from "@/lib/security-request";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`reset:${ip}`, { limit: 8, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({
      error: "Too many reset attempts.",
      retryAfterMs: limited.retryAfterMs,
      rateLimitMode: limited.mode,
    }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token) {
    return Response.json({ error: "A valid reset token is required." }, { status: 400 });
  }
  if (token.length > 256) {
    return Response.json({ error: "Reset token is invalid or expired." }, { status: 400 });
  }
  const tokenLimited = await rateLimitDistributed(`reset-token:${sha256(token)}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!tokenLimited.allowed) {
    return Response.json({ error: "Too many reset attempts." }, { status: 429 });
  }
  const problems = passwordIssues(password);
  if (problems.length > 0) {
    return Response.json({ error: "Password does not meet security requirements.", problems }, { status: 422 });
  }

  const [row] = await db.select().from(passwordResetTokens).where(and(
    eq(passwordResetTokens.tokenHash, sha256(token)),
    isNull(passwordResetTokens.usedAt),
    gt(passwordResetTokens.expiresAt, new Date()),
  )).limit(1);

  if (!row) return Response.json({ error: "Reset token is invalid or expired." }, { status: 400 });

  const passwordHash = hashPassword(password);
  const changedAt = new Date();
  const reset = await db.transaction(async (tx) => {
    // Claim the one-time token and change the credential in one transaction.
    // Two concurrent submissions cannot both consume the same reset link.
    const [claimed] = await tx.update(passwordResetTokens)
      .set({ usedAt: changedAt })
      .where(and(
        eq(passwordResetTokens.id, row.id),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, changedAt),
      ))
      .returning({ userId: passwordResetTokens.userId });
    if (!claimed) return null;

    await tx.update(users).set({
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    }).where(eq(users.id, claimed.userId));

    return claimed;
  });

  if (!reset) {
    return Response.json({ error: "Reset token is invalid or expired." }, { status: 400 });
  }

  // Any stolen session is killed when the password changes. Reported as a real
  // count so the UI can say how many devices were signed out.
  const sessionsRevoked = await revokeAllSessions(reset.userId);

  await recordAuditEvent({
    organizationId: await primaryOrganizationId(reset.userId),
    actor: `user:${reset.userId}`,
    action: "Password reset completed",
    resource: `user ${reset.userId}`,
    metadata: { sessionsRevoked }
  });

  return Response.json({ ok: true, rateLimitMode: limited.mode, sessionsRevoked });
}
