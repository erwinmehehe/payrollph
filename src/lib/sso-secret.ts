import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function ssoKey() {
  const raw = process.env.SSO_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("SSO_ENCRYPTION_KEY is required before enterprise SSO can be configured.");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("SSO_ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters or base64.");
}

export function ssoEncryptionConfigured() {
  try {
    ssoKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSsoSecret(value: string) {
  const key = ssoKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSsoSecret(value: string) {
  const [prefix, version, ivText, tagText, cipherText] = value.split(":");
  if (prefix !== "enc" || version !== "v1" || !ivText || !tagText || !cipherText) {
    throw new Error("Encrypted SSO secret is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", ssoKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
