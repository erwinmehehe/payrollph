import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";

/** Only the exact case row and legal employer may decrypt this ciphertext. */
export type WorkplaceStatementBinding = {
  organizationId: number;
  legalEntityId: number;
  caseId: number;
};
const PREFIX = "enc:ph-workplace-case:v2:";
const PURPOSE = "linaw:protected-workplace-case-statement:v2";
type Env = Readonly<Record<string, string | undefined>>;

function caseAad(binding: WorkplaceStatementBinding): Buffer {
  for (const [key, value] of Object.entries(binding)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid workplace case binding: " + key);
  }
  return Buffer.from(JSON.stringify([PURPOSE, binding.organizationId, binding.legalEntityId, binding.caseId]), "utf8");
}
function keyFor(env: Env, previous = false): Buffer | null {
  const value = env[previous ? "PII_ENCRYPTION_KEY_PREVIOUS" : "PII_ENCRYPTION_KEY"];
  if (!value?.trim()) return null;
  const base = parseBankEncryptionKey(value.trim());
  if (!base) throw new Error("Workplace case PII key must be 32 bytes.");
  return createHmac("sha256", base).update(PURPOSE).digest();
}
/** The case ID is allocated transactionally before sealing; no legacy/plaintext fallback. */
export function sealWorkplaceStatement(
  statement: string, binding: WorkplaceStatementBinding, env: Env = process.env,
): string {
  const aad = caseAad(binding);
  const key = keyFor(env);
  if (!key) throw new Error("Workplace case encryption is not configured.");
  if (statement.trim().length < 20 || statement.length > 4000) throw new Error("Statement must be 20–4000 characters.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const bytes = Buffer.concat([cipher.update(statement.trim(), "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), bytes].map(b => b.toString("base64url")).join(":");
}
export function openWorkplaceStatement(
  sealed: string, binding: WorkplaceStatementBinding, env: Env = process.env,
): string {
  const aad = caseAad(binding);
  if (!sealed.startsWith(PREFIX)) throw new Error("Workplace case ciphertext version is invalid.");
  const parts = sealed.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Workplace case ciphertext is malformed.");
  const [iv, tag, bytes] = parts.map(part => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || bytes.length === 0) throw new Error("Workplace case ciphertext is malformed.");
  for (const key of [keyFor(env), keyFor(env, true)]) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(bytes), decipher.final()]).toString("utf8");
    } catch { /* Key rotation or failed AAD/tag: never return unauthenticated plaintext. */ }
  }
  throw new Error("Workplace case ciphertext could not be decrypted.");
}
