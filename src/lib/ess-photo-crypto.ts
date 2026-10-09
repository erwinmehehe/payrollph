import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";

const PREFIX = "enc:essphoto:v1:";
const PURPOSE = "linaw:employee-profile-photo:v1";

function deriveKey(previous = false, env: NodeJS.ProcessEnv = process.env) {
  const names = previous
    ? ["PII_ENCRYPTION_KEY_PREVIOUS", "BANK_DATA_ENCRYPTION_KEY_PREVIOUS", "TOTP_ENCRYPTION_KEY_PREVIOUS"]
    : ["PII_ENCRYPTION_KEY", "BANK_DATA_ENCRYPTION_KEY", "TOTP_ENCRYPTION_KEY"];
  for (const name of names) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const base = parseBankEncryptionKey(raw);
    if (!base) throw new Error(name + " must be a 32-byte hex or base64 key.");
    // Derive a separate purpose-specific key rather than reusing the same AES key.
    return createHmac("sha256", base).update(PURPOSE).digest();
  }
  return null;
}

/** Always fail closed: portraits must never be stored as plain base64. */
export function encryptProfilePhoto(bytes: Uint8Array, env: NodeJS.ProcessEnv = process.env) {
  const key = deriveKey(false, env);
  if (!key) throw new Error("Secure profile photo encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, data].map((part) => part.toString("base64url")).join(":");
}

export function decryptProfilePhoto(sealed: string, env: NodeJS.ProcessEnv = process.env) {
  if (!sealed.startsWith(PREFIX)) throw new Error("Stored profile photo is not encrypted.");
  const parts = sealed.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Stored profile photo is malformed.");
  const [iv, tag, cipherBytes] = parts.map((part) => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || cipherBytes.length === 0) {
    throw new Error("Stored profile photo has invalid encryption metadata.");
  }
  const keys = [deriveKey(false, env), deriveKey(true, env)].filter((value): value is Buffer => value !== null);
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
    } catch {
      // Previous key is only used during a documented key rotation.
    }
  }
  throw new Error("Profile photo could not be decrypted with the configured keys.");
}
