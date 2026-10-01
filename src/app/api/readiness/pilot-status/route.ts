import { bankEncryptionKeyFingerprint } from "@/lib/bank-account-crypto";
import { buildReadinessPayload } from "@/app/api/readiness/route";

export const dynamic = "force-dynamic";

const PILOT_CRITICAL_KEYS = new Set([
  "production-security-config",
  "review-credential",
  "seeded-credentials",
  "email-delivery",
  "bank-data-encryption",
  "malware-scanning",
]);

export async function GET() {
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
      manualLaunchReady,
      criticalBlockers,
      launchBlockers,
      launchBlockersRemaining:
        typeof payload.launchBlockersRemaining === "number"
          ? payload.launchBlockersRemaining
          : null,
      deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentEnvironment: process.env.VERCEL_ENV ?? null,
      bankEncryptionFingerprint: bankEncryptionKeyFingerprint(),
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
