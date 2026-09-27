import { eq } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { deliveryCapable, queueMessage } from "@/lib/mailer";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Identical response either way so the endpoint cannot enumerate accounts.
  const generic = {
    ok: true,
    message: "If that account exists, a reset link has been created.",
    rateLimitMode: limited.mode,
  };

  if (!user) return Response.json(generic);

  const token = randomToken(24);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  const origin = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const link = `${origin}/reset-password?token=${token}`;

  const result = await queueMessage({
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

  return Response.json({
    ...generic,
    // Never returns the token. The outbox reference lets an operator with DB
    // access help a user when no mail provider is configured.
    delivery: {
      configured: deliveryCapable(),
      queued: result.queued,
      delivered: result.delivered,
      provider: result.provider,
      reason: result.reason,
    },
  });
}
