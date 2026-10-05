import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { ssoConnections, ssoLoginStates, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import {
  discoverOidc,
  exchangeOidcCode,
  fetchOidcUser,
  hashOidcState,
} from "@/lib/oidc";
import { requestMeta } from "@/lib/rate-limit";
import { decryptSsoSecret } from "@/lib/sso-secret";

export const dynamic = "force-dynamic";

function redirectUri() {
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) throw new Error("APP_BASE_URL is required for enterprise SSO.");
  const url = new URL(base);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  return new URL("/api/auth/sso/callback", url).toString();
}

function loginFailure(request: Request) {
  return Response.redirect(new URL("/login?ssoError=1", request.url), 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || !state || url.searchParams.has("error")) return loginFailure(request);

  try {
    const [claimed] = await db.update(ssoLoginStates).set({
      usedAt: new Date(),
    }).where(and(
      eq(ssoLoginStates.stateHash, hashOidcState(state)),
      isNull(ssoLoginStates.usedAt),
      gt(ssoLoginStates.expiresAt, new Date()),
    )).returning();
    if (!claimed) return loginFailure(request);

    const [connection] = await db.select().from(ssoConnections)
      .where(eq(ssoConnections.id, claimed.connectionId))
      .limit(1);
    if (!connection?.enabled) return loginFailure(request);

    const discovery = await discoverOidc(connection.issuer);
    const accessToken = await exchangeOidcCode({
      discovery,
      clientId: connection.clientId,
      clientSecret: decryptSsoSecret(connection.clientSecretCiphertext),
      redirectUri: redirectUri(),
      code,
      verifier: decryptSsoSecret(claimed.pkceVerifierCiphertext),
    });
    const identity = await fetchOidcUser({ discovery, accessToken });

    const expectedDomain = `@${connection.emailDomain.toLowerCase()}`;
    if (!identity.email.endsWith(expectedDomain)) return loginFailure(request);

    const [membership] = await db.select({
      user: users,
      membership: userOrganizations,
    }).from(users)
      .innerJoin(userOrganizations, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(users.email, identity.email),
        eq(userOrganizations.organizationId, connection.organizationId),
      ))
      .limit(1);
    if (!membership) return loginFailure(request);

    const session = await createSession(membership.user.id, requestMeta(request), {
      // OIDC proves authentication, but this code does not infer the IdP's MFA
      // policy from an unverified ACR claim. Sensitive payroll actions still
      // require a recent Linaw MFA event until an explicit assurance mapping is built.
      mfaVerifiedAt: null,
    });
    const jar = await cookies();
    jar.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

    await recordAuditEvent({
      organizationId: connection.organizationId,
      actor: membership.user.name,
      action: "Enterprise SSO sign-in",
      resource: connection.providerName,
      metadata: {
        issuer: connection.issuer,
        oidcSubject: identity.subject,
        email: identity.email,
        mfaAssuranceImported: false,
      },
    });

    return Response.redirect(new URL("/app", request.url), 303);
  } catch {
    return loginFailure(request);
  }
}
