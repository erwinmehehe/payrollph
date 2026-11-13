import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { identityDomains, identityProviders, oidcLoginStates } from "@/db/schema";
import { canonicalAppOrigin } from "@/lib/security-request";
import { encryptEnterpriseSecret } from "@/lib/enterprise-secret";
import { oidcPkceChallenge } from "@/lib/oidc";
import { randomToken, sha256 } from "@/lib/crypto";
import { ssoDiscoveryEmail } from "@/lib/tenant-sso-discovery";
import {
  OIDC_BROWSER_STATE_COOKIE, OIDC_BROWSER_STATE_PATH,
  OIDC_BROWSER_STATE_MAX_AGE_SECONDS,
} from "@/lib/oidc-browser-state";

import { oidcSsoRuntimeEnabled, oidcSsoDisabledResponse } from "@/lib/oidc-sso-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!oidcSsoRuntimeEnabled()) return oidcSsoDisabledResponse();
  const url = new URL(request.url);
  // Do not let duplicate query keys or Number() coercion choose one employer
  // while the user/browser supplied conflicting provider or login selectors.
  const providerValues = url.searchParams.getAll("providerId");
  const hintValues = url.searchParams.getAll("loginHint");
  const providerValue = providerValues.length === 1 ? providerValues[0] : "";
  const providerId = /^[1-9]\d*$/.test(providerValue)
    && Number.isSafeInteger(Number(providerValue)) ? Number(providerValue) : null;
  const loginIdentity = hintValues.length === 1 ? ssoDiscoveryEmail(hintValues[0]) : null;
  if (!providerId || !loginIdentity) {
    return Response.json({ error: "A valid SSO provider and work email are required." }, { status: 400 });
  }
  const loginHint = loginIdentity.email;

  const [provider] = await db.select().from(identityProviders).where(and(
    eq(identityProviders.id, providerId),
    eq(identityProviders.protocol, "oidc"),
    eq(identityProviders.enabled, true),
  )).limit(1);
  if (!provider) return Response.json({ error: "OIDC provider is not available." }, { status: 404 });
  if (!provider.authorizationEndpoint || !provider.clientId) {
    return Response.json({ error: "OIDC provider configuration is incomplete." }, { status: 409 });
  }

  const domain = loginIdentity.domain;
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

  // A DB state alone is not sufficient authorization to complete sign-in:
  // the initiating browser also receives the unpredictable state in a
  // short-lived host-only HttpOnly cookie. SameSite=Lax allows the IdP's
  // top-level GET redirect back to this callback.
  const response = NextResponse.redirect(authorize.toString(), 302);
  response.cookies.set(OIDC_BROWSER_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: OIDC_BROWSER_STATE_PATH,
    maxAge: OIDC_BROWSER_STATE_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
