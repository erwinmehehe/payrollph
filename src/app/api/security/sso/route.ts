import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ssoConnections } from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { discoverOidc, normalizeEmailDomain, validateIssuer } from "@/lib/oidc";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { encryptSsoSecret, ssoEncryptionConfigured } from "@/lib/sso-secret";

export const dynamic = "force-dynamic";

const OWNER_ONLY = ["owner"] as const;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OWNER_ONLY,
    "Only the workspace owner can manage enterprise SSO.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Enterprise SSO configuration requires company-wide owner access." }, { status: 403 });
  }

  const [connection] = await db.select().from(ssoConnections)
    .where(eq(ssoConnections.organizationId, organizationId))
    .limit(1);

  return Response.json({
    encryptionConfigured: ssoEncryptionConfigured(),
    connection: connection ? {
      id: connection.id,
      providerName: connection.providerName,
      emailDomain: connection.emailDomain,
      issuer: connection.issuer,
      clientId: connection.clientId,
      enabled: connection.enabled,
      secretConfigured: Boolean(connection.clientSecretCiphertext),
      updatedAt: connection.updatedAt,
    } : null,
  });
}

export async function PUT(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Configuring enterprise SSO");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OWNER_ONLY,
    "Only the workspace owner can manage enterprise SSO.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Enterprise SSO configuration requires company-wide owner access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  if (!ssoEncryptionConfigured()) {
    return Response.json({
      error: "SSO_ENCRYPTION_KEY must be configured before SSO credentials can be stored.",
    }, { status: 503 });
  }

  const providerName = typeof body.providerName === "string" ? body.providerName.trim().slice(0, 80) : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim().slice(0, 240) : "";
  const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
  const enabled = body.enabled === true;

  let emailDomain: string;
  let issuer: string;
  try {
    emailDomain = normalizeEmailDomain(String(body.emailDomain ?? ""));
    issuer = validateIssuer(String(body.issuer ?? ""));
    await discoverOidc(issuer);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "OIDC configuration is invalid.",
    }, { status: 422 });
  }
  if (providerName.length < 2 || clientId.length < 3) {
    return Response.json({ error: "Provider name and client ID are required." }, { status: 400 });
  }

  const [existing] = await db.select().from(ssoConnections)
    .where(eq(ssoConnections.organizationId, organizationId))
    .limit(1);
  if (!existing && clientSecret.length < 8) {
    return Response.json({ error: "A client secret is required when creating an SSO connection." }, { status: 400 });
  }

  const values = {
    providerName,
    emailDomain,
    issuer,
    clientId,
    clientSecretCiphertext: clientSecret
      ? encryptSsoSecret(clientSecret)
      : existing!.clientSecretCiphertext,
    enabled,
    updatedAt: new Date(),
  };

  try {
    const [connection] = existing
      ? await db.update(ssoConnections).set(values)
          .where(eq(ssoConnections.id, existing.id))
          .returning()
      : await db.insert(ssoConnections).values({
          organizationId,
          ...values,
          createdBy: user.name,
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: enabled ? "Enterprise SSO configured" : "Enterprise SSO saved disabled",
      resource: emailDomain,
      metadata: {
        providerName,
        issuer,
        clientId,
        secretRotated: Boolean(clientSecret),
        enabled,
      },
    });

    return Response.json({
      connection: {
        id: connection.id,
        providerName: connection.providerName,
        emailDomain: connection.emailDomain,
        issuer: connection.issuer,
        clientId: connection.clientId,
        enabled: connection.enabled,
        secretConfigured: true,
      },
    });
  } catch {
    return Response.json({
      error: "SSO configuration could not be saved. Check whether the company email domain is already assigned to another workspace.",
    }, { status: 409 });
  }
}
