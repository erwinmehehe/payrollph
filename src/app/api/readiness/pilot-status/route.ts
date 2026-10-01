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

  const pilotReady = criticalBlockers.length === 0 && payload.manualLaunch?.ready === true;
  const fullLaunchReady = payload.status === "launch-ready";

  return Response.json(
    {
      status: pilotReady ? "pilot-ready" : "not-ready",
      pilotReady,
      fullLaunchReady,
      criticalBlockers,
      launchBlockersRemaining:
        typeof payload.launchBlockersRemaining === "number"
          ? payload.launchBlockersRemaining
          : null,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
