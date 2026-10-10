import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invitations, orgUnits, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { deliveryCapable, queueMessage } from "@/lib/mailer";
import { createInvitation } from "@/lib/tokens";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { canonicalAppOrigin, enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { rateLimitDistributed } from "@/lib/rate-limit";
import { isInvitableRole } from "@/lib/roles";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";

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
  const [rows, memberRows] = await Promise.all([
    db.select().from(invitations)
      .where(eq(invitations.organizationId, organizationId))
      .orderBy(desc(invitations.id)),
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: userOrganizations.role,
      orgUnitId: userOrganizations.orgUnitId,
    })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId)),
  ]);

  return Response.json({
    members: memberRows,
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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Invitations");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = String(body.role ?? "").trim();
  if (!isInvitableRole(role)) {
    return Response.json({ error: "Choose a supported workspace role." }, { status: 422 });
  }

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const deniedInvite = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only workspace administrators can invite users.",
  );
  if (deniedInvite) return deniedInvite;
  const subscriptionDenied = await requireSaasPaidWrites(organizationId);
  if (subscriptionDenied) return subscriptionDenied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const inviteLimit = await rateLimitDistributed(
    `invite-create:${user.id}:${organizationId}`,
    { limit: 20, windowMs: 60 * 60_000 },
  );
  if (!inviteLimit.allowed) {
    return Response.json({ error: "Too many invitations created. Try again later." }, { status: 429 });
  }

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

  let orgUnitId: number | null = null;
  if (body.orgUnitId !== undefined && body.orgUnitId !== null && body.orgUnitId !== "") {
    const candidate = Number(body.orgUnitId);
    if (!Number.isInteger(candidate)) {
      return Response.json({ error: "orgUnitId must be an integer." }, { status: 422 });
    }
    const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits)
      .where(and(eq(orgUnits.id, candidate), eq(orgUnits.organizationId, organizationId)))
      .limit(1);
    if (!unit) {
      return Response.json({ error: "Organization unit not found in this workspace." }, { status: 404 });
    }
    orgUnitId = unit.id;
  }

  if (process.env.NODE_ENV === "production" && !deliveryCapable()) {
    return Response.json({
      error: "Invitation delivery is not configured. Configure transactional email before creating production invitations.",
    }, { status: 503 });
  }

  let origin: string;
  try {
    origin = canonicalAppOrigin(request);
  } catch {
    return Response.json({ error: "APP_BASE_URL must be configured before invitations can be sent." }, { status: 503 });
  }

  const { row, token } = await createInvitation({
    organizationId,
    email,
    role,
    invitedBy: user.name,
    orgUnitId,
  });

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

  // Raw invitation tokens are a development-only fallback. Production refuses
  // to create invitations until transactional delivery is configured.
  return Response.json({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    delivery: { configured: deliveryCapable(), delivered: delivery.delivered, queued: delivery.queued, provider: delivery.provider, reason: delivery.reason },
    inviteToken: process.env.NODE_ENV !== "production" && !deliveryCapable() ? token : undefined,
  }, { status: 201 });
}
