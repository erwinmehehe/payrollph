import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { identityProviders, organizationSecurityPolicies, sessions } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";

export async function assertOrganizationSessionPolicy(userId: number, organizationId: number): Promise<Response | null> {
  const [policy] = await db.select().from(organizationSecurityPolicies)
    .where(eq(organizationSecurityPolicies.organizationId, organizationId))
    .limit(1);
  if (!policy || policy.ssoMode !== "required") return null;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [session] = await db.select({
    authMethod: sessions.authMethod,
    identityProviderId: sessions.identityProviderId,
  }).from(sessions).where(and(
    eq(sessions.userId, userId),
    eq(sessions.tokenHash, sha256(token)),
  )).limit(1);

  if (!session || session.authMethod !== "oidc" || !session.identityProviderId) {
    return Response.json({
      error: "This workspace requires single sign-on.",
      code: "SSO_REQUIRED",
    }, { status: 403 });
  }

  const [provider] = await db.select({ id: identityProviders.id }).from(identityProviders)
    .where(and(
      eq(identityProviders.id, session.identityProviderId),
      eq(identityProviders.organizationId, organizationId),
      eq(identityProviders.enabled, true),
    ))
    .limit(1);

  if (!provider) {
    return Response.json({
      error: "This single sign-on session is not valid for the requested workspace.",
      code: "SSO_REQUIRED",
    }, { status: 403 });
  }

  return null;
}
