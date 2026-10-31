import { requireGlobalWorkerToken } from "@/lib/global-worker-authorization";
import { drainWebhookRetries } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/**
 * Drains due retries across organizations. Only the operational worker token
 * may trigger this global queue, even in development or preview environments.
 */
export async function POST(request: Request) {
  const denied = requireGlobalWorkerToken(
    request,
    "Webhook worker is disabled until a worker token or TOTP encryption master is configured.",
  );
  if (denied) return denied;

  const results = await drainWebhookRetries(25);
  return Response.json({
    drained: results.length,
    results,
    note: "Backoff schedule: 1m, 5m, 25m, 125m. Deliveries stop after maxAttempts and are marked exhausted.",
  });
}
