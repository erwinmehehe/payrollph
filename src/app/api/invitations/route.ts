import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invitations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { deliveryCapable, queueMessage } from "@/lib/mailer";
import { createInvitation } from "@/lib/tokens";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";

import { denyPublicDemoSideEffect } from "@/lib/public-demo-guard";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedInviteList = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only workspace administrators can view invitations.",
  );
  if (deniedInviteList) return deniedInviteList;
  const rows = await db.select().from(invitations)
    .where(eq(invitations.organizationId, organizationId))
    .orderBy(desc(invitations.id));

  return Response.json({
    invitations: rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      accepted: Boolean(row.acceptedAt),
      expired: new Date(row.expiresAt).getTime() < Date.now(),
      invitedBy: row.invitedBy,
      createdAt: row.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = ["owner", "admin", "hr", "bookkeeper", "employee"].includes(String(body.role)) ? String(body.role) : "admin";

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const deniedInvite = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only workspace administrators can invite users.",
  );
  if (deniedInvite) return deniedInvite;
  const demoDenied = await denyPublicDemoSideEffect(organizationId, "Invitations");
  if (demoDenied) return demoDenied;

  const access = await getAccess(user.id, organizationId);
  if (role === "owner" && access?.role !== "owner") {
    return Response.json({ error: "Only an owner can invite another owner." }, { status: 403 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "A valid email is required." }, { status: 422 });

  const [alreadyUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (alreadyUser) {
    return Response.json({
      error: "That email already belongs to a Linaw account. Add existing-user membership through an administrator workflow instead of issuing a password invitation.",
    }, { status: 409 });
  }

  const [alreadyInvited] = await db.select().from(invitations).where(and(
    eq(invitations.organizationId, organizationId),
    eq(invitations.email, email),
  )).limit(1);
  if (alreadyInvited && !alreadyInvited.acceptedAt && new Date(alreadyInvited.expiresAt).getTime() > Date.now()) {
    return Response.json({ error: "An open invitation for that email already exists." }, { status: 409 });
  }

  const { row, token } = await createInvitation({
    organizationId,
    email,
    role,
    invitedBy: user.name,
    orgUnitId: Number.isInteger(Number(body.orgUnitId)) && body.orgUnitId ? Number(body.orgUnitId) : null,
  });

  const origin = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const link = `${origin}/invite?token=${token}`;

  const delivery = await queueMessage({
    organizationId,
    recipient: email,
    subject: `You have been invited to Linaw`,
    purpose: "invitation",
    body: [
      `${user.name} invited you to a Linaw workspace.`,
      "",
      "Accept your invitation and set a password:",
      link,
      "",
      "This link expires in 7 days and can be used once.",
    ].join("\n"),
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Invitation created",
    resource: email,
    metadata: { role, deliveryConfigured: deliveryCapable(), delivered: delivery.delivered },
  });

  // The raw token is only returned when no mail provider is configured, so an
  // operator can complete onboarding. It is never returned once delivery works.
  return Response.json({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    delivery: { configured: deliveryCapable(), delivered: delivery.delivered, queued: delivery.queued, provider: delivery.provider, reason: delivery.reason },
    inviteToken: deliveryCapable() ? undefined : token,
  }, { status: 201 });
}
