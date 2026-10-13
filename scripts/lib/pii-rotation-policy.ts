import { createHash, timingSafeEqual } from "node:crypto";
import { parseBankEncryptionKey } from "../../src/lib/bank-account-crypto";
import {
  decryptGovernmentId, encryptGovernmentId, isEncryptedGovernmentId,
} from "../../src/lib/government-id-crypto";
import { decryptProfilePhoto, encryptProfilePhoto } from "../../src/lib/ess-photo-crypto";

type CryptoEnv = NodeJS.ProcessEnv;
export type PiiRewrapDecision =
  | { status: "empty" | "already-current" }
  | { status: "rewrap"; replacement: string };

/**
 * An operator backfill must never accept a bank/TOTP key as its "dedicated"
 * PII key, even when the command runs with NODE_ENV=development.
 */
export function requireDedicatedPiiKey(env: CryptoEnv = process.env) {
  const current = parseBankEncryptionKey(env.PII_ENCRYPTION_KEY ?? "");
  if (!current) throw new Error("A valid dedicated PII_ENCRYPTION_KEY is required.");
  // A legacy purpose-derived key is also compromised when its historical
  // bank/TOTP parent is compromised. Never promote it into a current PII key.
  for (const name of [
    "BANK_DATA_ENCRYPTION_KEY", "TOTP_ENCRYPTION_KEY",
    "PII_ENCRYPTION_KEY_PREVIOUS", "PII_LEGACY_GOVERNMENT_ID_KEY",
    "PII_LEGACY_PHOTO_KEY",
  ] as const) {
    const other = parseBankEncryptionKey(env[name] ?? "");
    if (other && timingSafeEqual(current, other)) {
      throw new Error("PII_ENCRYPTION_KEY must be independent of previous, legacy, bank and TOTP keys.");
    }
  }
}

/** Never silently include an old fallback or previous rotation key in verification. */
function currentOnly(env: CryptoEnv): CryptoEnv {
  return { NODE_ENV: env.NODE_ENV ?? "test", PII_ENCRYPTION_KEY: env.PII_ENCRYPTION_KEY };
}

export function planGovernmentIdRewrap(
  stored: unknown,
  env: CryptoEnv = process.env,
): PiiRewrapDecision {
  requireDedicatedPiiKey(env);
  if (stored == null || stored === "") return { status: "empty" };
  if (typeof stored !== "string" || !isEncryptedGovernmentId(stored)) {
    throw new Error("A government identifier is not a recognized encrypted envelope.");
  }
  try {
    if (decryptGovernmentId(stored, currentOnly(env)) !== null) {
      return { status: "already-current" };
    }
  } catch {
    // Continue only through the explicitly configured previous/legacy reader.
  }
  const plain = decryptGovernmentId(stored, env);
  if (!plain) throw new Error("Government identifier authentication failed.");
  const replacement = encryptGovernmentId(plain, { required: true, env: currentOnly(env) });
  if (!replacement || decryptGovernmentId(replacement, currentOnly(env)) !== plain) {
    throw new Error("New government identifier envelope failed authentication.");
  }
  return { status: "rewrap", replacement };
}

/** Verify the photo's independent stored integrity metadata before touching it. */
export function planProfilePhotoRewrap(
  stored: unknown,
  integrity: { contentSha256: string; byteSize: number },
  env: CryptoEnv = process.env,
): PiiRewrapDecision {
  requireDedicatedPiiKey(env);
  if (typeof stored !== "string" || !stored.startsWith("enc:essphoto:v1:")) {
    throw new Error("Profile photo is not a recognized encrypted envelope.");
  }
  const verify = (bytes: Buffer) => {
    if (!Number.isSafeInteger(integrity.byteSize) || integrity.byteSize !== bytes.length ||
        !/^[0-9a-f]{64}$/.test(integrity.contentSha256) ||
        createHash("sha256").update(bytes).digest("hex") !== integrity.contentSha256) {
      throw new Error("Profile photo integrity metadata does not match the stored bytes.");
    }
    return bytes;
  };
  try {
    const bytes = decryptProfilePhoto(stored, currentOnly(env));
    verify(bytes);
    return { status: "already-current" };
  } catch {
    // A tampered current envelope is still rejected by the full read + checksum.
  }
  const bytes = verify(decryptProfilePhoto(stored, env));
  const replacement = encryptProfilePhoto(bytes, currentOnly(env), { required: true });
  if (!decryptProfilePhoto(replacement, currentOnly(env)).equals(bytes)) {
    throw new Error("New profile photo envelope failed authentication.");
  }
  return { status: "rewrap", replacement };
}
