import { getSessionUser } from "@/lib/auth";
import { tickScheduler } from "@/lib/scheduler";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workerToken = request.headers.get("x-worker-token");
  const expected = process.env.WORKER_TOKEN;

  if (process.env.NODE_ENV === "production") {
    if (!expected) {
      return Response.json({ error: "Scheduler is disabled until WORKER_TOKEN is configured." }, { status: 503 });
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
  return Response.json({
    scheduler: "worker-triggered",
    result,
  });
}
