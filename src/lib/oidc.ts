import { createHash, createPublicKey, verify, type JsonWebKey as NodeJsonWebKey } from "node:crypto";
import { getValidatedJson, postValidatedForm, resolveWebhookTarget } from "@/lib/security-network";
import { decryptEnterpriseSecret } from "@/lib/enterprise-secret";
import { validateOidcIdentityClaims } from "@/lib/oidc-identity-claims";

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type Jwk = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

type IdTokenPayload = {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  amr?: string[];
  acr?: string;
  [key: string]: unknown;
};

function normalizeIssuer(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search) throw new Error("OIDC issuer must not contain credentials, query parameters, or a fragment.");
  return url.toString().replace(/\/$/, "");
}

export async function discoverOidc(issuerInput: string): Promise<OidcDiscovery> {
  const issuer = normalizeIssuer(issuerInput);
  await resolveWebhookTarget(issuer);
  const discoveryUrl = issuer + "/.well-known/openid-configuration";
  const discovered = await getValidatedJson<OidcDiscovery>({ url: discoveryUrl, maxBytes: 500_000 });
  if (normalizeIssuer(discovered.issuer) !== issuer) throw new Error("OIDC discovery issuer does not exactly match the configured issuer.");
  for (const [label, raw] of [
    ["authorization endpoint", discovered.authorization_endpoint],
    ["token endpoint", discovered.token_endpoint],
    ["JWKS URI", discovered.jwks_uri],
  ] as const) {
    if (!raw) throw new Error(`OIDC discovery is missing the ${label}.`);
    const target = new URL(raw);
    if (process.env.NODE_ENV === "production" && target.protocol !== "https:") {
      throw new Error(`OIDC ${label} must use HTTPS in production.`);
    }
    await resolveWebhookTarget(raw);
  }
  return discovered;
}

export function oidcPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

export async function exchangeOidcCode(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecretEncrypted: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const token = await postValidatedForm<{ id_token?: string; access_token?: string; token_type?: string; expires_in?: number }>({
    url: input.tokenEndpoint,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: decryptEnterpriseSecret(input.clientSecretEncrypted),
      code_verifier: input.codeVerifier,
    }),
  });
  if (!token.id_token) throw new Error("OIDC token response did not include an ID token.");
  return token;
}

export async function verifyOidcIdToken(input: {
  idToken: string;
  issuer: string;
  clientId: string;
  jwksUri: string;
  nonce: string;
  emailClaim: string;
}) {
  const parts = input.idToken.split(".");
  if (parts.length !== 3) throw new Error("OIDC ID token is malformed.");
  const header = decodePart<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  const payload = decodePart<IdTokenPayload>(parts[1]);
  if (header.alg !== "RS256") throw new Error("This OIDC foundation currently accepts RS256 ID tokens only.");
  if (!header.kid) throw new Error("OIDC ID token does not identify a signing key.");

  const jwks = await getValidatedJson<{ keys?: Jwk[] }>({ url: input.jwksUri, maxBytes: 1_000_000 });
  const key = jwks.keys?.find((candidate) =>
    candidate.kid === header.kid
    && candidate.kty === "RSA"
    && (!candidate.use || candidate.use === "sig")
    && (!candidate.alg || candidate.alg === "RS256")
  );
  if (!key) throw new Error("OIDC signing key was not found in the provider JWKS.");

  const publicKey = createPublicKey({ key: key as NodeJsonWebKey, format: "jwk" });
  const signingInput = Buffer.from(parts[0] + "." + parts[1]);
  const signature = Buffer.from(parts[2], "base64url");
  if (!verify("RSA-SHA256", signingInput, publicKey, signature)) throw new Error("OIDC ID token signature is invalid.");

  // Never trust claims until the ID token signature above verifies against
  // the provider's pinned discovery JWKS.
  return validateOidcIdentityClaims({
    payload,
    issuer: normalizeIssuer(input.issuer),
    clientId: input.clientId,
    nonce: input.nonce,
    emailClaim: input.emailClaim,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}
