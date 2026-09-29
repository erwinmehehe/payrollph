import { timingSafeEqual } from "node:crypto";
import { getSessionUser } from "@/lib/auth";

function tokenMatches(supplied: string | null, expected: string) {
  if (!supplied) return false;
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Internal worker endpoints are machine-only in production.
 * Local development may use an authenticated session for manual diagnostics,
 * but a customer session can never trigger scheduler/webhook worker activity
 * on the production deployment.
 */
export async function authorizeInternalWorker(request: Request) {
  const expected = process.env.WORKER_TOKEN;
  const supplied = request.headers.get("x-worker-token");

  if (expected && tokenMatches(supplied, expected)) {
    return { ok: true as const, mode: "worker-token" as const };
  }

  if (process.env.NODE_ENV !== "production") {
    const user = await getSessionUser();
    if (user) return { ok: true as const, mode: "development-session" as const };
  }

  if (!expected) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Internal worker access is disabled until WORKER_TOKEN is configured." },
        { status: 503 },
      ),
    };
  }

  return {
    ok: false as const,
    response: Response.json({ error: "A valid internal worker credential is required." }, { status: 401 }),
  };
}
