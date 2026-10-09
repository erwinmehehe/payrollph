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

export function checkStagingDeployment(httpStatus, payload, expectedSha) {
  if (httpStatus !== 200 || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {ok:false,reason:"staging-deployment-unavailable"};
  }
  // The public read-only deployment metadata must match the exact approved
  // staging build. A production environment must never receive a monitor key.
  if (payload.deploymentSha !== expectedSha ||
      !["preview", "staging"].includes(payload.deploymentEnvironment)) {
    return {ok:false,reason:"staging-deployment-revision-or-environment-mismatch"};
  }
  return {ok:true};
}

export function checkSchedulerResponse(httpStatus, payload, now = new Date()) {
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
  // Never trust an API's claimed relative age without comparing its absolute
  // last-success timestamp. A cached healthy JSON response must fail closed.
  const timestampMs = Date.parse(payload.lastSuccessfulRunAt);
  const ageMs = now.getTime() - timestampMs;
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > 600_000 ||
      Math.abs(ageMs / 1000 - payload.secondsSinceSuccess) > 60) {
    return { ok: false, reason: "stale-or-inconsistent-scheduler-timestamp" };
  }
  return {
    ok: true,
    state: "healthy",
    secondsSinceSuccess: payload.secondsSinceSuccess,
    leaseStatus: payload.lastLeaseStatus,
  };
}

export async function main(env = process.env, fetcher = fetch, now = new Date()) {
  const target = validateStagingTarget(env.PAYROLL_STAGING_URL, env.PAYROLL_STAGING_EXPECTED_HOST,
    env.PAYROLL_PRODUCTION_HOST ?? "");
  if (!env.PAYROLL_STAGING_MONITOR_TOKEN || env.PAYROLL_STAGING_MONITOR_TOKEN.length < 32) {
    throw new Error("A dedicated read-only staging monitor token of at least 32 characters must be configured.");
  }
  const expectedSha = env.PAYROLL_STAGING_EXPECTED_COMMIT_SHA;
  if (typeof expectedSha !== "string" || !/^[0-9a-f]{40}$/i.test(expectedSha)) {
    throw new Error("An exact 40-character staging deployment SHA must be pinned before monitoring.");
  }

  // First confirm the exact deployed build WITHOUT sending the monitor token.
  const deploymentResponse = await fetcher(new URL("/api/readiness/deployment", target), {
    method: "GET",
    headers: { "accept": "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  let deploymentPayload = null;
  if (deploymentResponse.status === 200 &&
      deploymentResponse.headers.get("content-type")?.includes("application/json")) {
    deploymentPayload = await deploymentResponse.json();
  }
  const deployment = checkStagingDeployment(deploymentResponse.status, deploymentPayload, expectedSha);

  // Never transmit the privileged monitoring credential to an unverified build.
  let response = null;
  let payload = null;
  if (deployment.ok) {
    response = await fetcher(target, {
      method: "GET",
      headers: { "x-scheduler-monitor-token": env.PAYROLL_STAGING_MONITOR_TOKEN, "accept": "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 200 && response.headers.get("content-type")?.includes("application/json")) {
      // Do not log the raw response or headers: they may contain operational metadata.
      payload = await response.json();
    }
  }
  const verdict = deployment.ok
    ? checkSchedulerResponse(response.status, payload, now)
    : {ok:false,reason:"staging-deployment-not-verified"};
  // Persist only fixed, reviewed text. Never write upstream HTTP codes,
  // headers or parsed JSON (even if the response is from an allowlisted host).
  const fixedSummary = verdict.ok
    ? "## Payroll staging scheduler — read-only verification\n\nOutcome: PASS (recent scheduler health observed)\n\nThis is not approval for production payroll or worker activation.\n"
    : "## Payroll staging scheduler — read-only verification\n\nOutcome: FAIL (staging health could not be verified)\n\nDo not activate production payroll jobs. Review protected staging diagnostics.\n";
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, fixedSummary);
  process.stdout.write(fixedSummary);
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
