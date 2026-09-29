import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser, publicUser } from "@/lib/auth";
import { generateBackupCodes, sha256 } from "@/lib/crypto";
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
  if (!user) return Response.json({ error: "User not found." }, { status: 404 });

  if (user.totpEnabled && user.totpSecret) {
    return Response.json({
      enabled: true,
      message: "TOTP is enabled for this account. It is available, not yet mandatory for every role.",
      user: publicUser(user),
    });
  }

  const secret = user.totpSecret ?? generateTotpSecret();
  if (!user.totpSecret) {
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));
  }

  return Response.json({
    enabled: false,
    secret,
    otpauthUri: buildOtpAuthUri({ secret, accountName: user.email, issuer: "Linaw" }),
    message: "TOTP available, not yet mandatory for any role.",
  });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const [user] = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
  if (!user?.totpSecret) return Response.json({ error: "No TOTP secret pending verification." }, { status: 400 });
  if (!verifyTotp(code, user.totpSecret)) return Response.json({ error: "Invalid authenticator code." }, { status: 400 });

  const backupCodes = generateBackupCodes();
  await db.update(users).set({
    totpEnabled: true,
    backupCodes: backupCodes.map((code) => sha256(code)),
  }).where(eq(users.id, user.id));

  return Response.json({
    enabled: true,
    backupCodes,
    message: "TOTP verified and enabled for this account.",
    user: publicUser({ ...user, totpEnabled: true }),
  });
}
