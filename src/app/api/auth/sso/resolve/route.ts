import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { identityDomains, identityProviders } from "@/db/schema";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { rateLimitDistributed, clientIp } from "@/lib/rate-limit";
import { ssoDiscoveryEmail } from "@/lib/tenant-sso-discovery";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const limited = await rateLimitDistributed("sso-resolve:" + clientIp(request), { limit: 30, windowMs: 60_000 });
  if (limited.mode !== "distributed-postgres") {
    return Response.json({ error: "SSO discovery is temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }
  if (!limited.allowed) {
    return Response.json({ error: "Too many SSO discovery attempts." }, { status: 429, headers: NO_STORE });
  }

  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).email : null;
  const identity = ssoDiscoveryEmail(input);
  if (!identity) return Response.json({ available: false }, { headers: NO_STORE });

  // A domain row and its provider must belong to the SAME employer, not just
  // share a provider ID. Provider IDs, organization IDs and response fields
  // supplied by the unauthenticated caller are never authorization selectors.
  const [match] = await db.select({
    providerId: identityProviders.id,
    providerName: identityProviders.name,
  }).from(identityDomains)
    .innerJoin(identityProviders, and(
      eq(identityDomains.providerId, identityProviders.id),
      eq(identityDomains.organizationId, identityProviders.organizationId),
    ))
    .where(and(
      eq(identityDomains.domain, identity.domain),
      eq(identityDomains.verified, true),
      eq(identityProviders.protocol, "oidc"),
      eq(identityProviders.enabled, true),
    ))
    .limit(1);

  if (!match) return Response.json({ available: false }, { headers: NO_STORE });
  return Response.json({
    available: true,
    providerId: match.providerId,
    providerName: match.providerName,
    startUrl: "/api/auth/sso/start?providerId=" + match.providerId +
      "&loginHint=" + encodeURIComponent(identity.email),
  }, { headers: NO_STORE });
}
