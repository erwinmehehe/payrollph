import { operationalSecret } from "@/lib/operational-secret";
import { constantTimeSecretEqual } from "@/lib/security-secret";

/**
 * Scheduler and webhook retry work crosses employer boundaries. A tenant
 * session is never permission to start global background operations, including
 * in a preview or local development environment.
 */
export function requireGlobalWorkerToken(request: Request, unavailableMessage: string): Response | null {
  const headers = { "Cache-Control": "no-store" };
  const expected = operationalSecret("worker");
  if (!expected) {
    return Response.json({ error: unavailableMessage }, { status: 503, headers });
  }
  if (!constantTimeSecretEqual(request.headers.get("x-worker-token"), expected)) {
    return Response.json({ error: "A valid worker token is required." }, { status: 401, headers });
  }
  return null;
}
