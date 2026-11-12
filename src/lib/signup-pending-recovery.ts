import { createHash, randomInt } from "node:crypto";

/** Resend must never extend a never-verified registration's absolute lifetime. */
export const PENDING_SIGNUP_MAX_AGE_MS = 24 * 60 * 60_000;
export const GENERIC_SIGNUP_ACCEPTED = Object.freeze({
  ok: true,
  message: "If the address is eligible, follow the instructions sent to its mailbox, or sign in if using an invitation.",
});

export function expiredUnverifiedSignup(
  record: Readonly<{ active: boolean; verifiedAt: Date | null; createdAt: Date | null }>,
  now = Date.now(),
): boolean {
  return record.active === false && record.verifiedAt === null
    && record.createdAt instanceof Date && Number.isFinite(record.createdAt.getTime())
    && record.createdAt.getTime() <= now - PENDING_SIGNUP_MAX_AGE_MS;
}

/** Transaction-scoped serialization also covers an email with no user row yet. */
export function signupLockKey(normalizedEmail: string): string {
  const digest = createHash("sha256").update("signup:" + normalizedEmail).digest("hex");
  return BigInt.asIntN(64, BigInt("0x" + digest.slice(0, 16))).toString();
}

/** Drizzle can wrap the PostgreSQL error in cause; do not mask other failures. */
export function isSignupEmailConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (record.code === "23505" && record.constraint === "users_email_unique") return true;
    current = record.cause;
  }
  return false;
}

/** A coarse timing floor is not a constant-time guarantee for slow providers. */
export async function signupAcceptedResponse(startedAt: number): Promise<Response> {
  const remainingMs = Math.max(0, startedAt + 700 + randomInt(0, 80) - Date.now());
  if (remainingMs > 0) await new Promise<void>(resolve => setTimeout(resolve, remainingMs));
  return Response.json(GENERIC_SIGNUP_ACCEPTED, {
    status: 202, headers: { "Cache-Control": "no-store" },
  });
}
