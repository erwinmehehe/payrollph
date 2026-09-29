import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { hashPassword, sha256 } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { passwordIssues } from "@/lib/validation";

export async function POST(request: Request) {
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

  await db.update(users).set({
    passwordHash: hashPassword(password),
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(users.id, row.userId));

  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));

  // Any stolen session is killed when the password changes. Reported as a real
  // count so the UI can say how many devices were signed out.
  const sessionsRevoked = await revokeAllSessions(row.userId);

  await recordAuditEvent({
    organizationId: null,
    actor: `user:${row.userId}`,
    action: "Password reset completed",
    resource: `user ${row.userId}`,
    metadata: { sessionsRevoked }
  });

  return Response.json({ ok: true, rateLimitMode: limited.mode, sessionsRevoked });
}
