import { tickScheduler } from "@/lib/scheduler";
import { checkPayrollWorkerDispatchGate } from "@/lib/payroll-worker-dispatch-gate";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { requireGlobalWorkerToken } from "@/lib/global-worker-authorization";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireGlobalWorkerToken(
    request,
    "Scheduler is disabled until a worker token or TOTP encryption master is configured.",
  );
  if (denied) return denied;

  // An external dispatcher that preflighted one release must never execute
  // against a different deployment after a production alias change.
  // Existing internal workers remain compatible when this header is absent.
  const claimedSha = request.headers.get("x-scheduler-deployment-sha");
  if (process.env.NODE_ENV === "production" && claimedSha) {
    const deployedSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(claimedSha) || !deployedSha ||
      !/^[0-9a-f]{40}$/.test(deployedSha) ||
      !constantTimeSecretEqual(claimedSha, deployedSha)) {
      return Response.json({ error: "Scheduler deployment changed; refresh readiness." }, {
        status: 503, headers: { "Cache-Control": "no-store" },
      });
    }
  }

  // Do not trust an earlier GET preflight: a worker can stop before this POST,
  // and a worker-token holder may invoke /api/jobs/tick directly.
  // Enforce the same default-off production worker prerequisite at the final
  // mutating boundary, after authentication and before any scheduler work.
  const worker = await checkPayrollWorkerDispatchGate();
  if (!worker.ok) {
    return Response.json({ error: "Payroll worker heartbeat is missing or unhealthy." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const result = await tickScheduler(true);
  if (result.skipped && result.reason === "scheduler-disabled") {
    // A 200 response would misleadingly imply that an authenticated cron
    // ran successfully when activation was intentionally withheld.
    return Response.json({
      scheduler: "disabled",
      result,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({
    scheduler: "worker-triggered",
    result,
  });
}
