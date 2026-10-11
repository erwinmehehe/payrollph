import {
  bankEncryptionKeySource,
  bankEncryptionPreviousKeyConfigured,
  decryptBankAccount,
  isEncryptedBankAccount,
  rotateBankAccountEncryption,
} from "../../src/lib/bank-account-crypto";
import {
  classifyStoredBankEnvelope,
  currentBankKeyOnly,
} from "./bank-envelope-inspection";

export type BankRotationPlan =
  | { status: "empty" }
  | { status: "already-current" }
  | { status: "rewrap"; replacement: string };

/** Safely distinguishes current-key ciphertext from verified previous-key ciphertext. */
export function bankRotationPlan(
  stored: unknown,
  env: NodeJS.ProcessEnv = process.env,
): BankRotationPlan {
  if (stored == null || stored === "" || (typeof stored === "string" && !stored.trim())) {
    return { status: "empty" };
  }
  if (typeof stored !== "string" || !isEncryptedBankAccount(stored)) {
    throw new Error("Bank rotation found plaintext or invalid destination evidence; backfill first.");
  }
  const currentOnly = currentBankKeyOnly(env);
  if (bankEncryptionKeySource(currentOnly) !== "dedicated") {
    throw new Error("Bank rotation requires the dedicated current bank encryption key.");
  }

  const current = classifyStoredBankEnvelope(stored, currentOnly);
  if (current === "authenticated") return { status: "already-current" };
  if (!bankEncryptionPreviousKeyConfigured(env)) {
    throw new Error("An unreadable bank envelope has no authorized previous key.");
  }
  const original = decryptBankAccount(stored, env);
  if (!original?.trim()) throw new Error("Bank rotation found an invalid authenticated account.");
  const replacement = rotateBankAccountEncryption(stored, env);
  if (!replacement || classifyStoredBankEnvelope(replacement, currentOnly) !== "authenticated"
    || decryptBankAccount(replacement, currentOnly) !== original) {
    throw new Error("A rotated bank envelope failed current-key authentication.");
  }
  return { status: "rewrap", replacement };
}
