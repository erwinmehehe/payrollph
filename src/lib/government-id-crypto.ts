import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";

const PREFIX = "enc:govid:v1:";
const KEY_ENV = "PII_ENCRYPTION_KEY";
const PREVIOUS_KEY_ENV = "PII_ENCRYPTION_KEY_PREVIOUS";

function configuredKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const direct = env[KEY_ENV]?.trim();
  if (direct) {
    const key = parseBankEncryptionKey(direct);
    if (!key) throw new Error(`${KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
    return key;
  }

  return null;
}

function configuredPreviousKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const direct = env[PREVIOUS_KEY_ENV]?.trim();
  if (direct) {
    const key = parseBankEncryptionKey(direct);
    if (!key) throw new Error(`${PREVIOUS_KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
    return key;
  }

  return null;
}

export function governmentIdPreviousKeyConfigured(env: NodeJS.ProcessEnv = process.env) {
  try {
    return configuredPreviousKey(env) !== null;
  } catch {
    return false;
  }
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
        `${KEY_ENV} is required before government identifiers can be stored.`,
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

  const currentKey = configuredKey(env);
  const previousKey = configuredPreviousKey(env);
  const legacyRaw = criticalReleaseFlagEnabled("piiLegacyRead", env) ? env.PII_LEGACY_GOVERNMENT_ID_KEY : undefined;
  const legacyKey = legacyRaw ? parseBankEncryptionKey(legacyRaw) : null;
  if (legacyRaw && !legacyKey) throw new Error("Invalid legacy government identifier key.");
  const keys = [currentKey, previousKey, legacyKey].filter((key): key is Buffer => Boolean(key));
  if (keys.length === 0) throw new Error("Government identifier encryption key is not configured.");

  const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":");
  if (!iv || !tag || !ciphertext) throw new Error("Stored government identifier is malformed.");
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Try the previous rotation key, if configured.
    }
  }
  throw new Error("A stored government identifier could not be decrypted with the current or previous rotation key.");
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


/** Re-seal a government identifier under the current key during key rotation. */
export function rotateGovernmentIdEncryption(
  value: string | null | undefined,
  options: { required?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  if (value == null || !value.trim()) return null;
  const env = options.env ?? process.env;
  if (!configuredKey(env)) {
    throw new Error(`${KEY_ENV} is required before rotation.`);
  }
  const plain = decryptGovernmentId(value, env);
  return encryptGovernmentId(plain, { ...options, required: true, env });
}
