import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getSessionUser, publicUser } from "@/lib/auth";
import { generateBackupCodes, sha256, verifyPassword } from "@/lib/crypto";
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from "@/lib/totp";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { decryptTotpSecret, encryptTotpSecret } from "@/lib/security-secret";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Never reveal or create a TOTP seed on a GET. A stolen session cookie must not
 * be enough to attach or pre-read an authenticator secret.
 */
export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(sessionUser.email, "Authenticator setup");
  if (demoDenied) return demoDenied;

  return Response.json({
    enabled: sessionUser.totpEnabled,
    message: sessionUser.totpEnabled
      ? "Two-factor authentication is enabled."
      : "Confirm your current password to start authenticator setup.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(sessionUser.email, "Authenticator setup");
  if (demoDenied) return demoDenied;

  const limited = await rateLimitDistributed(
    `totp-setup:${sessionUser.id}:${clientIp(request)}`,
    { limit: 8, windowMs: 5 * 60_000 },
  );
  if (!limited.allowed) {
    return Response.json({ error: "Too many authenticator setup attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "verify";
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";

  const [user] = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
  if (!user) return Response.json({ error: "User not found." }, { status: 404 });

  // Re-authentication is mandatory for both seed issuance and enrollment. This
  // prevents a stolen session cookie from registering an attacker's factor.
  if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
    return Response.json({ error: "Your current password is required to change two-factor authentication." }, { status: 403 });
  }

  if (action === "begin") {
    if (user.totpEnabled) {
      return Response.json({ error: "Two-factor authentication is already enabled." }, { status: 409 });
    }

    // Always rotate a pending seed. This invalidates any seed that may have been
    // revealed by an abandoned or older setup attempt.
    const secret = generateTotpSecret();
    let storedSecret: string;
    try {
      storedSecret = encryptTotpSecret(secret, { required: process.env.NODE_ENV === "production" });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Authenticator encryption is not configured.",
      }, { status: 503 });
    }

    await db.update(users).set({
      totpSecret: storedSecret,
      backupCodes: [],
    }).where(eq(users.id, user.id));

    return Response.json({
      enabled: false,
      secret,
      otpauthUri: buildOtpAuthUri({ secret, accountName: user.email, issuer: "Linaw" }),
      message: "Authenticator secret created. Enter a code from your app to finish setup.",
    });
  }

  if (action !== "verify") {
    return Response.json({ error: "Unsupported authenticator setup action." }, { status: 400 });
  }

  if (user.totpEnabled) {
    return Response.json({ error: "Two-factor authentication is already enabled." }, { status: 409 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!user.totpSecret) {
    return Response.json({ error: "Start authenticator setup again before verifying a code." }, { status: 400 });
  }

  let secret: string;
  try {
    secret = decryptTotpSecret(user.totpSecret);
  } catch {
    return Response.json({ error: "Authenticator encryption is not configured correctly." }, { status: 503 });
  }
  if (!verifyTotp(code, secret)) {
    return Response.json({ error: "Invalid authenticator code." }, { status: 400 });
  }

  const backupCodes = generateBackupCodes();
  const verifiedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      totpEnabled: true,
      backupCodes: backupCodes.map((backup) => sha256(backup)),
    }).where(eq(users.id, user.id));

    // The current session has just proved the newly enrolled factor, so record
    // that proof for sensitive-action MFA checks.
    await tx.update(sessions).set({ mfaVerifiedAt: verifiedAt }).where(eq(sessions.id, sessionUser.sessionId));
  });

  return Response.json({
    enabled: true,
    backupCodes,
    message: "Two-factor authentication verified and enabled.",
    user: publicUser({ ...user, totpEnabled: true }),
  });
}
