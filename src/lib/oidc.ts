import { createHash, randomBytes } from "node:crypto";

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  code_challenge_methods_supported?: string[];
};

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,2})\./);
  if (match) {
    const octet = Number(match[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

export function normalizeEmailDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,187}[a-z0-9])?\.[a-z]{2,}$/i.test(domain)) {
    throw new Error("Enter a valid company email domain.");
  }
  return domain;
}

export function validateIssuer(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim().replace(/\/$/, ""));
  } catch {
    throw new Error("OIDC issuer must be a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("OIDC issuer must use HTTPS.");
  if (url.username || url.password || blockedHostname(url.hostname)) {
    throw new Error("OIDC issuer must be a public HTTPS identity-provider URL.");
  }
  return url.toString().replace(/\/$/, "");
}

function validateProviderEndpoint(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || blockedHostname(url.hostname)) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url.toString();
}

export async function discoverOidc(issuerValue: string): Promise<OidcDiscovery> {
  const issuer = validateIssuer(issuerValue);
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OIDC discovery failed with status ${response.status}.`);
  const body = await response.json() as Partial<OidcDiscovery>;
  const discoveredIssuer = validateIssuer(String(body.issuer ?? ""));
  if (discoveredIssuer !== issuer) throw new Error("OIDC discovery issuer does not match the configured issuer.");
  if (!body.authorization_endpoint || !body.token_endpoint || !body.userinfo_endpoint) {
    throw new Error("OIDC provider is missing authorization, token, or userinfo endpoints.");
  }
  const challengeMethods = body.code_challenge_methods_supported ?? [];
  if (!challengeMethods.includes("S256")) throw new Error("OIDC provider must support PKCE S256.");
  return {
    issuer,
    authorization_endpoint: validateProviderEndpoint(body.authorization_endpoint, "Authorization endpoint"),
    token_endpoint: validateProviderEndpoint(body.token_endpoint, "Token endpoint"),
    userinfo_endpoint: validateProviderEndpoint(body.userinfo_endpoint, "UserInfo endpoint"),
    code_challenge_methods_supported: challengeMethods,
  };
}

export function createOidcLoginMaterial() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function hashOidcState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function buildAuthorizationUrl(input: {
  discovery: OidcDiscovery;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}) {
  const url = new URL(input.discovery.authorization_endpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOidcCode(input: {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  });
  const response = await fetch(input.discovery.token_endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error("OIDC token exchange failed.");
  }
  return body.access_token;
}

export async function fetchOidcUser(input: { discovery: OidcDiscovery; accessToken: string }) {
  const response = await fetch(input.discovery.userinfo_endpoint, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.sub !== "string") throw new Error("OIDC UserInfo request failed.");
  const rawEmail =
    typeof body.email === "string"
      ? body.email
      : typeof body.preferred_username === "string"
        ? body.preferred_username
        : "";
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("OIDC identity did not provide a usable email address.");
  if (body.email_verified === false) throw new Error("OIDC provider reports that the email is not verified.");
  return { subject: body.sub, email, name: typeof body.name === "string" ? body.name : null };
}
