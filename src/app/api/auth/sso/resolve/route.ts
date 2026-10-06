import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { identityDomains, identityProviders } from "@/db/schema";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { rateLimitDistributed, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const limited = await rateLimitDistributed("sso-resolve:" + clientIp(request), { limit: 30, windowMs: 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many SSO discovery attempts." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop() ?? "" : "";
  if (!email || !domain || email.length > 180) {
    return Response.json({ available: false });
  }

  const [match] = await db.select({
    providerId: identityProviders.id,
    providerName: identityProviders.name,
    domain: identityDomains.domain,
  }).from(identityDomains)
    .innerJoin(identityProviders, eq(identityDomains.providerId, identityProviders.id))
    .where(and(
      eq(identityDomains.domain, domain),
      eq(identityDomains.verified, true),
      eq(identityProviders.enabled, true),
    ))
    .limit(1);

  if (!match) return Response.json({ available: false });
  return Response.json({
    available: true,
    providerId: match.providerId,
    providerName: match.providerName,
    startUrl: "/api/auth/sso/start?providerId=" + match.providerId + "&loginHint=" + encodeURIComponent(email),
  });
}
