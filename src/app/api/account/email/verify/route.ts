import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { emailChangeTokens, employees, userOrganizations, users } from "@/db/schema";
import { primaryOrganizationId } from "@/lib/access";
import { canSyncLinkedEmployeeEmail } from "@/lib/account";
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
      // Lock and recheck the single-use token in the committing transaction.
      // A second request or superseding link cannot reuse a stale preflight read.
      const [liveToken] = await tx.select({ id: emailChangeTokens.id }).from(emailChangeTokens)
        .where(and(
          eq(emailChangeTokens.id, pending.id),
          eq(emailChangeTokens.userId, account.id),
          eq(emailChangeTokens.tokenHash, sha256(token)),
          isNull(emailChangeTokens.usedAt),
          gt(emailChangeTokens.expiresAt, new Date()),
        )).for("update").limit(1);
      if (!liveToken) throw new Error("Verification token already consumed.");

      // A worker pointer can be stale, reassigned or from another employer.
      // Lock the authoritative user and employee records before changing either.
      const [currentAccount] = await tx.select({
        id: users.id, role: users.role, employeeId: users.employeeId, active: users.active,
      }).from(users).where(eq(users.id, account.id)).for("update").limit(1);
      if (!currentAccount?.active) throw new Error("Account no longer active.");

      if (currentAccount.employeeId != null) {
        const [linkedEmployee] = await tx.select({
          id: employees.id, organizationId: employees.organizationId,
        }).from(employees).where(eq(employees.id, currentAccount.employeeId))
          .for("update").limit(1);
        if (!linkedEmployee) throw new Error("Linked employee unavailable.");

        // Membership revocation must serialize with this write. Another active
        // employer grant never authorizes a different employer's employee row.
        const [membership] = await tx.select({
          userId: userOrganizations.userId,
          organizationId: userOrganizations.organizationId,
          role: userOrganizations.role,
          active: userOrganizations.active,
          workerEmployeeId: userOrganizations.workerEmployeeId,
        }).from(userOrganizations).where(and(
          eq(userOrganizations.userId, currentAccount.id),
          eq(userOrganizations.organizationId, linkedEmployee.organizationId),
          eq(userOrganizations.active, true),
        )).for("share").limit(1);

        if (!canSyncLinkedEmployeeEmail({
          userId: currentAccount.id,
          role: currentAccount.role,
          employeeId: currentAccount.employeeId,
          employee: linkedEmployee,
          membership: membership ?? null,
        })) throw new Error("Linked employee employer grant invalid.");

        const [updatedEmployee] = await tx.update(employees)
          .set({ email: pending.newEmail })
          .where(and(
            eq(employees.id, currentAccount.employeeId),
            eq(employees.organizationId, linkedEmployee.organizationId),
          )).returning({ id: employees.id });
        if (!updatedEmployee) throw new Error("Linked employee was not updated.");
      }

      const [updatedAccount] = await tx.update(users)
        .set({ email: pending.newEmail })
        .where(eq(users.id, currentAccount.id))
        .returning({ id: users.id });
      if (!updatedAccount) throw new Error("Account no longer available.");

      // Account, linked worker email and token consumption commit or roll back
      // together, including on an invalid or revoked employer membership.
      await tx.update(emailChangeTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(emailChangeTokens.userId, currentAccount.id), isNull(emailChangeTokens.usedAt)));
    });
  } catch {
    return Response.json({ error: "Email verification could not be completed. Request a new verification link or contact support." }, { status: 409 });
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
