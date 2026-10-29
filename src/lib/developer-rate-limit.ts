import type { RateLimitResult } from "@/lib/rate-limit-memory";

/**
 * Developer API-key/webhook mutations require a shared, authoritative limiter.
 * The generic distributed limiter intentionally falls back to process-local
 * memory for ordinary availability; credential changes must fail closed.
 */
export function developerMutationRateLimitResponse(
  result: Pick<RateLimitResult, "allowed" | "mode" | "retryAfterMs">,
): Response | null {
  if (result.mode !== "distributed-postgres") {
    return Response.json({
      error: "Developer security changes are temporarily unavailable.",
      code: "DEVELOPER_RATE_LIMIT_BACKEND_UNAVAILABLE",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    return Response.json({
      error: "Too many developer-security changes. Try again later.",
    }, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    });
  }
  return null;
}
