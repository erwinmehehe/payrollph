import { X509Certificate } from "node:crypto";
import { resolveWebhookTarget } from "@/lib/security-network";

export const SAML_NAME_ID_FORMAT_EMAIL = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

function xmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[char] ?? char);
}

export function normalizeSamlEntityId(value: string) {
  const entityId = value.trim();
  if (!entityId || entityId.length > 1000) throw new Error("SAML entity ID is required and must be 1000 characters or fewer.");
  return entityId;
}

export async function validateSamlSsoUrl(value: string) {
  const raw = value.trim();
  if (!raw) throw new Error("SAML SSO URL is required.");
  const url = new URL(raw);
  if (url.username || url.password || url.hash) {
    throw new Error("SAML SSO URL must not contain credentials or a fragment.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("SAML SSO URL must use HTTPS in production.");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("SAML SSO URL must use HTTP or HTTPS.");
  await resolveWebhookTarget(url.toString());
  return url.toString();
}

export function normalizeSamlCertificate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("SAML IdP signing certificate is required.");
  const pem = trimmed.includes("BEGIN CERTIFICATE")
    ? trimmed
    : `-----BEGIN CERTIFICATE-----\n${trimmed.replace(/\s+/g, "")}\n-----END CERTIFICATE-----`;
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new Error("SAML IdP signing certificate is not a valid X.509 certificate.");
  }
  const now = Date.now();
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || validFrom > now || validTo <= now) {
    throw new Error("SAML IdP signing certificate is not currently valid.");
  }
  return pem;
}

export function samlCertificateFingerprintSha256(pem: string) {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
}

export function buildSamlServiceProviderMetadata(input: {
  entityId: string;
  acsUrl: string;
}) {
  const entityId = xmlEscape(input.entityId);
  const acsUrl = xmlEscape(input.acsUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">\n  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">\n    <NameIDFormat>${SAML_NAME_ID_FORMAT_EMAIL}</NameIDFormat>\n    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>\n  </SPSSODescriptor>\n</EntityDescriptor>\n`;
}

export function samlRuntimeReady() {
  return false;
}

export const SAML_RUNTIME_BLOCK_REASON =
  "SAML sign-in is not enabled yet because signed XML assertion verification is not installed. Configure and review the provider now; keep authentication on OIDC until the verifier tranche is completed.";
