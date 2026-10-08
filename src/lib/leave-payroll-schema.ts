import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

/**
 * Vercel deployments do not run drizzle db:push against the connected
 * production database. Keep the leave-payroll schema change idempotent at the
 * request/worker boundary so older databases upgrade before Drizzle selects the
 * new columns.
 */
export async function ensureLeavePayrollSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_leave_payroll_schema_v1'))");
      await client.query(`
        ALTER TABLE leave_policies
          ADD COLUMN IF NOT EXISTS pay_treatment varchar(24) NOT NULL DEFAULT 'unconfigured',
          ADD COLUMN IF NOT EXISTS paid_percentage numeric(5,2) NOT NULL DEFAULT 100
      `);
      // A populated workspace reads precise leave evidence even when its
      // requests were created before the interval module was introduced.
      await client.query(`
-- Immutable, revisioned precise leave timing evidence.
CREATE TABLE IF NOT EXISTS leave_request_interval_sets (
  id serial PRIMARY KEY NOT NULL,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  leave_request_id integer NOT NULL REFERENCES leave_requests(id) ON DELETE cascade,
  revision integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'current'
    CHECK (status IN ('current','superseded')),
  created_by_user_id integer REFERENCES users(id) ON DELETE set null,
  created_by_name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_interval_set_revision_unique
  ON leave_request_interval_sets (leave_request_id,revision);
CREATE UNIQUE INDEX IF NOT EXISTS leave_interval_set_current_unique
  ON leave_request_interval_sets (leave_request_id)
  WHERE status = 'current';
CREATE INDEX IF NOT EXISTS leave_interval_sets_org_request_idx
  ON leave_request_interval_sets (organization_id,leave_request_id);

CREATE TABLE IF NOT EXISTS leave_request_intervals (
  id serial PRIMARY KEY NOT NULL,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  interval_set_id integer NOT NULL REFERENCES leave_request_interval_sets(id) ON DELETE cascade,
  work_date date NOT NULL,
  kind varchar(20) NOT NULL
    CHECK (kind IN ('full_day','first_half','second_half','timed')),
  start_local_time varchar(8),
  end_local_time varchar(8),
  ends_next_day boolean NOT NULL DEFAULT false,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Manila',
  source varchar(24) NOT NULL DEFAULT 'request',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_interval_timing_check CHECK (
    (
      kind = 'timed'
      AND start_local_time IS NOT NULL
      AND end_local_time IS NOT NULL
    )
    OR
    (
      kind <> 'timed'
      AND start_local_time IS NULL
      AND end_local_time IS NULL
      AND ends_next_day = false
    )
  )
);

CREATE INDEX IF NOT EXISTS leave_request_intervals_set_date_idx
  ON leave_request_intervals (interval_set_id,work_date);
CREATE INDEX IF NOT EXISTS leave_request_intervals_org_date_idx
  ON leave_request_intervals (organization_id,work_date);
      `);
      await client.query("COMMIT");
      ready = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      inFlight = null;
    }
  })();

  return inFlight;
}
