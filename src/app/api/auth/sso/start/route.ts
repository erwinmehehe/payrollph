import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ssoConnections, ssoLoginStates } from "@/db/schema";
import {
  buildAuthorizationUrl,
  createOidcLoginMaterial,
  discoverOidc,
  hashOidcState,
  normalizeEmailDomain,
} from "@/lib/oidc";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { encryptSsoSecret, ssoEncryptionConfigured } from "@/lib/sso-secret";

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

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const limited = await rateLimitDistributed(`sso-start:${clientIp(request)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    return Response.json({ error: "Too many SSO attempts. Try again later." }, { status: 429 });
  }
  if (!ssoEncryptionConfigured()) {
    return Response.json({ error: "Enterprise SSO is not available on this deployment." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const at = email.lastIndexOf("@");
  if (at <= 0) return Response.json({ error: "Enter your work email first." }, { status: 400 });

  let domain: string;
  try {
    domain = normalizeEmailDomain(email.slice(at + 1));
  } catch {
    return Response.json({ error: "Enter a valid work email." }, { status: 400 });
  }

  const [connection] = await db.select().from(ssoConnections)
    .where(eq(ssoConnections.emailDomain, domain))
    .limit(1);
  if (!connection?.enabled) {
    return Response.json({
      error: "Enterprise SSO is not configured for this company email domain.",
    }, { status: 404 });
  }

  try {
    const discovery = await discoverOidc(connection.issuer);
    const material = createOidcLoginMaterial();
    await db.insert(ssoLoginStates).values({
      connectionId: connection.id,
      stateHash: hashOidcState(material.state),
      pkceVerifierCiphertext: encryptSsoSecret(material.verifier),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    return Response.json({
      authorizationUrl: buildAuthorizationUrl({
        discovery,
        clientId: connection.clientId,
        redirectUri: redirectUri(),
        state: material.state,
        challenge: material.challenge,
      }),
    });
  } catch {
    return Response.json({
      error: "The company identity provider could not be reached. Contact your workspace owner.",
    }, { status: 503 });
  }
}
