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

const UNVERIFIED_CLIENT_IP = "unknown";

function validatedIp(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return isIP(candidate) ? candidate : null;
}

/** Read the address inserted by the final trusted hop, not the spoofable first entry. */
function forwardedIp(header: string | null, trustedHops: number): string | null {
  if (!header || trustedHops < 1) return null;
  const chain = header.split(",");
  return validatedIp(chain[chain.length - trustedHops]);
}

/**
 * Rate-limit identity from verified proxy information only.
 * Vercel sets VERCEL=1 and controls x-vercel-forwarded-for (or x-forwarded-for).
 * On self-hosted deployments, the operator must specify the exact number of
 * trusted reverse proxies with TRUSTED_PROXY_HOPS. Never use x-real-ip or the
 * leftmost untrusted X-Forwarded-For value as an IP limiter identity.
 *
 * When provenance is unknown, share one conservative unknown bucket rather
 * than allow spoofed headers to manufacture unlimited fresh buckets.
 */
export function clientIp(request: Request): string {
  if (process.env.VERCEL === "1") {
    return forwardedIp(request.headers.get("x-vercel-forwarded-for"), 1)
      ?? forwardedIp(request.headers.get("x-forwarded-for"), 1)
      ?? UNVERIFIED_CLIENT_IP;
  }

  const configured = process.env.TRUSTED_PROXY_HOPS ?? "";
  const trustedHops = /^[1-9]\d?$/.test(configured) ? Number(configured) : 0;
  if (trustedHops < 1 || trustedHops > 8) return UNVERIFIED_CLIENT_IP;
  return forwardedIp(request.headers.get("x-forwarded-for"), trustedHops)
    ?? UNVERIFIED_CLIENT_IP;
}

/** Device metadata stored with a session so users can audit and revoke logins. */
export function requestMeta(request: Request) {
  return {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request),
  };
}
