import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invitations, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requestMeta } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/crypto";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { findUsableInvitation, normalizeEmail, passwordIssues, validEmail } from "@/lib/tokens";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const invitation = token ? await findUsableInvitation(token) : null;
  if (!invitation) return Response.json({ valid: false }, { status: 404 });
  return Response.json({ valid: true, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`invite-accept:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many attempts." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "").trim();
  const name = String(body.name ?? "").trim();
  const password = typeof body.password === "string" ? body.password : "";

  const invitation = await findUsableInvitation(token);
  if (!invitation) return Response.json({ error: "Invitation is invalid, already used, or expired." }, { status: 400 });

  const problems: string[] = [];
  if (name.length < 2) problems.push("Your name is required.");
  problems.push(...passwordIssues(password));
  if (problems.length) return Response.json({ error: "Validation failed.", problems }, { status: 422 });

  // An invitation is not a password-reset mechanism. Invitation creation already
  // refuses existing accounts, but enforce that boundary again here so a stale,
  // manually inserted or legacy invitation can never overwrite credentials.
  const [existing] = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, invitation.email))
    .limit(1);
  if (existing) {
    return Response.json({
      error: "This invitation cannot set credentials for an existing Linaw account. Sign in with the existing account and ask an administrator to add the workspace membership.",
    }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  let userId: number;
  try {
    const accepted = await db.transaction(async (tx) => {
      // Claim the single-use invitation inside the same transaction as account
      // creation. Concurrent submissions can no longer create two identities or
      // partially accept an invitation.
      const [claimed] = await tx.update(invitations)
        .set({ acceptedAt: new Date() })
        .where(and(
          eq(invitations.id, invitation.id),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ))
        .returning({ id: invitations.id });
      if (!claimed) return null;

      const [created] = await tx.insert(users).values({
        email: invitation.email,
        name,
        passwordHash,
        role: invitation.role,
        totpEnabled: false,
        // Recovery codes are created only when TOTP is actually enrolled, and
        // are stored hashed by the TOTP setup flow.
        backupCodes: [],
      }).returning({ id: users.id });

      await tx.insert(userOrganizations).values({
        userId: created.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
        orgUnitId: invitation.orgUnitId,
      });

      return { userId: created.id };
    });

    if (!accepted) {
      return Response.json({ error: "Invitation is invalid, already used, or expired." }, { status: 409 });
    }
    userId = accepted.userId;
  } catch {
    // A unique-email race or any other transactional conflict must fail closed:
    // no credential on an existing account is ever changed here.
    return Response.json({ error: "Invitation could not be accepted. Request a new invitation." }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId: invitation.organizationId,
    actor: name || invitation.email,
    action: "Invitation accepted",
    resource: invitation.email,
    metadata: { role: invitation.role, orgUnitId: invitation.orgUnitId },
  });

  const { token: sessionToken, expiresAt } = await createSession(userId, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(expiresAt));

  return Response.json({ ok: true, organizationId: invitation.organizationId, validEmail: validEmail(invitation.email) });
}
