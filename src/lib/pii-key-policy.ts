import { timingSafeEqual } from "node:crypto";
import { parseBankEncryptionKey } from "./bank-account-crypto";

export function assertProductionPiiKey(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  const pii = parseBankEncryptionKey(env.PII_ENCRYPTION_KEY ?? "");
  if (!pii) {
    throw new Error("PII_ENCRYPTION_KEY must be a dedicated 32-byte key before production boot.");
  }
  // An independent variable is not a dedicated key if it reuses an existing
  // bank or authentication secret. Reject key reuse before accepting traffic.
  for (const value of [env.BANK_DATA_ENCRYPTION_KEY, env.TOTP_ENCRYPTION_KEY]) {
    const other = parseBankEncryptionKey(value ?? "");
    if (other && timingSafeEqual(pii, other)) {
      throw new Error("PII_ENCRYPTION_KEY must not reuse bank or TOTP encryption keys.");
    }
  }
}
