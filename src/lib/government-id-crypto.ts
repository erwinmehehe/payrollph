import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";

const PREFIX = "enc:govid:v1:";
const KEY_ENV = "PII_ENCRYPTION_KEY";
const BANK_KEY_ENV = "BANK_DATA_ENCRYPTION_KEY";
const MASTER_KEY_ENV = "TOTP_ENCRYPTION_KEY";
const DERIVATION_LABEL = "linaw:government-identifiers:v1";

function configuredKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const direct = env[KEY_ENV]?.trim();
  if (direct) {
    const key = parseBankEncryptionKey(direct);
    if (!key) throw new Error(`${KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
    return key;
  }

  const parentRaw = env[BANK_KEY_ENV]?.trim() || env[MASTER_KEY_ENV]?.trim();
  if (!parentRaw) return null;
  const parent = parseBankEncryptionKey(parentRaw);
  if (!parent) {
    throw new Error(`${env[BANK_KEY_ENV] ? BANK_KEY_ENV : MASTER_KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
  }
  return createHmac("sha256", parent).update(DERIVATION_LABEL).digest();
}

export function governmentIdEncryptionConfigured(env: NodeJS.ProcessEnv = process.env) {
  try {
    return configuredKey(env) !== null;
  } catch {
    return false;
  }
}

export function isEncryptedGovernmentId(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptGovernmentId(
  value: string | null | undefined,
  options: { required?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  if (value == null) return null;
  const plain = value.trim();
  if (!plain) return null;
  if (isEncryptedGovernmentId(plain)) return plain;

  const key = configuredKey(options.env ?? process.env);
  if (!key) {
    if (options.required) {
      throw new Error(
        `${KEY_ENV} (or a valid ${BANK_KEY_ENV}/${MASTER_KEY_ENV} fallback) is required before government identifiers can be stored in production.`,
      );
    }
    return plain;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptGovernmentId(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (value == null) return null;
  const stored = value.trim();
  if (!stored) return null;
  if (!isEncryptedGovernmentId(stored)) return stored;

  const key = configuredKey(env);
  if (!key) throw new Error("Government identifier encryption key is not configured.");

  const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":");
  if (!iv || !tag || !ciphertext) throw new Error("Stored government identifier is malformed.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("A stored government identifier could not be decrypted. Check the configured encryption key.");
  }
}

export function maskGovernmentId(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!value?.trim()) return null;
  let plain: string | null;
  try {
    plain = decryptGovernmentId(value, env);
  } catch {
    return "••••";
  }
  if (!plain) return null;
  const digits = plain.replace(/\D/g, "");
  const compact = digits || plain.replace(/\s+/g, "");
  return compact.length <= 4 ? "••••" : `••••${compact.slice(-4)}`;
}
