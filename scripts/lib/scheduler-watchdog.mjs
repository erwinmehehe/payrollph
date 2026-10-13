/**
 * Independent read-only scheduler watchdog.
 * Deploy on a host DIFFERENT from the scheduler worker and Next.js app.
 * It never triggers jobs, reads payroll, or receives WORKER_TOKEN.
 */
const MAX_JSON_BYTES = 8192;
const MAX_LAST_SUCCESS_AGE_MS = 10 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const FAILURE_POLLS = 2;
const RECOVERY_POLLS = 2;
const SAFE_REASON = new Set([
  "healthy", "http-unhealthy", "unexpected-content", "invalid-response",
  "stale-completion", "network-failure",
]);

function fail() {
  throw new Error("SCHEDULER_WATCHDOG_CONFIGURATION_INVALID");
}

function verifyHost(rawHost) {
  if (typeof rawHost !== "string" ||
    !/^[a-z0-9](?:[a-z0-9.-]{1,251})[a-z]{2,}$/.test(rawHost) ||
    rawHost.includes("..") || rawHost.includes("--.") ||
    !rawHost.includes(".") || rawHost.endsWith(".local")) fail();
  return rawHost;
}

function requireHttpsUrl(raw, pinnedHost, requiredPath) {
  const hostname = verifyHost(pinnedHost);
  let url;
  try { url = new URL(raw); } catch { fail(); }
  if (url.protocol !== "https:" || url.hostname !== hostname ||
      url.port || url.username || url.password || url.hash || url.search ||
      !url.pathname.startsWith("/") || url.pathname === "/" ||
      (requiredPath && url.pathname !== requiredPath)) fail();
  return url.toString();
}

export function schedulerWatchdogConfiguration(env) {
  const monitorToken = env?.SCHEDULER_MONITOR_TOKEN;
  if (typeof monitorToken !== "string" ||
      monitorToken !== monitorToken.trim() || /[\r\n]/.test(monitorToken) ||
      /^(?:REPLACE|CHANGE_ME|EXAMPLE|INSERT_|YOUR_)/i.test(monitorToken) ||
      Buffer.byteLength(monitorToken, "utf8") < 32 ||
      (env.WORKER_TOKEN && env.WORKER_TOKEN === monitorToken) ||
      (env.CRON_SECRET && env.CRON_SECRET === monitorToken)) fail();
  const statusUrl = requireHttpsUrl(
    env.SCHEDULER_WATCHDOG_STATUS_URL,
    env.SCHEDULER_WATCHDOG_STATUS_HOST,
    "/api/jobs/status",
  );
  const alertUrl = requireHttpsUrl(
    env.SCHEDULER_WATCHDOG_ALERT_URL,
    env.SCHEDULER_WATCHDOG_ALERT_HOST,
  );
  if (new URL(statusUrl).hostname === new URL(alertUrl).hostname) fail();
  const pollMs = env.SCHEDULER_WATCHDOG_POLL_MS === undefined
    ? 60_000 : Number(env.SCHEDULER_WATCHDOG_POLL_MS);
  if (!Number.isSafeInteger(pollMs) || pollMs < 30_000 || pollMs > 120_000) fail();
  const label = env.SCHEDULER_WATCHDOG_LABEL ?? "payrollph-production";
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(label)) fail();
  return Object.freeze({
    statusUrl, alertUrl, monitorToken, pollMs, label,
    maxAgeMs: MAX_LAST_SUCCESS_AGE_MS,
    failurePolls: FAILURE_POLLS,
    recoveryPolls: RECOVERY_POLLS,
  });
}

async function readJsonWithinLimit(response) {
  if (!response.headers?.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("SCHEDULER_STATUS_NOT_JSON");
  }
  const declared = response.headers.get("content-length");
  if (declared != null &&
      (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new Error("SCHEDULER_STATUS_OVERSIZED");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("SCHEDULER_STATUS_BODY_MISSING");
  }
  const reader = response.body.getReader();
  let count = 0;
  const pieces = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("SCHEDULER_STATUS_BODY_INVALID");
      count += value.byteLength;
      if (count > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new Error("SCHEDULER_STATUS_OVERSIZED");
      }
      pieces.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(pieces, count).toString("utf8"));
}

