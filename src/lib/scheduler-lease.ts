import { sql } from "drizzle-orm";
import { db } from "@/db";

// Durable, single-writer lease shared by the dedicated worker and /api/jobs/tick.
// Do not use a session-level PostgreSQL advisory lock: deployments may use PgBouncer
// transaction pooling, and a held connection could starve a small DB pool.
export const CENTRAL_SCHEDULER_LEASE = "central-scheduler-lease";
const LEASE_TIMEOUT_MINUTES = 15;

export async function acquireSchedulerLease(
  ownerToken: string,
  jobName = CENTRAL_SCHEDULER_LEASE,
): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO scheduler_state (job_name, last_run_at, last_result)
    VALUES (
      ${jobName},
      NOW(),
      jsonb_build_object('status', 'running', 'ownerToken', ${ownerToken}::text, 'startedAt', NOW())
    )
    ON CONFLICT (job_name) DO UPDATE
      SET last_run_at = EXCLUDED.last_run_at,
          last_result = EXCLUDED.last_result
    WHERE scheduler_state.last_result->>'status' IS DISTINCT FROM 'running'
       OR scheduler_state.last_run_at IS NULL
       OR scheduler_state.last_run_at < NOW() - (${LEASE_TIMEOUT_MINUTES} * INTERVAL '1 minute')
    RETURNING id
  `);
  return result.rows.length === 1;
}

export async function refreshSchedulerLease(
  ownerToken: string,
  jobName = CENTRAL_SCHEDULER_LEASE,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE scheduler_state
       SET last_run_at = NOW()
     WHERE job_name = ${jobName}
       AND last_result->>'status' = 'running'
       AND last_result->>'ownerToken' = ${ownerToken}
       -- An expired owner must not revive its own abandoned lease.
       -- Require a new acquire/takeover even when nobody has claimed it yet.
       AND last_run_at >= NOW() - (${LEASE_TIMEOUT_MINUTES} * INTERVAL '1 minute')
    RETURNING id
  `);
  return result.rows.length === 1;
}

export async function releaseSchedulerLease(
  ownerToken: string,
  status: "completed" | "failed",
  jobName = CENTRAL_SCHEDULER_LEASE,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE scheduler_state
       SET last_run_at = NOW(),
           last_result = jsonb_build_object(
             'status', ${status}::text, 'ownerToken', ${ownerToken}::text, 'finishedAt', NOW()
           )
     WHERE job_name = ${jobName}
       AND last_result->>'status' = 'running'
       AND last_result->>'ownerToken' = ${ownerToken}
    RETURNING id
  `);
  return result.rows.length === 1;
}


/**
 * Write the scheduler's final delivery receipt ONLY while the caller holds
 * its live database lease. The SELECT FOR UPDATE and upsert are one Postgres
 * statement, so a lease takeover cannot interleave between the ownership
 * check and the completion record. Uses database time, not process clocks.
 *
 * This fences completion evidence; it cannot undo in-flight side effects.
 */
export async function recordSchedulerCompletion(
  ownerToken: string,
  payload: unknown,
  receiptJobName = "delivery-drain",
  leaseJobName = CENTRAL_SCHEDULER_LEASE,
): Promise<boolean> {
  const serialized = JSON.stringify(payload);
  if (!serialized) throw new Error("A serializable scheduler completion payload is required.");
  const result = await db.execute(sql`
    WITH owned_lease AS MATERIALIZED (
      SELECT id FROM scheduler_state
       WHERE job_name = ${leaseJobName}
         AND last_result->>'status' = 'running'
         AND last_result->>'ownerToken' = ${ownerToken}
         AND last_run_at >= NOW() - (${LEASE_TIMEOUT_MINUTES} * INTERVAL '1 minute')
       FOR UPDATE
    )
    INSERT INTO scheduler_state (job_name, last_run_at, last_result)
    SELECT ${receiptJobName}, NOW(), ${serialized}::jsonb
      FROM owned_lease WHERE true
    ON CONFLICT (job_name) DO UPDATE
      SET last_run_at = EXCLUDED.last_run_at,
          last_result = EXCLUDED.last_result
    RETURNING id
  `);
  return result.rows.length === 1;
}
