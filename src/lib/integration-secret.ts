import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function integrationEncryptionKey() {
  const raw = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters or base64.");
}

export function integrationCredentialEncryptionConfigured() {
  return Boolean(process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?.trim());
}

export function encryptIntegrationCredential(value: string) {
  const key = integrationEncryptionKey();
  if (!key) throw new Error("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY is required before provider connectors can be enabled.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptIntegrationCredential(value: string) {
  if (!value.startsWith("enc:v1:")) throw new Error("Integration credential is not encrypted.");
  const key = integrationEncryptionKey();
  if (!key) throw new Error("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY is required to decrypt provider credentials.");
  const parts = value.split(":");
  if (parts.length !== 5) throw new Error("Encrypted integration credential is malformed.");
  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ciphertext = Buffer.from(parts[4], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
