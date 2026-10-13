import { createHash, createHmac, randomBytes } from "node:crypto";
import { constantTimeSecretEqual } from "./security-secret";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";

const ttl = 300_000;
function key(env: Readonly<Record<string, string | undefined>>) {
  const raw = env.PUBLIC_INTAKE_PROOF_SECRET;
  if (!raw || raw.trim().length < 32) throw Error("PUBLIC_INTAKE_PROOF_SECRET_REQUIRED");
  return raw;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function issueIntakeProof(email: string, env: Readonly<Record<string, string | undefined>>, now = Date.now()) {
  // Expire at the replay counter's fixed-window boundary, never after it.
  const expires = (Math.floor(now / ttl) + 1) * ttl;
  const payload = Buffer.from(JSON.stringify({ email: digest(email.trim().toLowerCase()), expires, salt: randomBytes(16).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", key(env)).update(payload).digest("hex");
  return { token: payload + "." + signature, difficulty: 16, expires };
}
export function verifyIntakeProof(proof: unknown, email: string, env: Readonly<Record<string, string | undefined>>, now = Date.now()) {
  if (!proof || typeof proof !== "object") return false;
  const { token, nonce } = proof as { token?: unknown; nonce?: unknown };
  if (typeof token !== "string" || token.length > 1024 || !Number.isSafeInteger(nonce) || Number(nonce) < 0 || Number(nonce) > 0xffffffff) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return false;
  if (!constantTimeSecretEqual(parts[1], createHmac("sha256", key(env)).update(parts[0]).digest("hex"))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (payload.email !== digest(email.trim().toLowerCase()) || !Number.isSafeInteger(payload.expires) || payload.expires <= now || payload.expires > now + ttl) return false;
    return digest(token + ":" + nonce).startsWith("0000");
  } catch { return false; }
}

export async function consumeIntakeProof(input: {
  proof: unknown; email: string; env: Readonly<Record<string, string | undefined>>; now?: number;
  claim: (tokenHash: string) => Promise<{ allowed: boolean; mode: string }>;
}) {
  if (!criticalReleaseFlagEnabled("publicIntakeProof", input.env)) return "disabled" as const;
  if (!verifyIntakeProof(input.proof, input.email, input.env, input.now)) return "invalid" as const;
  const claim = await input.claim(digest((input.proof as { token: string }).token));
  if (claim.mode !== "distributed-postgres") return "unavailable" as const;
  return claim.allowed ? "accepted" as const : "replayed" as const;
}
