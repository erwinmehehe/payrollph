import { db } from "@/db";
import { sql } from "drizzle-orm";
import { recordHealthSnapshot } from "@/lib/scheduler";
import { constantTimeSecretEqual } from "@/lib/security-secret";

export const dynamic = "force-dynamic";

/**
 * Public health probes expose up/down only and never create database writes.
 * An authenticated monitor can receive latency and persist a history snapshot;
 * anonymous requests never disclose timing or infrastructure details.
 */
export async function GET(request: Request) {
  const started = Date.now();
  const expected = process.env.HEALTH_TOKEN ?? process.env.WORKER_TOKEN;
  const supplied = request.headers.get("x-health-token") ?? request.headers.get("x-worker-token");
  const recordSnapshot = Boolean(expected) && constantTimeSecretEqual(supplied, expected);

  try {
    await db.execute(sql`select 1`);
    const latencyMs = Date.now() - started;
    if (recordSnapshot) {
      try {
        await recordHealthSnapshot(true, latencyMs, "ok");
      } catch {
        // A monitoring history failure must not turn a healthy app into a failed
        // liveness probe.
      }
    }
    return Response.json(recordSnapshot ? { ok: true, latencyMs } : { ok: true }, {
      headers: { "Cache-Control": "no-store", Vary: "x-health-token, x-worker-token" },
    });
  } catch {
    const latencyMs = Date.now() - started;
    if (recordSnapshot) {
      try {
        await recordHealthSnapshot(false, latencyMs, "database unreachable");
      } catch {
        // Ignore snapshot failure; the health response below is authoritative.
      }
    }
    return Response.json(recordSnapshot ? { ok: false, latencyMs } : { ok: false }, {
      status: 500,
      headers: { "Cache-Control": "no-store", Vary: "x-health-token, x-worker-token" },
    });
  }
}
