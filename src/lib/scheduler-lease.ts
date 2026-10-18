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
       -- Expired owners cannot claim either success or failure as a release.
       -- Recovery must use an explicit new acquire; it cannot revive a stale token.
       AND last_run_at >= NOW() - (${LEASE_TIMEOUT_MINUTES} * INTERVAL '1 minute')
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


/**
 * Preserve the last incomplete tick independently of the successful receipt.
 * Store only bounded job identifiers and SQLSTATE/known error codes; never
 * persist exception messages, SQL text, employee data or dispatch payloads.
 * The same row-locked lease fence as successful receipts prevents stale
 * workers from replacing another worker's evidence.
 */
export async function recordSchedulerFailure(
  ownerToken: string,
  failures: ReadonlyArray<{ job: string; message: string }>,
  receiptJobName = "central-scheduler-failure",
  leaseJobName = CENTRAL_SCHEDULER_LEASE,
): Promise<boolean> {
  if (failures.length === 0) throw new Error("A failed scheduler receipt requires a failing job.");
  // Exception text is untrusted and can begin with customer-defined labels.
  // Allow only official PostgreSQL SQLSTATE classes and an explicit internal
  // dispatch code; all other prefixes are deliberately reduced to JOB_FAILED.
  const sqlStateClasses = new Set([
    "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0Z",
    "20", "21", "22", "23", "24", "25", "26", "27", "28", "2B", "2D", "2F",
    "34", "38", "39", "3B", "3D", "3F", "40", "42", "44", "53", "54", "55",
    "57", "58", "F0", "HV", "P0", "XX",
  ]);
  const jobs = failures.slice(0, 64).map(({ job, message }) => {
    const candidate = /^([A-Z0-9_]{4,32})(?::|$)/.exec(message)?.[1];
    const knownCode = candidate === "DISPATCH_UNCONFIRMED"
      || (candidate !== undefined && /^[A-Z0-9]{5}$/.test(candidate)
        && sqlStateClasses.has(candidate.slice(0, 2)));
    return {
      job: /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(job) ? job : "unclassified",
      code: knownCode ? candidate : "JOB_FAILED",
    };
  });
  return recordSchedulerCompletion(
    ownerToken,
    { status: "failed", failureCount: failures.length, truncated: failures.length > 64, jobs },
    receiptJobName,
    leaseJobName,
  );
}
