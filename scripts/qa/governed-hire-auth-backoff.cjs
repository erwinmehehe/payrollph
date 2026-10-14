"use strict";
/**
 * CI-only governed-Hire test helper. Honor the production login limiter's
 * reported wait instead of bypassing, resetting, or disabling the limiter.
 * The caller permits exactly one retry; malformed or account-based 429s
 * without a bounded Retry-After value must fail closed.
 */
function boundedSyntheticLoginWaitMs(status, responseBody) {
  if (status !== 429) return null;
  const ms = responseBody && responseBody.retryAfterMs;
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 60000) {
    throw new Error("Synthetic login 429 had no bounded retryAfterMs");
  }
  return ms + 250; // Explicit window-boundary cushion; at most 60.25 seconds.
}
module.exports = { boundedSyntheticLoginWaitMs };
