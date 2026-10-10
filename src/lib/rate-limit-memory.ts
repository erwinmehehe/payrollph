export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  mode: "single-instance" | "distributed-postgres";
};

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

/**
 * In-memory sliding window. Correct only within one process.
 * Used as the fallback when the database is unreachable.
 */
export function rateLimit(key: string, options?: { limit?: number; windowMs?: number }): RateLimitResult {
  const limit = options?.limit ?? 10;
  const windowMs = options?.windowMs ?? 60_000;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);

  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, windowMs - (now - oldest)),
      mode: "single-instance",
    };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: Math.max(0, limit - bucket.timestamps.length), retryAfterMs: 0, mode: "single-instance" };
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "127.0.0.1";
}

/** Device metadata stored with a session so users can audit and revoke logins. */
export function requestMeta(request: Request) {
  return {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request),
  };
}
