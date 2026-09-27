import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser, revokeOtherSessions } from "@/lib/auth";
import { primaryOrganizationId } from "@/lib/access";
import { verifyPassword } from "@/lib/crypto";
import { emailChangeIssues } from "@/lib/account";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/tokens";

export const dynamic = "force-dynamic";

/**
 * Change the sign-in email. Password confirmation is mandatory, the new address
 * must be valid and unused, and other sessions are revoked because the email is
 * the identifier used by the login and reset flows.
 */
export async function POST(request: Request) {
  const limited = await rateLimitDistributed(`emailchange:${clientIp(request)}`, { limit: 5, windowMs: 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many attempts." }, { status: 429 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!account) return Response.json({ error: "Account not found." }, { status: 404 });

  const problems = emailChangeIssues({ email, currentEmail: account.email, password });
  if (problems.length > 0) return Response.json({ error: "Email not changed.", problems }, { status: 422 });

  const [taken] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, email), ne(users.id, account.id)))
    .limit(1);
  if (taken) return Response.json({ error: "Email not changed.", problems: ["That email is already used by another account."] }, { status: 409 });

  if (!verifyPassword(password, account.passwordHash)) {
    return Response.json({ error: "Email not changed.", problems: ["Your current password is not correct."] }, { status: 422 });
  }

  await db.update(users).set({ email }).where(eq(users.id, account.id));

  // Keep the employee record's contact in sync when this login is self-service,
  // otherwise payslip delivery would keep going to the old address.
  if (account.employeeId) {
    const { employees } = await import("@/db/schema");
    await db.update(employees).set({ email }).where(eq(employees.id, account.employeeId));
  }

  const revoked = await revokeOtherSessions(account.id, user.sessionId);

  await recordAuditEvent({
    organizationId: await primaryOrganizationId(account.id),
    actor: user.name,
    action: "Account email changed",
    resource: `${account.email} → ${email}`,
    metadata: { sessionsRevoked: revoked },
  });

  return Response.json({ ok: true, email, otherSessionsRevoked: revoked });
}