export function evaluateSchedulerStatus(httpStatus, payload, observedAtMs) {
  if (httpStatus !== 200) return { healthy: false, reason: "http-unhealthy" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.ok !== true || payload.state !== "healthy" ||
      !["running", "completed"].includes(payload.lastLeaseStatus) ||
      typeof payload.lastSuccessfulRunAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload.lastSuccessfulRunAt) ||
      !Number.isSafeInteger(payload.secondsSinceSuccess) ||
      payload.secondsSinceSuccess < 0 || payload.secondsSinceSuccess > 600) {
    return { healthy: false, reason: "invalid-response" };
  }
  const last = Date.parse(payload.lastSuccessfulRunAt);
  const elapsed = observedAtMs - last;
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(last) ||
      !Number.isFinite(elapsed) || elapsed < -MAX_CLOCK_SKEW_MS ||
      elapsed > MAX_LAST_SUCCESS_AGE_MS ||
      Math.abs(elapsed / 1000 - payload.secondsSinceSuccess) > 15) {
    return { healthy: false, reason: "stale-completion" };
  }
  return { healthy: true, reason: "healthy" };
}

export async function fetchSchedulerLiveness(config, { fetcher = fetch, now = Date.now } = {}) {
  try {
    const response = await fetcher(config.statusUrl, {
      method: "GET",
      headers: {
        "x-scheduler-monitor-token": config.monitorToken,
        "Accept": "application/json",
        "Cache-Control": "no-store",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200) return { healthy: false, reason: "http-unhealthy" };
    const result = await readJsonWithinLimit(response);
    return evaluateSchedulerStatus(response.status, result, now());
  } catch {
    // No raw URLs, response bodies, tokens or error strings leave this boundary.
    return { healthy: false, reason: "network-failure" };
  }
}

async function notify(config, event, reason, { fetcher = fetch, now = Date.now } = {}) {
  const safe = SAFE_REASON.has(reason) ? reason : "network-failure";
  const text = "[PayrollPH scheduler] " + event +
    " | " + config.label + " | state=" + safe +
    " | checkedAt=" + new Date(now()).toISOString() +
    ". Automated scheduler status only; no payroll or tenant data.";
  try {
    const response = await fetcher(config.alertUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

/**
 * Stateful monitor process. A failed notification is retried on the next poll.
 * One incident produces one DOWN and one RECOVERED notice (when delivered).
 * Restarting the monitor resets suppression, so use external uptime checks
 * and a supervised singleton deployment for this service itself.
 */
export function createSchedulerWatchdog(config, deps = {}) {
  let failures = 0;
  let successes = 0;
  let alerted = false;
  let outagePending = false;
  let outageReason = "network-failure";
  return {
    async poll() {
      const probe = await fetchSchedulerLiveness(config, deps);
      let notification = "none";
      if (!probe.healthy) {
        failures += 1;
        successes = 0;
        if (failures >= config.failurePolls) {
          outagePending = true;
          outageReason = probe.reason;
        }
      } else {
        successes += 1;
        failures = 0;
      }
      if (outagePending && !alerted) {
        // Keep the outage receipt pending even if the probe recovers before
        // the notification endpoint does; never lose a real DOWN incident.
        const sent = await notify(config, "DOWN", outageReason, deps);
        notification = sent ? "down-delivered" : "down-delivery-failed";
        if (sent) alerted = true;
      } else if (outagePending && alerted && probe.healthy &&
                 successes >= config.recoveryPolls) {
        const sent = await notify(config, "RECOVERED", "healthy", deps);
        notification = sent ? "recovery-delivered" : "recovery-delivery-failed";
        if (sent) {
          alerted = false;
          outagePending = false;
        }
      }
      return {
        healthy: probe.healthy,
        reason: probe.reason,
        alertOpen: alerted,
        notification,
        failures,
        successes,
        productionReleaseApproved: false,
      };
    },
  };
}
