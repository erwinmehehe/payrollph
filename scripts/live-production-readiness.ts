import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = (process.env.PRODUCTION_BASE_URL ?? "").replace(/\/$/, "");
const token = process.env.PRODUCTION_READINESS_TOKEN ?? "";
const rolloutMode =
  process.env.ROLLOUT_MODE === "full"
    ? "full"
    : process.env.ROLLOUT_MODE === "pilot"
      ? "pilot"
      : "code";
const expectedCommitSha = (process.env.EXPECTED_COMMIT_SHA ?? "").trim();

type RemediationOwner = "deployment" | "operations" | "payroll" | "compliance";
type Remediation = { key: string; owner: RemediationOwner; action: string };

const blockerRemediation: Record<string, Omit<Remediation, "key">> = {
  "production-security-config": {
    owner: "deployment",
    action: "Set APP_BASE_URL to the canonical HTTPS production origin and configure a valid 32-byte TOTP_ENCRYPTION_KEY, then redeploy.",
  },
  "review-credential": {
    owner: "operations",
    action: "Rotate the public review account password so no production user can authenticate with the documented demo credential.",
  },
  "seeded-credentials": {
    owner: "deployment",
    action: "Set DEMO_MODE=false in production and redeploy so shared demo credentials are never provisioned into a customer deployment.",
  },
  "email-delivery": {
    owner: "deployment",
    action: "Configure the transactional mail provider plus its delivery webhook secret, send a real test/invite, and confirm a provider-delivered event is recorded.",
  },
  "bank-data-encryption": {
    owner: "deployment",
    action: "Configure BANK_DATA_ENCRYPTION_KEY (or the production TOTP master), then run the Production Bank Encryption workflow in dry-run and apply modes until zero plaintext bank values remain.",
  },
  "government-id-encryption": {
    owner: "deployment",
    action: "Configure PII_ENCRYPTION_KEY (or an approved domain-separated fallback), run scripts/encrypt-government-ids.ts in dry-run and --apply modes, and verify zero plaintext employee/contractor government identifiers remain.",
  },
  "malware-scanning": {
    owner: "deployment",
    action: "Keep document uploads disabled, or configure and verify the malware scanner before enabling uploads.",
  },
  billing: {
    owner: "operations",
    action: "Complete one real paid invoice/subscription, or run manual-activate-subscription only after independently confirming the customer payment.",
  },
  "bank-validation": {
    owner: "payroll",
    action: "For automated payout, configure the live payout provider, wallet/source account, signed webhook, and pass the no-money preflight. Manual bank-file upload remains the pilot workaround.",
  },
  "production-pilot-signoff": {
    owner: "payroll",
    action: "Release one controlled production payroll, reconcile it against independently prepared figures, and record the Owner production-pilot sign-off.",
  },
  "gov-bir-alphalist": {
    owner: "compliance",
    action: "Use the generated BIR file/extract with the agency workflow and record an accepted file-upload validation with its agency reference.",
  },
  "gov-sss-r3": {
    owner: "compliance",
    action: "Upload the generated SSS R-3 file and record an accepted validation with the PRN or acknowledgement reference.",
  },
  "gov-philhealth-rf1": {
    owner: "compliance",
    action: "Use the generated PhilHealth RF-1 file with the agency workflow and record an accepted file-upload validation with the ePAR/acknowledgement reference.",
  },
  "gov-pagibig-mcrf": {
    owner: "compliance",
    action: "Use the generated Pag-IBIG MCRF file with the applicable employer workflow and record an accepted file-upload validation with its OPIN/confirmation reference.",
  },
};

function remediationFor(keys: string[]): Remediation[] {
  return [...new Set(keys)]
    .map((key) => blockerRemediation[key] ? { key, ...blockerRemediation[key] } : null)
    .filter((item): item is Remediation => item !== null);
}

function remediationSummary(items: Remediation[]) {
  return items.length === 0
    ? "No mapped remediation is available."
    : items.map((item, index) => `${index + 1}. [${item.owner}] ${item.key}: ${item.action}`).join("\n");
}

