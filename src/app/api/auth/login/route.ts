import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { DEMO_MODE, ensureSeedData } from "@/db/seed";
import { createSession, publicUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import { isDemoUserEmail } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await ensureSeedData();
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`login:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({
      error: "Too many login attempts. Rate limit is single-instance, not yet distributed.",
      retryAfterMs: limited.retryAfterMs,
      rateLimitMode: limited.mode,
    }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const totpCode = typeof body.totpCode === "string" ? body.totpCode.trim() : "";
  const backupCode = typeof body.backupCode === "string" ? body.backupCode.trim().toUpperCase() : "";

  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  if (DEMO_MODE && isDemoUserEmail(email)) {
    return Response.json({
      error: "Use the one-click public demo instead of signing in with shared demo credentials.",
      demo: true,
      demoUrl: "/welcome#live-demo",
    }, { status: 403 });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return Response.json({
      error: "Account locked after repeated failed attempts.",
      lockedUntil: user.lockedUntil.toISOString(),
    }, { status: 423 });
  }

  const validPassword = verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    const attempts = user.failedLoginAttempts + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await db.update(users).set({
      failedLoginAttempts: attempts,
      lockedUntil,
    }).where(eq(users.id, user.id));
    return Response.json({
      error: lockedUntil ? "Account locked after repeated failed attempts." : "Invalid email or password.",
      attemptsRemaining: Math.max(0, 5 - attempts),
    }, { status: lockedUntil ? 423 : 401 });
  }

  if (user.totpEnabled) {
    if (!totpCode && !backupCode) {
      return Response.json({
        requiresTotp: true,
        message: "Password accepted. Enter your authenticator code to finish sign-in.",
        rateLimitMode: limited.mode,
      });
    }

    let totpOk = false;
    if (totpCode && user.totpSecret) {
      totpOk = verifyTotp(totpCode, user.totpSecret);
    }
    if (!totpOk && backupCode) {
      const codes = Array.isArray(user.backupCodes) ? user.backupCodes as string[] : [];
      if (codes.includes(backupCode)) {
        totpOk = true;
        await db.update(users).set({
          backupCodes: codes.filter((code) => code !== backupCode),
        }).where(eq(users.id, user.id));
      }
    }
    if (!totpOk) {
      return Response.json({ error: "Invalid authenticator or backup code.", requiresTotp: true }, { status: 401 });
    }
  }

  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const session = await createSession(user.id, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

  return Response.json({
    user: publicUser(user),
    rateLimitMode: limited.mode,
  });
}
