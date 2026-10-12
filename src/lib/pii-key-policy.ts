import { parseBankEncryptionKey } from "./bank-account-crypto";

export function assertProductionPiiKey(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production" && !parseBankEncryptionKey(env.PII_ENCRYPTION_KEY ?? "")) {
    throw new Error("PII_ENCRYPTION_KEY must be a dedicated 32-byte key before production boot.");
  }
}
