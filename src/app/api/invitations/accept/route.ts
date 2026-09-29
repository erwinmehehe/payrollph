import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invitations, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
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

  const [existing] = await db.select().from(users).where(eq(users.email, invitation.email)).limit(1);

  if (existing) {
    return Response.json({
      error: "An account with this email already exists. Sign in to that account and ask a workspace administrator to add the membership instead.",
    }, { status: 409 });
  }

  const [created] = await db.insert(users).values({
    email: invitation.email,
    name,
    passwordHash: hashPassword(password),
    role: invitation.role,
    totpEnabled: false,
    backupCodes: [],
  }).returning();
  const userId = created.id;

  await db.insert(userOrganizations).values({
    userId,
    organizationId: invitation.organizationId,
    role: invitation.role,
    orgUnitId: invitation.orgUnitId,
  }).onConflictDoNothing();

  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));

  await recordAuditEvent({
    organizationId: invitation.organizationId,
    actor: name || invitation.email,
    action: "Invitation accepted",
    resource: invitation.email,
    metadata: { role: invitation.role, orgUnitId: invitation.orgUnitId },
  });

  const { token: sessionToken, expiresAt } = await createSession(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(expiresAt));

  return Response.json({ ok: true, organizationId: invitation.organizationId, validEmail: validEmail(invitation.email) });
}
