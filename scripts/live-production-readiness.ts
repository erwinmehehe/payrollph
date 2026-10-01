import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = (process.env.PRODUCTION_BASE_URL ?? "").replace(/\/$/, "");
const token = process.env.PRODUCTION_READINESS_TOKEN ?? "";
const rolloutMode = process.env.ROLLOUT_MODE === "full" ? "full" : "pilot";

const report: Record<string, unknown> = {
  baseUrl,
  rolloutMode,
  checkedAt: new Date().toISOString(),
  publicSurfaces: [],
  readiness: null,
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForSurface(path: string, expectedText?: RegExp) {
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= 24; attempt++) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`);
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok && (!expectedText || expectedText.test(lastBody))) {
        (report.publicSurfaces as unknown[]).push({ path, status: response.status, ok: true });
        return;
      }
    } catch {
      // Deployment may still be propagating. Retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Production surface ${path} did not become healthy (last status ${lastStatus}). Body: ${lastBody.slice(0, 300)}`);
}

async function main() {
  assert.match(baseUrl, /^https:\/\//, "PRODUCTION_BASE_URL must be an HTTPS origin.");
  assert.ok(token.length >= 24, "PRODUCTION_READINESS_TOKEN must be configured as a GitHub Actions secret.");

  await waitForSurface("/", /Linaw|payroll/i);
  await waitForSurface("/login", /sign in|log in|email/i);

  const unauthenticated = await fetchWithTimeout(`${baseUrl}/api/readiness`);
  assert.equal(
    unauthenticated.status,
    401,
    `Unauthenticated readiness probe should be protected in production, got ${unauthenticated.status}.`,
  );

  const response = await fetchWithTimeout(`${baseUrl}/api/readiness`, {
    headers: { "x-readiness-token": token },
  });
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok, `Authenticated readiness probe failed (${response.status}): ${JSON.stringify(payload)}`);

  const gates = Array.isArray(payload.gates) ? payload.gates : [];
  const gateByKey = new Map(gates.map((gate: any) => [String(gate.key), gate]));
  const pilotCritical = [
    "production-security-config",
    "review-credential",
    "seeded-credentials",
    "email-delivery",
    "bank-data-encryption",
    "malware-scanning",
  ];

  const criticalFailures = pilotCritical
    .map((key) => gateByKey.get(key))
    .filter((gate: any) => !gate || gate.ready !== true);

  const launchBlockers = gates
    .filter((gate: any) => gate.blocks === "launch" && gate.ready !== true)
    .map((gate: any) => ({
      key: gate.key,
      label: gate.label,
      manualWorkaround: gate.manualWorkaround ?? null,
    }));

  report.readiness = {
    status: payload.status,
    launchBlockersRemaining: payload.launchBlockersRemaining,
    scaleGapsRemaining: payload.scaleGapsRemaining,
    manualLaunchReady: payload.manualLaunch?.ready === true,
    criticalFailures: criticalFailures.map((gate: any) => gate?.key ?? "missing-gate"),
    launchBlockers,
  };

  if (rolloutMode === "pilot") {
    assert.equal(
      criticalFailures.length,
      0,
      `Pilot has critical launch failures: ${criticalFailures.map((gate: any) => gate?.label ?? gate?.key ?? "missing gate").join(", ")}`,
    );
    assert.equal(
      payload.manualLaunch?.ready,
      true,
      `Manual pilot is not ready: ${payload.manualLaunch?.summary ?? "No summary returned."}`,
    );
  } else {
    assert.equal(
      payload.status,
      "launch-ready",
      `Full launch is blocked by: ${launchBlockers.map((gate: any) => gate.label).join(", ")}`,
    );
  }

  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(
    "qa-artifacts/production-rollout-readiness.json",
    JSON.stringify(report, null, 2),
  );

  console.log(
    JSON.stringify({
      ok: true,
      rolloutMode,
      status: payload.status,
      manualLaunchReady: payload.manualLaunch?.ready === true,
      launchBlockersRemaining: payload.launchBlockersRemaining,
      launchBlockers,
    }, null, 2),
  );
}

main().catch((error) => {
  mkdirSync("qa-artifacts", { recursive: true });
  report.error = error instanceof Error ? error.message : String(error);
  writeFileSync(
    "qa-artifacts/production-rollout-readiness.json",
    JSON.stringify(report, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
});
