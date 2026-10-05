import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { identityDomains, identityProviders, oidcLoginStates } from "@/db/schema";
import { canonicalAppOrigin } from "@/lib/security-request";
import { encryptEnterpriseSecret } from "@/lib/enterprise-secret";
import { oidcPkceChallenge } from "@/lib/oidc";
import { randomToken, sha256 } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerId = Number(url.searchParams.get("providerId"));
  const loginHint = String(url.searchParams.get("loginHint") ?? "").trim().toLowerCase();
  if (!Number.isInteger(providerId) || !loginHint.includes("@")) {
    return Response.json({ error: "A valid SSO provider and work email are required." }, { status: 400 });
  }

  const [provider] = await db.select().from(identityProviders).where(and(
    eq(identityProviders.id, providerId),
    eq(identityProviders.enabled, true),
  )).limit(1);
  if (!provider) return Response.json({ error: "SSO provider is not available." }, { status: 404 });

  const domain = loginHint.split("@").pop() ?? "";
  const [verifiedDomain] = await db.select({ id: identityDomains.id }).from(identityDomains).where(and(
    eq(identityDomains.providerId, provider.id),
    eq(identityDomains.organizationId, provider.organizationId),
    eq(identityDomains.domain, domain),
    eq(identityDomains.verified, true),
  )).limit(1);
  if (!verifiedDomain) return Response.json({ error: "This email domain is not verified for the selected SSO provider." }, { status: 403 });

  await db.delete(oidcLoginStates).where(lt(oidcLoginStates.expiresAt, new Date()));

  const state = randomToken(32);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(48);
  const redirectUri = canonicalAppOrigin(request) + "/api/auth/sso/callback";

  await db.insert(oidcLoginStates).values({
    providerId: provider.id,
    stateHash: sha256(state),
    nonce,
    codeVerifier: encryptEnterpriseSecret(codeVerifier),
    loginHint: loginHint.slice(0, 180),
    redirectUri,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  const authorize = new URL(provider.authorizationEndpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", provider.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", provider.scopes);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", oidcPkceChallenge(codeVerifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("login_hint", loginHint);

  return Response.redirect(authorize.toString(), 302);
}
