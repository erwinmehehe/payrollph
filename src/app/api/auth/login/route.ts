import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureSeedData } from "@/db/seed";
import { createSession, publicUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { hashPassword, passwordNeedsRehash, sha256, verifyPassword } from "@/lib/crypto";
import { currentLoginLock, nextFailedLoginState } from "@/lib/login-lockout";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { decryptTotpSecret, encryptTotpSecret, isEncryptedTotpSecret, totpEncryptionConfigured } from "@/lib/security-secret";
import { effectiveSessionPolicyForUser } from "@/lib/enterprise-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  await ensureSeedData();
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`login:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({
      error: "Too many sign-in attempts. Try again later.",
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
  if (email.length > 180 || password.length > 256) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const accountLimited = await rateLimitDistributed(`login-account:${sha256(email)}`, { limit: 8, windowMs: 15 * 60_000 });
  if (!accountLimited.allowed) {
    return Response.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429 });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    verifyPassword(password, "scrypt$0123456789abcdef0123456789abcdef$9564d5a180593f4f60ac8b2db7e8966b37a1d6fc22b396d69f4f71972c1820f80cec190209c19b5603fae554eee5a6318a4cadcbc5b3892fd40e2d8df24c3997");
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  // Enforce the durable account lock without changing the outward response.
  // Returning the same generic 401 avoids making the lock state an account-
  // enumeration signal while still preventing password guesses during the lock.
  if (!user.active) {
    verifyPassword(password, user.passwordHash);
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const lock = currentLoginLock(user.lockedUntil);
  if (lock.locked) {
    verifyPassword(password, user.passwordHash);
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const validPassword = verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    const failure = nextFailedLoginState({
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.update(users).set({
      failedLoginAttempts: failure.failedLoginAttempts,
      lockedUntil: failure.lockedUntil,
    }).where(eq(users.id, user.id));
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (!user.localPasswordEnabled) {
    return Response.json({
      error: "Password sign-in is disabled for this account. Use your organization's single sign-on.",
      code: "SSO_ONLY",
    }, { status: 403 });
  }

  const enterprisePolicy = await effectiveSessionPolicyForUser(user.id);
  if (enterprisePolicy.requireMfa && !user.totpEnabled) {
    return Response.json({
      error: "Your workspace requires multi-factor authentication before local sign-in. Contact your workspace administrator to complete enrollment.",
      code: "MFA_ENROLLMENT_REQUIRED",
    }, { status: 403 });
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
      let secret: string;
      try {
        secret = decryptTotpSecret(user.totpSecret);
      } catch {
        return Response.json({ error: "Authenticator security is not configured correctly." }, { status: 503 });
      }
      totpOk = verifyTotp(totpCode, secret);
      if (
        totpOk &&
        !isEncryptedTotpSecret(user.totpSecret) &&
        totpEncryptionConfigured()
      ) {
        await db.update(users).set({
          totpSecret: encryptTotpSecret(secret),
        }).where(eq(users.id, user.id));
      }
    }
    if (!totpOk && backupCode) {
      const codes = Array.isArray(user.backupCodes) ? user.backupCodes as string[] : [];
      const backupHash = sha256(backupCode);
      const matchedCode = codes.find((code) => code === backupHash || code === backupCode);
      if (matchedCode) {
        totpOk = true;
        await db.update(users).set({
          backupCodes: codes.filter((code) => code !== matchedCode),
        }).where(eq(users.id, user.id));
      }
    }
    if (!totpOk) {
      return Response.json({ error: "Invalid authenticator or backup code.", requiresTotp: true }, { status: 401 });
    }
  }

  await db.update(users).set({
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...(passwordNeedsRehash(user.passwordHash) ? { passwordHash: hashPassword(password) } : {}),
  }).where(eq(users.id, user.id));
  const session = await createSession(user.id, requestMeta(request), {
    mfaVerifiedAt: user.totpEnabled ? new Date() : null,
    authMethod: "local",
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

  return Response.json({
    user: publicUser(user),
    rateLimitMode: limited.mode,
  });
}
