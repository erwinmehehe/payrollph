import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 2;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const SCRYPT_VERSION = "v2";

function deriveScrypt(password: string, salt: string, options?: { N?: number; r?: number; p?: number }) {
  return scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: options?.N ?? SCRYPT_N,
    r: options?.r ?? SCRYPT_R,
    p: options?.p ?? SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = deriveScrypt(password, salt).toString("hex");
  return `scrypt$${SCRYPT_VERSION}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

export function passwordNeedsRehash(stored: string) {
  const [scheme, version, n, r, p] = stored.split("$");
  if (scheme !== "scrypt") return true;
  return (
    version !== SCRYPT_VERSION
    || Number(n) !== SCRYPT_N
    || Number(r) !== SCRYPT_R
    || Number(p) !== SCRYPT_P
  );
}

export function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return false;

  let salt: string;
  let hash: string;
  let options: { N?: number; r?: number; p?: number } | undefined;

  if (parts[1] === SCRYPT_VERSION) {
    const [, , n, r, p, parsedSalt, parsedHash] = parts;
    const N = Number(n);
    const parsedR = Number(r);
    const parsedP = Number(p);
    if (
      !parsedSalt
      || !parsedHash
      || !Number.isInteger(N)
      || !Number.isInteger(parsedR)
      || !Number.isInteger(parsedP)
      || N < 16_384
      || N > SCRYPT_N
      || parsedR < 1
      || parsedR > SCRYPT_R
      || parsedP < 1
      || parsedP > SCRYPT_P
    ) return false;
    salt = parsedSalt;
    hash = parsedHash;
    options = { N, r: parsedR, p: parsedP };
  } else {
    // Legacy hashes used Node's default scrypt parameters. Keep verification
    // compatibility so a successful login can transparently upgrade the hash.
    const [, legacySalt, legacyHash] = parts;
    if (!legacySalt || !legacyHash) return false;
    salt = legacySalt;
    hash = legacyHash;
    options = { N: 16_384, r: 8, p: 1 };
  }

  let derived: Buffer;
  try {
    derived = deriveScrypt(password, salt, options);
  } catch {
    return false;
  }
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== SCRYPT_KEYLEN || derived.length !== expected.length) return false;
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
