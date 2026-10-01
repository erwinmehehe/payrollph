import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Field-level encryption for employee bank account numbers.
 *
 * Why this exists: employees.bank_account used to hold the raw account number,
 * and the whole employee row was also sent to the browser. A leaked database
 * backup, a read-only SQL credential, or a log line would have exposed every
 * employee's payroll destination account. Encrypting at rest means the
 * database alone is no longer enough.
 *
 * Format: "enc:v1:<iv>:<tag>:<ciphertext>", each part base64url. AES-256-GCM
 * with a fresh random 96-bit IV per value, so equal account numbers do not
 * produce equal ciphertext, and any tampering fails authentication on read.
 *
 * Rollout is deliberately non-breaking:
 *   - Reads accept both encrypted values and legacy plaintext, so nothing has
 *     to be migrated in one step.
 *   - BANK_DATA_ENCRYPTION_KEY is the explicit override. When it is absent,
 *     production can derive a domain-separated bank key from the already-required
 *     TOTP_ENCRYPTION_KEY. Without either one, writes stay plaintext and readiness
 *     reports the gap instead of pretending the data is protected.
 *   - scripts/encrypt-bank-accounts.ts backfills existing rows.
 *
 * Key rotation is not implemented: the "v1" tag leaves room for it, but a
 * rotation would need a re-encryption pass. Do not change BANK_DATA_ENCRYPTION_KEY
 * or, when using the derived-key fallback, TOTP_ENCRYPTION_KEY without re-encrypting
 * first. A wrong or missing key makes encrypted values unreadable,
 * and this module throws rather than returning garbage into a payout file.
 */

const PREFIX = "enc:v1:";
const KEY_ENV = "BANK_DATA_ENCRYPTION_KEY";
const MASTER_KEY_ENV = "TOTP_ENCRYPTION_KEY";
const BANK_KEY_DERIVATION_LABEL = "linaw:bank-account:v1";

export function isEncryptedBankAccount(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Accepts a 32-byte key as 64 hex characters or as base64/base64url. */
export function parseBankEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function configuredKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const dedicatedRaw = env[KEY_ENV];
  if (dedicatedRaw) {
    const dedicated = parseBankEncryptionKey(dedicatedRaw);
    // A key that is set but malformed is a deployment mistake. Never silently
    // fall back to another secret because that could make an already-encrypted
    // database unreadable after a bad environment-variable edit.
    if (!dedicated) throw new Error(`${KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
    return dedicated;
  }

  const masterRaw = env[MASTER_KEY_ENV];
  if (!masterRaw) return null;
  const master = parseBankEncryptionKey(masterRaw);
  if (!master) throw new Error(`${MASTER_KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);

  // Domain separation: the TOTP master secret is never used directly as an
  // AES key for bank data. A deterministic HMAC-derived 32-byte subkey gives
  // the bank field its own cryptographic domain while avoiding a second secret
  // that cannot currently be provisioned through the connected Vercel tooling.
  return createHmac("sha256", master).update(BANK_KEY_DERIVATION_LABEL).digest();
}

export function bankEncryptionKeySource(
  env: NodeJS.ProcessEnv = process.env,
): "dedicated" | "totp-derived" | null {
  if (env[KEY_ENV]) return parseBankEncryptionKey(env[KEY_ENV]) ? "dedicated" : null;
  if (env[MASTER_KEY_ENV]) return parseBankEncryptionKey(env[MASTER_KEY_ENV]) ? "totp-derived" : null;
  return null;
}

export function bankEncryptionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return bankEncryptionKeySource(env) !== null;
}

/**
 * Encrypts a plaintext account number for storage. Null/empty stays null,
 * already-encrypted values are returned as-is so repeated saves never
 * double-encrypt, and with no key configured the value passes through.
 */
export function encryptBankAccount(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (value == null) return null;
  const plain = value.trim();
  if (!plain) return null;
  if (isEncryptedBankAccount(plain)) return plain;

  const key = configuredKey(env);
  if (!key) return plain;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/**
 * Returns the plaintext account number. Legacy plaintext passes through.
 * Throws if the value is encrypted and cannot be authenticated, which covers a
 * missing key, the wrong key and tampering, so a corrupted value can never
 * reach a bank file or a PayMongo transfer.
 */
export function decryptBankAccount(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (value == null) return null;
  const stored = value.trim();
  if (!stored) return null;
  if (!isEncryptedBankAccount(stored)) return stored;

  const key = configuredKey(env);
  if (!key) {
    throw new Error(`A bank account is stored encrypted but ${KEY_ENV} is not configured.`);
  }

  const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":");
  if (!iv || !tag || !ciphertext) throw new Error("Stored bank account is malformed.");

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("A stored bank account could not be decrypted. Check that the key has not changed.");
  }
}

/**
 * What the browser gets instead of the account number: enough to recognise the
 * account, not enough to use it. Never throws, a payload builder should not
 * fail because one stored value is unreadable.
 */
export function maskBankAccount(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!value?.trim()) return null;
  let plain: string | null;
  try {
    plain = decryptBankAccount(value, env);
  } catch {
    return "••••";
  }
  if (!plain) return null;
  const digits = plain.replace(/\s+/g, "");
  return digits.length <= 4 ? "••••" : `••••${digits.slice(-4)}`;
}

/** Compare two stored values by what they decrypt to, not by their bytes. */
export function sameBankAccount(
  left: string | null | undefined,
  right: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const read = (value: string | null | undefined) => {
    try {
      return (decryptBankAccount(value, env) ?? "").trim();
    } catch {
      // An unreadable value must never compare equal to anything, including itself.
      return null;
    }
  };
  const a = read(left);
  const b = read(right);
  return a !== null && b !== null && a === b;
}
