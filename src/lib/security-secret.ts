import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export function constantTimeSecretEqual(supplied: string | null | undefined, expected: string | null | undefined) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function totpEncryptionKey() {
  const raw = process.env.TOTP_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("TOTP_ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters or base64.");
}

export function totpEncryptionConfigured() {
  return Boolean(process.env.TOTP_ENCRYPTION_KEY?.trim());
}

export function isEncryptedTotpSecret(value: string) {
  return value.startsWith("enc:v1:");
}

export function encryptTotpSecret(secret: string, options: { required?: boolean } = {}) {
  const key = totpEncryptionKey();
  if (!key) {
    if (options.required) throw new Error("TOTP_ENCRYPTION_KEY is required before TOTP can be enabled.");
    return secret;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptTotpSecret(stored: string) {
  if (!isEncryptedTotpSecret(stored)) return stored;

  const key = totpEncryptionKey();
  if (!key) throw new Error("TOTP_ENCRYPTION_KEY is required to decrypt authenticator secrets.");

  const parts = stored.split(":");
  if (parts.length !== 5) throw new Error("Encrypted TOTP secret is malformed.");

  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ciphertext = Buffer.from(parts[4], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
