import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { deliveryCapable, queueMessage } from "@/lib/mailer";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/tokens";
import { isPublicDemoIdentity } from "@/lib/demo-security";
import { canonicalAppOrigin, enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`forgot:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({
      error: "Too many reset requests.",
      retryAfterMs: limited.retryAfterMs,
      rateLimitMode: limited.mode,
    }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!email) return Response.json({ error: "Email is required." }, { status: 400 });
  if (email.length > 180) return Response.json({ error: "Email is invalid." }, { status: 400 });

  const accountLimited = await rateLimitDistributed(`forgot-account:${sha256(email)}`, { limit: 3, windowMs: 30 * 60_000 });
  if (!accountLimited.allowed) return Response.json({
    ok: true,
    message: "If that account exists, a reset link has been created.",
    rateLimitMode: accountLimited.mode,
  });

  // Identical response regardless of account existence or mail configuration so
  // the endpoint cannot be used as an account or infrastructure oracle.
  const generic = {
    ok: true,
    message: "If that account exists, a reset link has been created.",
    rateLimitMode: limited.mode,
  };

  if (process.env.NODE_ENV === "production" && !deliveryCapable()) {
    return Response.json(generic);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || isPublicDemoIdentity(user.email)) return Response.json(generic);

  let origin: string;
  try {
    origin = canonicalAppOrigin(request);
  } catch {
    return Response.json(generic);
  }

  const token = randomToken(24);

  // Only the newest reset link should remain usable.
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  const link = `${origin}/reset-password?token=${token}`;

  try {
    await queueMessage({
      recipient: email,
      subject: "Reset your Linaw password",
      purpose: "password-reset",
      body: [
        "We received a request to reset your Linaw password.",
        "",
        `This link expires in 30 minutes and can be used once:`,
        link,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    });
  } catch {
    // Public responses stay identical whether the account exists or delivery
    // succeeds. Operators can inspect the outbox/logs without giving an
    // attacker an account-enumeration oracle.
  }

  return Response.json(generic);
}
