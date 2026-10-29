import type { RateLimitResult } from "@/lib/rate-limit";

/**
 * Extended public API access requires the shared PostgreSQL limiter.
 * An individual worker's in-memory fallback cannot enforce cross-instance
 * quotas, so refuse access whether that fallback locally permits or denies.
 */
export function publicApiV1RateGate(result: RateLimitResult): Response | null {
  if (result.mode !== "distributed-postgres") {
    return Response.json({ error: "Public API temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (result.allowed) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return Response.json({ error: "Rate limit exceeded." }, {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
