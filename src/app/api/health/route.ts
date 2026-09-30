import { db } from "@/db";
import { sql } from "drizzle-orm";
import { recordHealthSnapshot } from "@/lib/scheduler";
import { constantTimeSecretEqual } from "@/lib/security-secret";

export const dynamic = "force-dynamic";

/**
 * Public health probes are read-only. Historical snapshots are recorded only
 * by an authenticated monitor so an anonymous caller cannot create database
 * write amplification by polling this endpoint.
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
    return Response.json({ ok: true, latencyMs });
  } catch {
    const latencyMs = Date.now() - started;
    if (recordSnapshot) {
      try {
        await recordHealthSnapshot(false, latencyMs, "database unreachable");
      } catch {
        // Ignore snapshot failure; the health response below is authoritative.
      }
    }
    return Response.json({ ok: false, latencyMs }, { status: 500 });
  }
}
