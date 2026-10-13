import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * External, default-OFF scheduler transport. GitHub Actions is only a trigger;
 * the application's PostgreSQL lease remains the authority on work ownership.
 * Do not treat an HTTP response as proof of a completed payroll job.
 */
export function schedulerDispatchConfig(env = process.env) {
  if (env.PAYROLL_SCHEDULER_DISPATCH_ENABLED !== "true") return null;

  const originText = env.PAYROLL_SCHEDULER_ORIGIN?.trim();
  const expectedHost = env.PAYROLL_SCHEDULER_EXPECTED_HOST?.trim();
  const token = env.PAYROLL_SCHEDULER_WORKER_TOKEN;
  if (!originText || !expectedHost || !token) {
    throw new Error("Enabled scheduler requires an approved origin, exact host and worker token.");
  }
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(expectedHost) || !expectedHost.includes(".")) {
    throw new Error("Scheduler expected host is invalid.");
  }

  let origin;
  try {
    origin = new URL(originText);
  } catch {
    throw new Error("Scheduler origin is not a valid URL.");
  }
  if (origin.protocol !== "https:" || origin.hostname !== expectedHost
    || origin.port || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== "/"
    || (originText !== origin.origin && originText !== origin.origin + "/")) {
    throw new Error("Scheduler origin must be an exact HTTPS production origin on the approved host.");
  }
  if (token !== token.trim() || /[\r\n]/.test(token) || Buffer.byteLength(token, "utf8") < 32) {
    throw new Error("Scheduler worker credential must be a dedicated 32+ byte secret.");
  }
  return { url: origin.origin + "/api/jobs/tick", token };
}

export async function dispatchSchedulerTick({ env = process.env, fetchImpl = fetch } = {}) {
  const config = schedulerDispatchConfig(env);
  if (!config) return { outcome: "dispatch-disabled" };

  // One request only: no automatic replay after a timeout or uncertain side effects.
  // Lease fencing and downstream financial idempotency are independent safeguards.
  const response = await fetchImpl(config.url, {
    method: "POST",
    headers: { "x-worker-token": config.token, accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    throw new Error("Scheduler endpoint did not acknowledge the tick (HTTP " + response.status + ").");
  }
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Scheduler endpoint did not return JSON.");
  }
  const payload = await response.json();
  if (payload?.scheduler !== "worker-triggered" || typeof payload?.result !== "object"
    || payload.result === null) {
    throw new Error("Scheduler endpoint returned an unexpected acknowledgement.");
  }
  if (payload.result.skipped === true) {
    if (payload.result.reason !== "another-worker" && payload.result.reason !== "interval") {
      throw new Error("Scheduler tick was not accepted for execution.");
    }
    return { outcome: "lease-or-interval-skipped" };
  }
  if (payload.result.skipped !== false && payload.result.skipped !== undefined) {
    throw new Error("Scheduler tick acknowledgement is malformed.");
  }
  return { outcome: "tick-acknowledged" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dispatchSchedulerTick()
    .then(({ outcome }) => {
      // Never print the response body, host, token, tenant data or job payload.
      process.stdout.write("Payroll scheduler: " + outcome + "\n");
    })
    .catch(() => {
      // Sanitized failure: no header, URL, response body or raw exception.
      console.error("Payroll scheduler dispatch failed; inspect protected scheduler monitoring.");
      process.exitCode = 1;
    });
}
