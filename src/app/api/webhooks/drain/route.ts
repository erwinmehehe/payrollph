import { authorizeInternalWorker } from "@/lib/internal-worker-auth";
import { drainWebhookRetries } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/**
 * Drains due webhook retries. In production this would be invoked by a cron
 * or worker process; it is exposed here so the retry queue can be observed.
 */
export async function POST(request: Request) {
  const auth = await authorizeInternalWorker(request);
  if (!auth.ok) return auth.response;

  const results = await drainWebhookRetries(25);
  return Response.json({
    drained: results.length,
    results,
    note: "Backoff schedule: 1m, 5m, 25m, 125m. Deliveries stop after maxAttempts and are marked exhausted.",
  });
}
