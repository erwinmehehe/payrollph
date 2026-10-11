import { coreSchemaCompatibilityMode } from "@/lib/core-schema-readonly";
import { workforceAttendanceSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureWorkforceAttendanceControlSchema() {
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    if (inFlight) throw new Error("WORKFORCE_ATTENDANCE_LEGACY_SCHEMA_WRITE_IN_PROGRESS");
    await verifyRequestSchemaReadOnlyFromPool(pool, workforceAttendanceSchemaSpec);
    return;
  }
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    let transactionOpen = false;
    let safeToReuse = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('linaw_workforce_attendance_control_v1'))",
      );

      await client.query(`
        CREATE TABLE IF NOT EXISTS workforce_attendance_lock_policies (
          organization_id integer PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          require_payroll_cutoff_lock boolean NOT NULL DEFAULT false,
          updated_by varchar(120) NOT NULL DEFAULT 'System',
          updated_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS workforce_attendance_period_locks (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          period_start date NOT NULL,
          period_end date NOT NULL,
          lock_type varchar(24) NOT NULL DEFAULT 'attendance',
          status varchar(16) NOT NULL DEFAULT 'locked',
          reason varchar(240) NOT NULL,
          locked_by varchar(120) NOT NULL,
          locked_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          locked_at timestamptz NOT NULL DEFAULT NOW(),
          unlocked_by varchar(120),
          unlocked_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          unlock_reason varchar(240),
          unlocked_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS workforce_attendance_period_locks_period_unique
        ON workforce_attendance_period_locks (
          organization_id, period_start, period_end, lock_type
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS workforce_attendance_period_locks_active_idx
        ON workforce_attendance_period_locks (
          organization_id, status, period_start, period_end
        )
      `);

      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'workforce_attendance_period_locks_date_check'
          ) THEN
            ALTER TABLE workforce_attendance_period_locks
              ADD CONSTRAINT workforce_attendance_period_locks_date_check
              CHECK (period_end >= period_start);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'workforce_attendance_period_locks_type_check'
          ) THEN
            ALTER TABLE workforce_attendance_period_locks
              ADD CONSTRAINT workforce_attendance_period_locks_type_check
              CHECK (lock_type IN ('attendance','payroll_cutoff'));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'workforce_attendance_period_locks_status_check'
          ) THEN
            ALTER TABLE workforce_attendance_period_locks
              ADD CONSTRAINT workforce_attendance_period_locks_status_check
              CHECK (status IN ('locked','unlocked'));
          END IF;
        END
        $compat$;
      `);

      await client.query("COMMIT");
      transactionOpen = false;
      safeToReuse = true;
      ready = true;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
          transactionOpen = false;
          safeToReuse = true;
        } catch {
          // Never reuse a client with an uncertain open transaction.
        }
      }
      throw error;
    } finally {
      client.release(!safeToReuse);
      inFlight = null;
    }
  })();

  return inFlight;
}
