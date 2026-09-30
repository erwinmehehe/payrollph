import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { emailChangeTokens, employees, users } from "@/db/schema";
import { primaryOrganizationId } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const limited = await rateLimitDistributed(`emailverify:${clientIp(request)}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many verification attempts." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[a-f0-9]{48}$/i.test(token)) {
    return Response.json({ error: "Verification link is invalid or expired." }, { status: 400 });
  }

  const [pending] = await db.select().from(emailChangeTokens).where(and(
    eq(emailChangeTokens.tokenHash, sha256(token)),
    isNull(emailChangeTokens.usedAt),
    gt(emailChangeTokens.expiresAt, new Date()),
  )).limit(1);

  if (!pending) return Response.json({ error: "Verification link is invalid or expired." }, { status: 400 });

  const [account] = await db.select().from(users).where(eq(users.id, pending.userId)).limit(1);
  if (!account) return Response.json({ error: "Account is no longer available." }, { status: 404 });

  const [taken] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, pending.newEmail), ne(users.id, account.id)))
    .limit(1);
  if (taken) {
    await db.update(emailChangeTokens).set({ usedAt: new Date() }).where(eq(emailChangeTokens.id, pending.id));
    return Response.json({ error: "That email is no longer available. Request a different address." }, { status: 409 });
  }

  const oldEmail = account.email;
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ email: pending.newEmail }).where(eq(users.id, account.id));
      if (account.employeeId) {
        await tx.update(employees).set({ email: pending.newEmail }).where(eq(employees.id, account.employeeId));
      }

      // Completing one email change invalidates every other outstanding link.
      await tx.update(emailChangeTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(emailChangeTokens.userId, account.id), isNull(emailChangeTokens.usedAt)));
    });
  } catch {
    return Response.json({ error: "That email is no longer available. Request a new verification link." }, { status: 409 });
  }

  const sessionsRevoked = await revokeAllSessions(account.id);

  await recordAuditEvent({
    organizationId: await primaryOrganizationId(account.id),
    actor: account.name,
    action: "Account email changed after verification",
    resource: `${oldEmail} → ${pending.newEmail}`,
    metadata: { sessionsRevoked, verification: "new-address-token" },
  });

  return Response.json({
    ok: true,
    email: pending.newEmail,
    signInRequired: true,
    message: "Email verified. All existing sessions were signed out; sign in again with the new address.",
  });
}
