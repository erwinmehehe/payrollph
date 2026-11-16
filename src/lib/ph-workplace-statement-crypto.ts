import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";

const PREFIX = "enc:ph-workplace-case:v1:";
const PURPOSE = "linaw:protected-workplace-case-statement:v1";
type Env = Readonly<Record<string, string | undefined>>;

function keyFor(env: Env, previous = false): Buffer | null {
  const value = env[previous ? "PII_ENCRYPTION_KEY_PREVIOUS" : "PII_ENCRYPTION_KEY"];
  if (!value?.trim()) return null;
  const base = parseBankEncryptionKey(value.trim());
  if (!base) throw new Error("Workplace case PII key must be 32 bytes.");
  return createHmac("sha256", base).update(PURPOSE).digest();
}
/** Always encrypt; no plaintext legacy fallback or silent unauthenticated mode. */
export function sealWorkplaceStatement(statement: string, env: Env = process.env): string {
  const key = keyFor(env);
  if (!key) throw new Error("Workplace case encryption is not configured.");
  if (statement.trim().length < 20 || statement.length > 4000) throw new Error("Statement must be 20–4000 characters.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(statement.trim(), "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), bytes].map(b => b.toString("base64url")).join(":");
}
export function openWorkplaceStatement(sealed: string, env: Env = process.env): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("Workplace case ciphertext is invalid.");
  const parts = sealed.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Workplace case ciphertext is malformed.");
  const [iv, tag, bytes] = parts.map(part => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || bytes.length === 0) throw new Error("Workplace case ciphertext is malformed.");
  for (const key of [keyFor(env), keyFor(env, true)]) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(bytes), decipher.final()]).toString("utf8");
    } catch { /* key rotation; never fall back to plaintext */ }
  }
  throw new Error("Workplace case ciphertext could not be decrypted.");
}
