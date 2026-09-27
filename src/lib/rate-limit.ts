import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimit, type RateLimitResult } from "@/lib/rate-limit-memory";

export { rateLimit, clientIp, requestMeta } from "@/lib/rate-limit-memory";
export type { RateLimitResult } from "@/lib/rate-limit-memory";

/**
 * Fixed-window counter held in Postgres, so the limit is shared by every
 * app instance pointing at the same database. One atomic upsert per request:
 * the unique index on (bucket_key, window_start) makes concurrent increments
 * serialize correctly instead of racing.
 */
export async function rateLimitDistributed(
  key: string,
  options?: { limit?: number; windowMs?: number },
): Promise<RateLimitResult> {
  const limit = options?.limit ?? 10;
  const windowMs = options?.windowMs ?? 60_000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  try {
    const result = await db.execute(sql`
      insert into rate_limit_hits (bucket_key, window_start, hits)
      values (${key}, ${windowStart.toISOString()}, 1)
      on conflict (bucket_key, window_start)
      do update set hits = rate_limit_hits.hits + 1
      returning hits
    `);

    const hits = Number((result.rows as Array<{ hits: number }>)[0]?.hits ?? 1);
    const resetAt = windowStart.getTime() + windowMs;

    if (hits > limit) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, resetAt - now), mode: "distributed-postgres" };
    }
    return { allowed: true, remaining: Math.max(0, limit - hits), retryAfterMs: 0, mode: "distributed-postgres" };
  } catch {
    // Database unavailable: fall back to the per-process limiter rather than
    // failing open entirely.
    return rateLimit(key, options);
  }
}

export async function purgeRateLimitWindows(olderThanMs = 3_600_000) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  await db.execute(sql`delete from rate_limit_hits where window_start < ${cutoff}`);
}
