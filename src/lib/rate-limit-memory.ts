import { isIP } from "node:net";

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

/**
 * Only use addresses provided by a *trusted* ingress. A caller can supply
 * arbitrary X-Forwarded-For / X-Real-IP values when no proxy overwrites them.
 * An unknown ingress intentionally shares one bucket instead of granting a
 * fresh rate-limit identity for every spoofed header.
 *
 * Vercel overwrites x-vercel-forwarded-for at its edge. Self-hosted deployments
 * must restrict direct access to the configured, append-only trusted proxies.
 */
export function clientIp(
  request: Request,
  env: Readonly<{ VERCEL?: string; TRUSTED_PROXY_HOPS?: string }> = process.env,
): string {
  if (env.VERCEL === "1") {
    const candidate = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "";
    return isIP(candidate) ? candidate : "unknown";
  }

  const configuredHops = env.TRUSTED_PROXY_HOPS;
  if (configuredHops && /^[1-9]\d*$/.test(configuredHops)) {
    const hops = Number(configuredHops);
    if (hops <= 10) {
      const addresses = (request.headers.get("x-forwarded-for") ?? "")
        .split(",")
        .map((value) => value.trim());
      const candidate = addresses[addresses.length - hops] ?? "";
      if (isIP(candidate)) return candidate;
    }
  }
  return "unknown";
}

/** Device metadata stored with a session so users can audit and revoke logins. */
export function requestMeta(request: Request) {
  return {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request),
  };
}
