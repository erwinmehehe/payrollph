import {
  bankEncryptionConfigured,
  decryptBankAccount,
  encryptBankAccount,
  isEncryptedBankAccount,
} from "@/lib/bank-account-crypto";

/**
 * Fail closed at the protected payroll calculation boundary, even if an older
 * bank encryption helper could still pass through legacy plaintext. This is
 * defense in depth; it does not replace the separate mandatory bank-write and
 * release controls in PR #723.
 *
 * A caller must seal all destinations for a chunk BEFORE writing entries.
 * Invalid keys, unreadable existing envelopes or unauthenticated outputs must
 * reject the chunk rather than copy account numbers into payroll traces.
 */
export function sealPayrollPaymentBankAccount(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!value?.trim()) return null;
  if (!bankEncryptionConfigured(env)) {
    throw new Error("A current bank encryption key is required for payroll payment snapshots.");
  }
  const sealed = encryptBankAccount(value, env);
  if (!isEncryptedBankAccount(sealed)) {
    throw new Error("Payroll payment snapshot account encryption failed.");
  }

  // A prefix alone does not prove authenticated encryption; older helpers
  // accepted already-prefixed values without verifying their GCM auth tag.
  const original = decryptBankAccount(value, env);
  const verified = decryptBankAccount(sealed, env);
  if (!original || !verified || verified !== original) {
    throw new Error("Payroll payment snapshot account verification failed.");
  }
  return sealed;
}
