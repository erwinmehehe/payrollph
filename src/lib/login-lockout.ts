export const LOGIN_LOCKOUT_THRESHOLD = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export type LoginLockState = {
  locked: boolean;
  retryAfterMs: number;
};

export function currentLoginLock(
  lockedUntil: Date | string | null | undefined,
  now = Date.now(),
): LoginLockState {
  if (!lockedUntil) return { locked: false, retryAfterMs: 0 };
  const until = new Date(lockedUntil).getTime();
  if (!Number.isFinite(until) || until <= now) return { locked: false, retryAfterMs: 0 };
  return { locked: true, retryAfterMs: Math.max(0, until - now) };
}

export function nextFailedLoginState(input: {
  failedLoginAttempts: number;
  lockedUntil: Date | string | null | undefined;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const previousLock = input.lockedUntil ? new Date(input.lockedUntil).getTime() : 0;
  const lockExpired = Number.isFinite(previousLock) && previousLock > 0 && previousLock <= now;
  const previousAttempts = lockExpired ? 0 : Math.max(0, input.failedLoginAttempts);
  const failedLoginAttempts = Math.min(previousAttempts + 1, 1000);
  const shouldLock = failedLoginAttempts >= LOGIN_LOCKOUT_THRESHOLD;

  return {
    failedLoginAttempts,
    lockedUntil: shouldLock ? new Date(now + LOGIN_LOCKOUT_MS) : null,
    justLocked: shouldLock,
  };
}
