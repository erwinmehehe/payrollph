import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { identityProviders } from "@/db/schema";
import { SAML_RUNTIME_BLOCK_REASON } from "@/lib/saml";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId: rawProviderId } = await params;
  const providerId = Number(rawProviderId);
  if (!Number.isInteger(providerId)) {
    return Response.json({ error: "A valid SAML provider is required." }, { status: 400 });
  }

  const [provider] = await db.select({
    id: identityProviders.id,
    enabled: identityProviders.enabled,
  }).from(identityProviders).where(and(
    eq(identityProviders.id, providerId),
    eq(identityProviders.protocol, "saml"),
  )).limit(1);
  if (!provider) return Response.json({ error: "SAML provider not found." }, { status: 404 });

  return Response.json({
    error: SAML_RUNTIME_BLOCK_REASON,
    code: "SAML_RUNTIME_NOT_READY",
    configured: true,
    enabled: provider.enabled,
  }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