const report: Record<string, unknown> = {
  baseUrl,
  rolloutMode,
  expectedCommitSha: expectedCommitSha || null,
  externalCertification: "not-assessed-by-live-readiness-probe",
  gaApproved: false,
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
      const response = await fetchWithTimeout(`${baseUrl}/api/readiness/deployment`);
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
    "government-id-encryption",
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

  const criticalFailureKeys = criticalFailures.map((gate: any) => gate?.key ?? "missing-gate");
  const remediation = remediationFor([
    ...criticalFailureKeys,
    ...launchBlockers.map((gate: any) => String(gate.key)),
  ]);

  report.readiness = {
    source: "authenticated-detailed",
    status: payload.status,
    launchBlockersRemaining: payload.launchBlockersRemaining,
    scaleGapsRemaining: payload.scaleGapsRemaining,
    manualLaunchReady: payload.manualLaunch?.ready === true,
    criticalFailures: criticalFailureKeys,
    launchBlockers,
    remediation,
  };

  if (rolloutMode === "pilot") {
    assert.equal(
      criticalFailures.length,
      0,
      `Pilot has critical launch failures: ${criticalFailures.map((gate: any) => gate?.label ?? gate?.key ?? "missing gate").join(", ")}.\nNext steps:\n${remediationSummary(remediation)}`,
    );
    assert.equal(
      payload.manualLaunch?.ready,
      true,
      `Manual pilot is not ready: ${payload.manualLaunch?.summary ?? "No summary returned."}\nNext steps:\n${remediationSummary(remediation)}`,
    );
  } else if (rolloutMode === "full") {
    assert.equal(
      payload.status,
      "launch-ready",
      `Full launch is blocked by: ${launchBlockers.map((gate: any) => gate.label).join(", ")}.\nNext steps:\n${remediationSummary(remediation)}`,
    );
  } else {
    assert.ok(gates.length > 0, "Readiness endpoint returned no gates.");
  }

  return {
    status: payload.status,
    codeReady: rolloutMode === "code",
    manualLaunchReady: payload.manualLaunch?.ready === true,
    launchBlockersRemaining: payload.launchBlockersRemaining,
    launchBlockers,
  };
}

async function verifySanitizedReadiness() {
  assert.ok(token.length >= 24, "PRODUCTION_READINESS_TOKEN is required for the private pilot-readiness probe.");
  const response = await fetchWithTimeout(`${baseUrl}/api/readiness/pilot-status`, {
    headers: { "x-readiness-token": token },
  });
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

  const remediation = remediationFor([...criticalBlockers, ...launchBlockers]);

  report.readiness = {
    source: "server-internal-sanitized",
    status: payload.status,
    pilotReady: payload.pilotReady === true,
    fullLaunchReady: payload.fullLaunchReady === true,
    manualLaunchReady: payload.manualLaunchReady === true,
    criticalBlockers,
    launchBlockers,
    launchBlockersRemaining: payload.launchBlockersRemaining ?? null,
    remediation,
  };

  if (rolloutMode === "pilot") {
    assert.equal(
      payload.pilotReady,
      true,
      `Live pilot is not ready. Critical blockers: ${criticalBlockers.join(", ") || "none reported"}; launch blockers: ${launchBlockers.join(", ") || "none reported"}.\nNext steps:\n${remediationSummary(remediation)}`,
    );
  } else if (rolloutMode === "full") {
    assert.equal(
      payload.fullLaunchReady,
      true,
      `Full launch is not ready. Launch blockers: ${launchBlockers.join(", ") || "none reported"}.\nNext steps:\n${remediationSummary(remediation)}`,
    );
  } else {
    assert.equal(typeof payload.status, "string", "Sanitized readiness response is missing status.");
    assert.ok(
      !criticalBlockers.includes("readiness-internal-error"),
      "Readiness evaluation failed internally; code readiness cannot be proven.",
    );
  }

  return {
    status: payload.status,
    codeReady: rolloutMode === "code",
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
  console.log(JSON.stringify({ ok: true, rolloutMode, gaApproved: false, externalCertification: "not-assessed-by-live-readiness-probe", ...result }, null, 2));
}

main().catch((error) => {
  report.error = error instanceof Error ? error.message : String(error);
  writeReport();
  console.error(error);
  process.exitCode = 1;
});
