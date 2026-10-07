import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  externalIdentities,
  identityDomains,
  identityProviders,
  oidcLoginStates,
  organizationSecurityPolicies,
  userOrganizations,
  users,
} from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { decryptEnterpriseSecret } from "@/lib/enterprise-secret";
import { exchangeOidcCode, verifyOidcIdToken } from "@/lib/oidc";
import { requestMeta } from "@/lib/rate-limit";
import { effectiveSessionPolicyForUser } from "@/lib/enterprise-session";
import { sha256 } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") ?? "");
  const state = String(url.searchParams.get("state") ?? "");
  const providerError = String(url.searchParams.get("error") ?? "");
  if (providerError) {
    return Response.redirect(new URL("/login?ssoError=" + encodeURIComponent(providerError), request.url), 302);
  }
  if (!code || !state) return Response.json({ error: "OIDC callback is missing code or state." }, { status: 400 });

  const [loginState] = await db.select().from(oidcLoginStates).where(and(
    eq(oidcLoginStates.stateHash, sha256(state)),
    isNull(oidcLoginStates.usedAt),
    gt(oidcLoginStates.expiresAt, new Date()),
  )).limit(1);
  if (!loginState) return Response.json({ error: "OIDC login state is invalid, expired, or already used." }, { status: 400 });

  const [claimed] = await db.update(oidcLoginStates).set({ usedAt: new Date() }).where(and(
    eq(oidcLoginStates.id, loginState.id),
    isNull(oidcLoginStates.usedAt),
  )).returning({ id: oidcLoginStates.id });
  if (!claimed) return Response.json({ error: "OIDC login state was already consumed." }, { status: 409 });

  const [provider] = await db.select().from(identityProviders).where(and(
    eq(identityProviders.id, loginState.providerId),
    eq(identityProviders.protocol, "oidc"),
    eq(identityProviders.enabled, true),
  )).limit(1);
  if (!provider) return Response.json({ error: "OIDC provider is unavailable." }, { status: 403 });
  if (!provider.tokenEndpoint || !provider.clientId || !provider.clientSecretEncrypted || !provider.issuer || !provider.jwksUri) {
    return Response.json({ error: "OIDC provider configuration is incomplete." }, { status: 409 });
  }

  let identity;
  try {
    const token = await exchangeOidcCode({
      tokenEndpoint: provider.tokenEndpoint,
      clientId: provider.clientId,
      clientSecretEncrypted: provider.clientSecretEncrypted,
      code,
      codeVerifier: decryptEnterpriseSecret(loginState.codeVerifier),
      redirectUri: loginState.redirectUri,
    });
    identity = await verifyOidcIdToken({
      idToken: token.id_token!,
      issuer: provider.issuer,
      clientId: provider.clientId,
      jwksUri: provider.jwksUri,
      nonce: loginState.nonce,
      emailClaim: provider.emailClaim,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "OIDC authentication failed." }, { status: 401 });
  }

  const emailDomain = identity.email.split("@").pop() ?? "";
  const [verifiedDomain] = await db.select({ id: identityDomains.id }).from(identityDomains).where(and(
    eq(identityDomains.organizationId, provider.organizationId),
    eq(identityDomains.providerId, provider.id),
    eq(identityDomains.domain, emailDomain),
    eq(identityDomains.verified, true),
  )).limit(1);
  if (!verifiedDomain) return Response.json({ error: "OIDC email domain is not verified for this workspace." }, { status: 403 });

  const [securityPolicy] = await db.select().from(organizationSecurityPolicies)
    .where(eq(organizationSecurityPolicies.organizationId, provider.organizationId))
    .limit(1);
  if (securityPolicy?.requireMfa && !identity.mfaSatisfied) {
    return Response.json({
      error: "This workspace requires MFA. The identity provider did not assert an MFA authentication method in the ID token.",
      code: "MFA_REQUIRED",
    }, { status: 403 });
  }

  const [existingIdentity] = await db.select().from(externalIdentities).where(and(
    eq(externalIdentities.providerId, provider.id),
    eq(externalIdentities.subject, identity.subject),
  )).limit(1);

  let user;
  if (existingIdentity) {
    [user] = await db.select().from(users).where(eq(users.id, existingIdentity.userId)).limit(1);
    if (!user || !user.active) return Response.json({ error: "The linked Linaw account is inactive." }, { status: 403 });
    if (user.email.toLowerCase() !== identity.email) {
      return Response.json({ error: "The identity-provider email changed. Sync the account through SCIM before signing in again." }, { status: 409 });
    }
    await db.update(externalIdentities).set({ email: identity.email, lastLoginAt: new Date() })
      .where(eq(externalIdentities.id, existingIdentity.id));
  } else {
    [user] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
    if (!user || !user.active) {
      return Response.json({
        error: "This identity is valid, but the user has not been provisioned in Linaw. Provision the account through SCIM or create the membership first.",
      }, { status: 403 });
    }
    const [membership] = await db.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.organizationId, provider.organizationId),
      eq(userOrganizations.active, true),
    )).limit(1);
    if (!membership) return Response.json({ error: "The user is not a member of this SSO workspace." }, { status: 403 });

    try {
      await db.insert(externalIdentities).values({
        organizationId: provider.organizationId,
        providerId: provider.id,
        userId: user.id,
        subject: identity.subject,
        email: identity.email,
        lastLoginAt: new Date(),
      });
    } catch {
      return Response.json({ error: "The OIDC identity could not be linked safely. Retry sign-in." }, { status: 409 });
    }
  }

  const [membership] = await db.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
    eq(userOrganizations.userId, user.id),
    eq(userOrganizations.organizationId, provider.organizationId),
    eq(userOrganizations.active, true),
  )).limit(1);
  if (!membership) return Response.json({ error: "The user no longer belongs to this workspace." }, { status: 403 });

  const effectivePolicy = await effectiveSessionPolicyForUser(user.id);
  if (effectivePolicy.requireMfa && !identity.mfaSatisfied) {
    return Response.json({
      error: "One of this user's active Linaw workspaces requires MFA, but the identity provider did not assert an MFA authentication method.",
      code: "MFA_REQUIRED",
    }, { status: 403 });
  }

  const session = await createSession(user.id, requestMeta(request), {
    mfaVerifiedAt: identity.mfaSatisfied ? new Date() : null,
    authMethod: "oidc",
    identityProviderId: provider.id,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

  await recordAuditEvent({
    organizationId: provider.organizationId,
    actor: user.name,
    action: "SSO sign-in completed",
    resource: user.email,
    metadata: {
      providerId: provider.id,
      subject: identity.subject,
      mfaAsserted: identity.mfaSatisfied,
    },
  });

  return Response.redirect(new URL("/app", request.url), 302);
}
