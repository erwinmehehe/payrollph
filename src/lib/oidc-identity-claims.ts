/**
 * Validates signed OIDC ID-token identity claims before mapping the subject
 * onto an existing Linaw account. Must be called ONLY after cryptographic
 * signature verification against the trusted provider's JWKS.
 */
export type OidcIdentityClaimsInput = {
  payload: Record<string, unknown>;
  issuer: string;
  clientId: string;
  nonce: string;
  emailClaim: string;
  nowSeconds: number;
};

export function validateOidcIdentityClaims(input: OidcIdentityClaimsInput) {
  const { payload, issuer, clientId, nonce, emailClaim, nowSeconds } = input;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new Error("OIDC claim validation clock is invalid.");
  }
  if (payload.iss !== issuer) throw new Error("OIDC issuer claim is invalid.");
  const aud = payload.aud;
  const audience = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : [];
  if (!audience.includes(clientId)) throw new Error("OIDC audience claim is invalid.");
  // OIDC requires azp when multiple audiences are present. If present with
  // one audience it must still identify OUR client, not a different RP.
  if ((audience.length > 1 || payload.azp !== undefined) && payload.azp !== clientId) {
    throw new Error("OIDC authorized-party claim is invalid.");
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)
    || payload.exp <= nowSeconds - 30) {
    throw new Error("OIDC ID token is expired or has an invalid expiry.");
  }
  if (payload.iat !== undefined && (typeof payload.iat !== "number"
    || !Number.isFinite(payload.iat) || payload.iat > nowSeconds + 120)) {
    throw new Error("OIDC ID token issue-time claim is invalid.");
  }
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number"
    || !Number.isFinite(payload.nbf) || payload.nbf > nowSeconds + 120)) {
    throw new Error("OIDC ID token is not yet valid.");
  }
  if (payload.nonce !== nonce) throw new Error("OIDC nonce is invalid.");
  if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 240) {
    throw new Error("OIDC subject claim is missing or invalid.");
  }

  // Email is used to map provisioned identities to global Linaw accounts.
  // Mere absence of an explicit 'false' from the IdP is NOT verification.
  if (payload.email_verified !== true) {
    throw new Error("OIDC identity provider must explicitly verify the account email.");
  }
  const rawEmail = payload[emailClaim];
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email || email.length > 180 || !email.includes("@")) {
    throw new Error("OIDC ID token does not contain a usable email claim.");
  }

  const amr = Array.isArray(payload.amr)
    ? payload.amr.filter((value): value is string => typeof value === "string") : [];
  const mfaSatisfied = amr.some((value) =>
    ["mfa", "otp", "hwk", "fido", "webauthn"].includes(value.toLowerCase()));

  return {
    subject: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name.slice(0, 120) : null,
    mfaSatisfied,
    payload,
  };
}
