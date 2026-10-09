#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateStagingTarget(baseUrl, expectedHost, productionHost = "") {
  if (!baseUrl || !expectedHost || !productionHost) throw new Error("Configured staging URL, expected staging hostname and production hostname are required.");
  const url = new URL(baseUrl);
  const host = expectedHost.toLowerCase().trim();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || url.hostname.toLowerCase() !== host || url.port ||
      host === productionHost.toLowerCase().trim()) {
    throw new Error("Staging target must be HTTPS, root-only, and match the configured nonproduction hostname.");
  }
  return new URL("/api/jobs/status", url);
}

export function checkSchedulerResponse(httpStatus, payload) {
  if (httpStatus !== 200 || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "missing-or-unhealthy-scheduler" };
  }
  if (payload.ok !== true || payload.state !== "healthy" ||
      typeof payload.secondsSinceSuccess !== "number" ||
      !Number.isFinite(payload.secondsSinceSuccess) || payload.secondsSinceSuccess < 0 ||
      payload.secondsSinceSuccess > 600 ||
      typeof payload.lastSuccessfulRunAt !== "string" ||
      !Number.isFinite(Date.parse(payload.lastSuccessfulRunAt)) ||
      !["completed", "running"].includes(payload.lastLeaseStatus)) {
    return { ok: false, reason: "invalid-or-stale-scheduler-evidence" };
  }
  return {
    ok: true,
    state: "healthy",
    secondsSinceSuccess: payload.secondsSinceSuccess,
    leaseStatus: payload.lastLeaseStatus,
  };
}

export async function main(env = process.env, fetcher = fetch) {
  const target = validateStagingTarget(env.PAYROLL_STAGING_URL, env.PAYROLL_STAGING_EXPECTED_HOST,
    env.PAYROLL_PRODUCTION_HOST ?? "");
  if (!env.PAYROLL_STAGING_MONITOR_TOKEN || env.PAYROLL_STAGING_MONITOR_TOKEN.length < 32) {
    throw new Error("A dedicated read-only staging monitor token of at least 32 characters must be configured.");
  }
  const response = await fetcher(target, {
    method: "GET",
    headers: { "x-scheduler-monitor-token": env.PAYROLL_STAGING_MONITOR_TOKEN, "accept": "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  let payload = null;
  if (response.status === 200 && response.headers.get("content-type")?.includes("application/json")) {
    // Do not log the raw response or headers: they may contain operational metadata.
    payload = await response.json();
  }
  const verdict = checkSchedulerResponse(response.status, payload);
  const text = [
    "## Payroll staging scheduler — read-only verification",
    "",
    "Observed HTTP status: " + response.status,
    "Outcome: " + (verdict.ok ? "PASS (observed health only)" : "FAIL"),
    "Reason: " + (verdict.ok ? "recent completed scheduler tick" : verdict.reason),
    "",
    "This check does not execute jobs, verify a two-worker race, authorize payroll",
    "or establish production deployment, bank or employer reconciliation approval.",
  ].join("\n") + "\n";
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  process.stdout.write(text);
  if (!verdict.ok) process.exitCode = 1;
  return verdict;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    // Intentionally never print URL/token/request headers or upstream response.
    console.error("Staging scheduler check failed; verify protected staging configuration and health status.");
    process.exitCode = 1;
  });
}
