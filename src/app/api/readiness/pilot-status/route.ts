import { GET as getDetailedReadiness } from "@/app/api/readiness/route";

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
  const token = process.env.READINESS_TOKEN ?? process.env.WORKER_TOKEN;
  if (!token) {
    return Response.json(
      { status: "unavailable", pilotReady: false, fullLaunchReady: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const internalRequest = new Request("http://internal/api/readiness", {
    headers: { "x-readiness-token": token },
  });
  const response = await getDetailedReadiness(internalRequest);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return Response.json(
      { status: "unavailable", pilotReady: false, fullLaunchReady: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

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
