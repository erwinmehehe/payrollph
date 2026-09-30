import { getSessionUser } from "@/lib/auth";
import { drainOutboxRetries } from "@/lib/mailer";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { constantTimeSecretEqual } from "@/lib/security-secret";

export const dynamic = "force-dynamic";

/**
 * Drains queued email after a provider becomes available and retries due
 * non-sensitive failures. Production is worker-token only because this queue
 * spans organizations.
 */
export async function POST(request: Request) {
  const workerToken = request.headers.get("x-worker-token");
  const expected = process.env.WORKER_TOKEN;
  const validWorkerToken = constantTimeSecretEqual(workerToken, expected);

  if (process.env.NODE_ENV === "production") {
    if (!expected) {
      return Response.json(
        { error: "Outbox worker is disabled until WORKER_TOKEN is configured." },
        { status: 503 },
      );
    }
    if (!validWorkerToken) {
      return Response.json({ error: "A valid worker token is required." }, { status: 401 });
    }
  } else if (!validWorkerToken) {
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return originDenied;

    const user = await getSessionUser();
    if (!user) {
      return Response.json(
        { error: "Authentication or a valid worker token is required." },
        { status: 401 },
      );
    }
  }

  const results = await drainOutboxRetries(25);
  return Response.json({
    drained: results.length,
    results,
    note: "Non-sensitive email uses bounded retry backoff. Sensitive one-time-link messages are never replayed after a failed attempt.",
  });
}
