import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => randomBytes(4).toString("hex").toUpperCase());
}

const BACKUP_CODE_PREFIX = "sha256:";

export function hashBackupCode(code: string) {
  return `${BACKUP_CODE_PREFIX}${sha256(code.trim().toUpperCase())}`;
}

export function backupCodeMatches(code: string, stored: string) {
  const normalized = code.trim().toUpperCase();
  if (!normalized || !stored) return false;

  if (stored.startsWith(BACKUP_CODE_PREFIX)) {
    const expected = Buffer.from(stored.slice(BACKUP_CODE_PREFIX.length), "hex");
    const actual = Buffer.from(sha256(normalized), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  // Backward-compatible one-time acceptance for legacy plaintext backup codes.
  // A matched legacy code is removed immediately by the login route.
  const actual = Buffer.from(normalized);
  const expected = Buffer.from(stored.trim().toUpperCase());
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
