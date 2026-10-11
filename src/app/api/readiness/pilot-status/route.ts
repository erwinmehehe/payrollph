import { operationalSecret } from "@/lib/operational-secret";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { bankEncryptionKeyFingerprint } from "@/lib/bank-account-crypto";
import { buildReadinessPayload } from "@/app/api/readiness/route";

export const dynamic = "force-dynamic";

const PILOT_CRITICAL_KEYS = new Set([
  "production-security-config",
  "review-credential",
  "seeded-credentials",
  "email-delivery",
  "bank-data-encryption",
  "government-id-encryption",
  "malware-scanning",
]);

function deploymentFields() {
  return {
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploymentEnvironment: process.env.VERCEL_ENV ?? null,
    bankEncryptionFingerprint: bankEncryptionKeyFingerprint(),
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  // Deployment, encryption and readiness diagnostics are private.
  const expected = operationalSecret("readiness");
  if (!expected || !constantTimeSecretEqual(request.headers.get("x-readiness-token"), expected)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const payload = await buildReadinessPayload();
    const gates = Array.isArray(payload.gates) ? payload.gates : [];
    const criticalBlockers = gates
      .filter((gate: any) => PILOT_CRITICAL_KEYS.has(String(gate.key)) && gate.ready !== true)
      .map((gate: any) => String(gate.key));
    const launchBlockers = gates
      .filter((gate: any) => gate.blocks === "launch" && gate.ready !== true)
      .map((gate: any) => String(gate.key));

    const manualLaunchReady = payload.manualLaunch?.ready === true;
    const pilotReady = criticalBlockers.length === 0 && manualLaunchReady;
    const fullLaunchReady = payload.status === "launch-ready";

    return Response.json(
      {
        status: pilotReady ? "pilot-ready" : "not-ready",
        pilotReady,
        fullLaunchReady,
        gaApproved: false,
        externalCertification: "not-evaluated-by-live-probe",
        manualLaunchReady,
        criticalBlockers,
        launchBlockers,
        launchBlockersRemaining:
          typeof payload.launchBlockersRemaining === "number"
            ? payload.launchBlockersRemaining
            : null,
        ...deploymentFields(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Sanitized readiness evaluation failed", error);
    return Response.json(
      {
        status: "not-ready",
        pilotReady: false,
        fullLaunchReady: false,
        gaApproved: false,
        externalCertification: "not-evaluated-by-live-probe",
        manualLaunchReady: false,
        criticalBlockers: ["readiness-internal-error"],
        launchBlockers: ["readiness-internal-error"],
        launchBlockersRemaining: null,
        ...deploymentFields(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
