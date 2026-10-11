import {
  bankEncryptionConfigured,
  decryptBankAccount,
  isEncryptedBankAccount,
} from "../../src/lib/bank-account-crypto";

/** Read-only operator proof. A prefix alone is never encryption evidence. */
export type StoredBankEnvelopeState = "empty" | "plaintext" | "authenticated" | "unreadable";

/** Previous/rotation keys may read legacy rows, but do not satisfy current-key cutover. */
export function currentBankKeyOnly(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    BANK_DATA_ENCRYPTION_KEY_PREVIOUS: undefined,
    TOTP_ENCRYPTION_KEY_PREVIOUS: undefined,
  };
}

export function classifyStoredBankEnvelope(
  value: unknown,
  currentOnlyEnv: NodeJS.ProcessEnv,
): StoredBankEnvelopeState {
  if (value == null || value === "") return "empty";
  if (typeof value !== "string") return "unreadable";
  if (!value.trim()) return "empty";
  if (!isEncryptedBankAccount(value)) return "plaintext";
  if (!bankEncryptionConfigured(currentOnlyEnv)) return "unreadable";
  try {
    const verified = decryptBankAccount(value, currentOnlyEnv);
    return verified?.trim() ? "authenticated" : "unreadable";
  } catch {
    return "unreadable";
  }
}
