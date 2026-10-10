import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

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
 * Rollout supports legacy reads, but never legacy plaintext writes:
 *   - Reads accept legacy plaintext until the audited backfill is complete.
 *   - BANK_DATA_ENCRYPTION_KEY is the explicit override. When it is absent,
 *     a domain-separated bank key may be derived from TOTP_ENCRYPTION_KEY.
 *   - Without a valid current key, any non-empty write throws in every environment.
 *     A missing key must never silently persist an employee account number.
 *   - scripts/encrypt-bank-accounts.ts backfills pre-existing plaintext rows;
 *     this write guard does not claim that old data is already encrypted.
 *
 * Key rotation is supported with a one-key grace window. Configure the new
 * BANK_DATA_ENCRYPTION_KEY (or TOTP_ENCRYPTION_KEY), place the old key in
 * BANK_DATA_ENCRYPTION_KEY_PREVIOUS (or TOTP_ENCRYPTION_KEY_PREVIOUS), run the
 * rewrap operator pass, verify zero old-key rows remain, then remove the
 * previous-key variable. Reads try current then previous; writes always use the
 * current key. A wrong or missing key still fails closed.
 */

const PREFIX = "enc:v1:";
const KEY_ENV = "BANK_DATA_ENCRYPTION_KEY";
const PREVIOUS_KEY_ENV = "BANK_DATA_ENCRYPTION_KEY_PREVIOUS";
const MASTER_KEY_ENV = "TOTP_ENCRYPTION_KEY";
const PREVIOUS_MASTER_KEY_ENV = "TOTP_ENCRYPTION_KEY_PREVIOUS";
const BANK_KEY_DERIVATION_LABEL = "linaw:bank-account:v1";

export function isEncryptedBankAccount(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Accepts a 32-byte key as 64 hex characters or as base64/base64url. */
export function parseBankEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  // Buffer.from(value, "base64") silently ignores invalid characters and
  // excess padding. That can make a corrupted secret look properly configured.
  // A 32-byte key has 43 Base64 digits and at most one trailing '='.
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) return null;
    // Check canonical round trips, including padded and unpadded Base64URL.
    // This also rejects nonzero unused trailing bits and mixed alphabets.
    const standard = decoded.toString("base64");
    const url = decoded.toString("base64url");
    return [standard, standard.slice(0, -1), url, `${url}=`].includes(value)
      ? decoded
      : null;
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

function configuredPreviousKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const dedicatedRaw = env[PREVIOUS_KEY_ENV];
  if (dedicatedRaw) {
    const dedicated = parseBankEncryptionKey(dedicatedRaw);
    if (!dedicated) throw new Error(`${PREVIOUS_KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
    return dedicated;
  }

  const masterRaw = env[PREVIOUS_MASTER_KEY_ENV];
  if (!masterRaw) return null;
  const master = parseBankEncryptionKey(masterRaw);
  if (!master) throw new Error(`${PREVIOUS_MASTER_KEY_ENV} must be 32 bytes, as 64 hex characters or base64.`);
  return createHmac("sha256", master).update(BANK_KEY_DERIVATION_LABEL).digest();
}

export function bankEncryptionPreviousKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return configuredPreviousKey(env) !== null;
  } catch {
    return false;
  }
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
 * Safe rollout identifier for proving that an operator runner and the live app
 * are using the same high-entropy encryption key. This is deliberately a
 * one-way, domain-separated fingerprint and never exposes key material.
 */
export function bankEncryptionKeyFingerprint(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const key = configuredKey(env);
    if (!key) return null;
    return createHash("sha256")
      .update("linaw:bank-account-key-fingerprint:v1")
      .update(key)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Encrypts a plaintext account number for storage. Null/empty stays null.
 * A missing key fails CLOSED regardless of NODE_ENV. Existing encrypted values
 * are kept only after verifying authenticated decryption, so a forged envelope
 * cannot be persisted on a repeated save.
 */
export function encryptBankAccount(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (value == null) return null;
  const plain = value.trim();
  if (!plain) return null;
  const key = configuredKey(env);
  if (!key) {
    throw new Error(`${KEY_ENV} or a valid ${MASTER_KEY_ENV} is required to store a bank account.`);
  }
  if (isEncryptedBankAccount(plain)) {
    // Prevent malformed or unreadable envelopes from entering the database.
    // During key rotation, decryptBankAccount also verifies the previous key.
    decryptBankAccount(plain, env);
    return plain;
  }

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

  const currentKey = configuredKey(env);
  const previousKey = configuredPreviousKey(env);
  const keys = [currentKey, previousKey].filter((key): key is Buffer => Boolean(key));
  if (keys.length === 0) {
    throw new Error(`A bank account is stored encrypted but neither ${KEY_ENV} nor a rotation key is configured.`);
  }

  const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":");
  if (!iv || !tag || !ciphertext) throw new Error("Stored bank account is malformed.");

  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      // Try the previous rotation key, if configured.
    }
  }
  throw new Error("A stored bank account could not be decrypted with the current or previous rotation key.");
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


/**
 * Re-seals a bank account with the current key. During a rotation this accepts
 * envelopes encrypted by the configured previous key; plaintext legacy values
 * are also sealed. It never preserves the old ciphertext.
 */
export function rotateBankAccountEncryption(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (value == null || !value.trim()) return null;
  if (!configuredKey(env)) {
    throw new Error(`${KEY_ENV} (or ${MASTER_KEY_ENV}) must be configured as the current key before rotation.`);
  }
  const plain = decryptBankAccount(value, env);
  return encryptBankAccount(plain, env);
}
