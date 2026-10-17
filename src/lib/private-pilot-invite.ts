import { createHash, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[a-f0-9]{64}$/i;

/**
 * A short-lived, one-email pilot invitation when outbound email is not ready.
 * Never enables paid enrollment, money movement or access for other addresses.
 * Configure *only SHA-256 digests* in the server environment.
 */
export function privatePilotInviteReady(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): boolean {
  if (env.PRIVATE_PILOT_INVITE_ENABLED !== "true") return false;
  if (!HEX_SHA256.test(env.PRIVATE_PILOT_INVITE_EMAIL_SHA256 ?? "")) return false;
  if (!HEX_SHA256.test(env.PRIVATE_PILOT_INVITE_CODE_SHA256 ?? "")) return false;
  const expiresAt = Date.parse(env.PRIVATE_PILOT_INVITE_EXPIRES_AT ?? "");
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Possession of the code is required; claiming an arbitrary email is never enough. */
export function validPrivatePilotInvite(
  email: string,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): boolean {
  if (!privatePilotInviteReady(env, now)) return false;
  if (typeof code !== "string" || code.length < 40 || code.length > 256) return false;
  if (typeof email !== "string" || email.length > 180) return false;

  const emailDigest = Buffer.from(env.PRIVATE_PILOT_INVITE_EMAIL_SHA256!, "hex");
  const codeDigest = Buffer.from(env.PRIVATE_PILOT_INVITE_CODE_SHA256!, "hex");
  const suppliedEmail = hash(email.trim().toLowerCase());
  const suppliedCode = hash(code);
  // Hashes always have equal lengths. Both comparisons must execute.
  const emailMatches = timingSafeEqual(suppliedEmail, emailDigest);
  const codeMatches = timingSafeEqual(suppliedCode, codeDigest);
  return emailMatches && codeMatches;
}
