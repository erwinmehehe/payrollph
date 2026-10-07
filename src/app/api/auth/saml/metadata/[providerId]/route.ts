import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { identityProviders } from "@/db/schema";
import { canonicalAppOrigin } from "@/lib/security-request";
import { buildSamlServiceProviderMetadata } from "@/lib/saml";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId: rawProviderId } = await params;
  const providerId = Number(rawProviderId);
  if (!Number.isInteger(providerId)) {
    return Response.json({ error: "A valid SAML provider is required." }, { status: 400 });
  }

  const [provider] = await db.select({
    id: identityProviders.id,
    protocol: identityProviders.protocol,
  }).from(identityProviders).where(and(
    eq(identityProviders.id, providerId),
    eq(identityProviders.protocol, "saml"),
  )).limit(1);
  if (!provider) return Response.json({ error: "SAML provider not found." }, { status: 404 });

  const origin = canonicalAppOrigin(request);
  const entityId = `${origin}/api/auth/saml/metadata/${provider.id}`;
  const acsUrl = `${origin}/api/auth/saml/acs/${provider.id}`;
  const xml = buildSamlServiceProviderMetadata({ entityId, acsUrl });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/samlmetadata+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
