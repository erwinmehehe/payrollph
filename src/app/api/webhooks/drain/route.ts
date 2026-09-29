import { getSessionUser } from "@/lib/auth";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { drainWebhookRetries } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/**
 * Drains due webhook retries. Production access is worker-token only because
 * this queue spans organizations. Local development may use a signed-in session.
 */
export async function POST(request: Request) {
  const workerToken = request.headers.get("x-worker-token");
  const expected = process.env.WORKER_TOKEN;

  if (process.env.NODE_ENV === "production") {
    if (!expected) {
      return Response.json({ error: "Webhook worker is disabled until WORKER_TOKEN is configured." }, { status: 503 });
    }
    if (!constantTimeSecretEqual(workerToken, expected)) {
      return Response.json({ error: "A valid worker token is required." }, { status: 401 });
    }
  } else if (!constantTimeSecretEqual(workerToken, expected)) {
    const user = await getSessionUser();
    if (!user) return Response.json({ error: "Authentication or a valid worker token is required." }, { status: 401 });
  }

  const results = await drainWebhookRetries(25);
  return Response.json({
    drained: results.length,
    results,
    note: "Backoff schedule: 1m, 5m, 25m, 125m. Deliveries stop after maxAttempts and are marked exhausted.",
  });
}
