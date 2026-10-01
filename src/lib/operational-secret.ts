import { createHmac } from "node:crypto";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";

type OperationalSecretKind = "worker" | "readiness";

const ENV_BY_KIND: Record<OperationalSecretKind, string> = {
  worker: "WORKER_TOKEN",
  readiness: "READINESS_TOKEN",
};

const LABEL_BY_KIND: Record<OperationalSecretKind, string> = {
  worker: "linaw:worker-token:v1",
  readiness: "linaw:readiness-token:v1",
};

const MASTER_KEY_ENV = "TOTP_ENCRYPTION_KEY";
const MIN_EXPLICIT_BYTES = 32;

function explicitSecret(kind: OperationalSecretKind, env: NodeJS.ProcessEnv) {
  const name = ENV_BY_KIND[kind];
  const raw = env[name]?.trim();
  if (!raw) return null;
  if (Buffer.byteLength(raw) < MIN_EXPLICIT_BYTES) {
    throw new Error(`${name} must be at least ${MIN_EXPLICIT_BYTES} bytes when configured.`);
  }
  return raw;
}

function masterKey(env: NodeJS.ProcessEnv) {
  const raw = env[MASTER_KEY_ENV];
  if (!raw) return null;
  const parsed = parseBankEncryptionKey(raw);
  if (!parsed) {
    throw new Error(`${MASTER_KEY_ENV} must be exactly 32 bytes as 64 hex characters or base64.`);
  }
  return parsed;
}

export function operationalSecret(
  kind: OperationalSecretKind,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const dedicated = explicitSecret(kind, env);
  if (dedicated) return dedicated;

  const master = masterKey(env);
  if (!master) return null;

  return createHmac("sha256", master)
    .update(LABEL_BY_KIND[kind])
    .digest("base64url");
}

export function operationalSecretSource(
  kind: OperationalSecretKind,
  env: NodeJS.ProcessEnv = process.env,
): "dedicated" | "totp-derived" | null {
  if (env[ENV_BY_KIND[kind]]?.trim()) {
    explicitSecret(kind, env);
    return "dedicated";
  }
  return masterKey(env) ? "totp-derived" : null;
}

export function operationalSecretConfigured(
  kind: OperationalSecretKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return operationalSecretSource(kind, env) !== null;
}
