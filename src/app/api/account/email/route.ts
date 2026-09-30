import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { emailChangeTokens, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { primaryOrganizationId } from "@/lib/access";
import { randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { emailChangeIssues } from "@/lib/account";
import { deliveryCapable, queueMessage } from "@/lib/mailer";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/tokens";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { canonicalAppOrigin, enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

/**
 * Starts a sign-in email change. The current password authorizes the request,
 * but the login identifier is not changed until the new address proves
 * ownership with a single-use verification token.
 */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const limited = await rateLimitDistributed(`emailchange:${clientIp(request)}`, { limit: 5, windowMs: 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many attempts." }, { status: 429 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Email changes");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!account) return Response.json({ error: "Account not found." }, { status: 404 });

  const problems = emailChangeIssues({ email, currentEmail: account.email, password });
  if (problems.length > 0) return Response.json({ error: "Email change not requested.", problems }, { status: 422 });

  const [taken] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, email), ne(users.id, account.id)))
    .limit(1);
  if (taken) {
    return Response.json({
      error: "Email change not requested.",
      problems: ["That email is already used by another account."],
    }, { status: 409 });
  }

  if (!verifyPassword(password, account.passwordHash)) {
    return Response.json({
      error: "Email change not requested.",
      problems: ["Your current password is not correct."],
    }, { status: 422 });
  }

  if (process.env.NODE_ENV === "production" && !deliveryCapable()) {
    return Response.json({ error: "Email verification delivery is not configured for this deployment." }, { status: 503 });
  }

  let origin: string;
  try {
    origin = canonicalAppOrigin(request);
  } catch {
    return Response.json({ error: "Email verification is not configured for this deployment." }, { status: 503 });
  }

  const token = randomToken(24);

  // A new request supersedes any previous pending email-change link.
  await db.update(emailChangeTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailChangeTokens.userId, account.id), isNull(emailChangeTokens.usedAt)));

  await db.insert(emailChangeTokens).values({
    userId: account.id,
    newEmail: email,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  const link = `${origin}/verify-email?token=${token}`;
  const delivery = await queueMessage({
    organizationId: await primaryOrganizationId(account.id),
    recipient: email,
    subject: "Verify your new Linaw email",
    purpose: "email-change-verification",
    body: [
      "A request was made to use this address as the sign-in email for a Linaw account.",
      "",
      "Open the link below and choose Verify email. The link expires in 30 minutes and can be used once:",
      link,
      "",
      "If you did not request this change, do not verify it.",
    ].join("\n"),
  });

  await recordAuditEvent({
    organizationId: await primaryOrganizationId(account.id),
    actor: user.name,
    action: "Account email change verification requested",
    resource: `${account.email} → ${email}`,
    metadata: {
      deliveryProvider: delivery.provider,
      delivered: delivery.delivered,
      queued: delivery.queued,
    },
  });

  return Response.json({
    ok: true,
    pending: true,
    email,
    message: `Verification sent to ${email}. Your current sign-in email stays unchanged until verification is completed.`,
    delivery: {
      configured: deliveryCapable(),
      delivered: delivery.delivered,
      queued: delivery.queued,
      provider: delivery.provider,
    },
  });
}
