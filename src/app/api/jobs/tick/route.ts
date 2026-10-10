import { getSessionUser } from "@/lib/auth";
import { tickScheduler } from "@/lib/scheduler";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { operationalSecret } from "@/lib/operational-secret";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workerToken = request.headers.get("x-worker-token");
  const expected = operationalSecret("worker");

  if (process.env.NODE_ENV === "production") {
    if (!expected) {
      return Response.json({ error: "Scheduler is disabled until a worker token or TOTP encryption master is configured." }, { status: 503 });
    }
    if (!constantTimeSecretEqual(workerToken, expected)) {
      return Response.json({ error: "A valid worker token is required." }, { status: 401 });
    }
  } else if (!constantTimeSecretEqual(workerToken, expected)) {
    // Development-only browser fallback uses the session cookie, so it must
    // enforce same-origin before consulting that cookie. A valid worker token
    // remains a server-to-server credential and does not depend on Origin.
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return originDenied;

    const user = await getSessionUser();
    if (!user) return Response.json({ error: "Authentication or a valid worker token is required." }, { status: 401 });
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
