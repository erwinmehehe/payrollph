import { randomInt } from "node:crypto";

/** Pending signup ownership is never perpetual: resend cannot extend this lifetime. */
export const PENDING_SIGNUP_MAX_AGE_MS = 24 * 60 * 60_000;

export const GENERIC_SIGNUP_ACCEPTED = Object.freeze({
  ok: true,
  message: "If the address is eligible, follow the instructions sent to its mailbox, or sign in if using an invitation.",
});

/** Never release a verified or activated account, even when it is subsequently disabled. */
export function expiredUnverifiedSignup(
  record: Readonly<{ active: boolean; verifiedAt: Date | null; createdAt: Date | null }>,
  now = Date.now(),
): boolean {
  return record.active === false
    && record.verifiedAt === null
    && record.createdAt instanceof Date
    && Number.isFinite(record.createdAt.getTime())
    && record.createdAt.getTime() < now - PENDING_SIGNUP_MAX_AGE_MS;
}

/**
 * Match successful public-response shape and coarse timing for new, pending,
 * verified, and invited addresses. This is bounded latency equalization, not
 * a constant-time guarantee against arbitrary external provider latency.
 */
export async function signupAcceptedResponse(startedAt: number): Promise<Response> {
  const minimumMs = 700 + randomInt(0, 80);
  const remainingMs = Math.max(0, startedAt + minimumMs - Date.now());
  if (remainingMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
  return Response.json(GENERIC_SIGNUP_ACCEPTED, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}
