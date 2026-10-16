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
    // QA_RUNTIME_BRANCH_ATTESTATION: read-only PostgreSQL session metadata. QA branch only.
    // This branch must never be promoted to production. Do not expose DB metadata or credentials.
    if (
      process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "qa/neon-repaired-preview-20261016"
    ) {
      throw new Error("QA preview runtime identity unavailable");
    }
    const identity = await db.execute(sql`
      SELECT (
        pg_catalog.current_database() = 'neondb'
        AND pg_catalog.current_setting('neon.project_id', true) = 'calm-wave-70219564'
        AND pg_catalog.current_setting('neon.branch_id', true) = 'br-green-hat-b77qj8fs'
        AND pg_catalog.current_setting('neon.endpoint_id', true) = 'ep-old-paper-b7k36yuc'
        AND pg_catalog.pg_is_in_recovery() = false
      ) AS "qaTargetMatches"
    `);
    if (identity.rows[0]?.qaTargetMatches !== true) {
      throw new Error("QA database target mismatch");
    }
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
