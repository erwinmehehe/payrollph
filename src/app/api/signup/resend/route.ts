import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { saasSignupVerifications } from "@/lib/saas-billing-schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { normalizeEmail, validEmail } from "@/lib/tokens";
import { queueMessage, deliveryCapable } from "@/lib/mailer";
import { canonicalAppOrigin, enforceSameOriginMutation } from "@/lib/security-request";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const GENERIC = { ok: true, message: "If verification is pending for this account, a fresh link will be emailed." };

export async function POST(request: Request) {
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const limited = await rateLimitDistributed("signup-resend-ip:" + clientIp(request), { limit: 4, windowMs: 60 * 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many requests. Please wait before retrying." }, { status: 429 });
  if (!deliveryCapable()) return Response.json({ error: "Email verification is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!validEmail(email) || email.length > 180) return Response.json(GENERIC);
  const mailboxLimit = await rateLimitDistributed("signup-resend-email:" + sha256(email), { limit: 3, windowMs: 24 * 60 * 60_000 });
  if (!mailboxLimit.allowed) return Response.json(GENERIC);
  let origin: string;
  try { origin = canonicalAppOrigin(request); }
  catch { return Response.json({ error: "Verification URL is unavailable." }, { status: 503 }); }
  const [record] = await db.select({
    id: saasSignupVerifications.id,
    organizationId: saasSignupVerifications.organizationId,
    userId: saasSignupVerifications.userId,
  }).from(saasSignupVerifications)
    .innerJoin(users, eq(saasSignupVerifications.userId, users.id))
    .where(and(eq(users.email, email), eq(users.active, false), isNull(saasSignupVerifications.verifiedAt)))
    .limit(1);
  if (!record) return Response.json(GENERIC);
  const token = randomToken(24);
  await db.update(saasSignupVerifications).set({
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  }).where(eq(saasSignupVerifications.id, record.id));
  await queueMessage({
    organizationId: record.organizationId, recipient: email,
    subject: "New Linaw account verification link",
    purpose: "signup-email-verification",
    body: [
      "You requested a new email verification link for your Linaw company account.",
      "This link works once and expires after 60 minutes:",
      origin + "/verify-signup?token=" + token,
      "",
      "If you did not request this, ignore the message.",
    ].join("\n"),
  });
  return Response.json(GENERIC);
}
