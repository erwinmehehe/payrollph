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
