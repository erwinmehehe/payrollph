import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = (process.env.PRODUCTION_BASE_URL ?? "").replace(/\/$/, "");
const token = process.env.PRODUCTION_READINESS_TOKEN ?? "";
const rolloutMode = process.env.ROLLOUT_MODE === "full" ? "full" : "pilot";
const expectedCommitSha = (process.env.EXPECTED_COMMIT_SHA ?? "").trim();

const report: Record<string, unknown> = {
  baseUrl,
  rolloutMode,
  expectedCommitSha: expectedCommitSha || null,
  checkedAt: new Date().toISOString(),
  publicSurfaces: [],
  deployment: null,
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
      // Production may still be propagating after the main merge.
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Production surface ${path} did not become healthy (last status ${lastStatus}). Body: ${lastBody.slice(0, 300)}`);
}

async function waitForExpectedDeployment() {
  if (!expectedCommitSha) {
    report.deployment = {
      verified: false,
      reason: "EXPECTED_COMMIT_SHA was not supplied; refusing to treat a generic healthy origin as proof of this release.",
    };
    throw new Error("EXPECTED_COMMIT_SHA is required for production rollout verification.");
  }

  let lastDeploymentSha: string | null = null;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= 24; attempt++) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/readiness/pilot-status`);
      lastStatus = response.status;
      const payload = await response.json().catch(() => ({}));
      lastDeploymentSha = typeof payload.deploymentSha === "string" ? payload.deploymentSha : null;

      if (response.ok && lastDeploymentSha === expectedCommitSha) {
        report.deployment = {
          verified: true,
          expectedCommitSha,
          deploymentSha: lastDeploymentSha,
          deploymentEnvironment: payload.deploymentEnvironment ?? null,
          attempt,
        };
        return;
      }
    } catch {
      // Keep waiting while the Vercel alias moves to the new production build.
    }

    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  report.deployment = {
    verified: false,
    expectedCommitSha,
    deploymentSha: lastDeploymentSha,
    lastStatus,
  };
  throw new Error(
    lastDeploymentSha
      ? `Production is still serving commit ${lastDeploymentSha}; expected ${expectedCommitSha}.`
      : "Production did not expose VERCEL_GIT_COMMIT_SHA, so this release cannot be proven as the deployed commit.",
  );
}

function writeReport() {
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(
    "qa-artifacts/production-rollout-readiness.json",
    JSON.stringify(report, null, 2),
  );
}

async function verifyDetailedReadiness() {
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
    source: "authenticated-detailed",
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

  return {
    status: payload.status,
    manualLaunchReady: payload.manualLaunch?.ready === true,
    launchBlockersRemaining: payload.launchBlockersRemaining,
    launchBlockers,
  };
}

async function verifySanitizedReadiness() {
  const response = await fetchWithTimeout(`${baseUrl}/api/readiness/pilot-status`);
  const payload = await response.json().catch(() => ({}));
  assert.ok(
    response.ok,
    `Sanitized production readiness probe failed (${response.status}): ${JSON.stringify(payload)}`,
  );

  const criticalBlockers = Array.isArray(payload.criticalBlockers)
    ? payload.criticalBlockers.filter((value: unknown): value is string => typeof value === "string")
    : [];
  const launchBlockers = Array.isArray(payload.launchBlockers)
    ? payload.launchBlockers.filter((value: unknown): value is string => typeof value === "string")
    : [];

  report.readiness = {
    source: "server-internal-sanitized",
    status: payload.status,
    pilotReady: payload.pilotReady === true,
    fullLaunchReady: payload.fullLaunchReady === true,
    manualLaunchReady: payload.manualLaunchReady === true,
    criticalBlockers,
    launchBlockers,
    launchBlockersRemaining: payload.launchBlockersRemaining ?? null,
  };

  if (rolloutMode === "pilot") {
    assert.equal(
      payload.pilotReady,
      true,
      `Live pilot is not ready. Critical blockers: ${criticalBlockers.join(", ") || "none reported"}; launch blockers: ${launchBlockers.join(", ") || "none reported"}.`,
    );
  } else {
    assert.equal(
      payload.fullLaunchReady,
      true,
      `Full launch is not ready. Launch blockers: ${launchBlockers.join(", ") || "none reported"}.`,
    );
  }

  return {
    status: payload.status,
    pilotReady: payload.pilotReady === true,
    fullLaunchReady: payload.fullLaunchReady === true,
    criticalBlockers,
    launchBlockers,
    launchBlockersRemaining: payload.launchBlockersRemaining ?? null,
  };
}

async function main() {
  assert.match(baseUrl, /^https:\/\//, "PRODUCTION_BASE_URL must be an HTTPS origin.");

  await waitForSurface("/", /Linaw|payroll/i);
  await waitForSurface("/login", /sign in|log in|email/i);
  await waitForExpectedDeployment();

  const unauthenticated = await fetchWithTimeout(`${baseUrl}/api/readiness`);
  assert.ok(
    unauthenticated.status === 401 || unauthenticated.status === 503,
    `Unauthenticated detailed readiness must be protected or fail-closed in production, got ${unauthenticated.status}.`,
  );

  const result = token.length >= 24
    ? await verifyDetailedReadiness()
    : await verifySanitizedReadiness();

  writeReport();
  console.log(JSON.stringify({ ok: true, rolloutMode, ...result }, null, 2));
}

main().catch((error) => {
  report.error = error instanceof Error ? error.message : String(error);
  writeReport();
  console.error(error);
  process.exitCode = 1;
});
