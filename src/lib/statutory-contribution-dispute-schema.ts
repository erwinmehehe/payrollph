import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureStatutoryContributionDisputeSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('payrollph_statutory_contribution_disputes_v1'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS statutory_contribution_disputes (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          member_id integer REFERENCES statutory_remittance_members(id) ON DELETE SET NULL,
          agency varchar(16) NOT NULL,
          applicable_month varchar(7) NOT NULL,
          issue_type varchar(32) NOT NULL,
          description varchar(500) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'open',
          reported_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          reported_by_name varchar(120) NOT NULL,
          resolution_code varchar(32),
          resolution_note varchar(500),
          resolved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          resolved_by_name varchar(120),
          resolved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_contribution_disputes_org_status_idx
        ON statutory_contribution_disputes(organization_id, status, created_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_contribution_disputes_employee_month_idx
        ON statutory_contribution_disputes(employee_id, applicable_month, agency)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'statutory_contribution_disputes_status_check'
          ) THEN
            ALTER TABLE statutory_contribution_disputes
              ADD CONSTRAINT statutory_contribution_disputes_status_check
              CHECK (status IN ('open', 'resolved'));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'statutory_contribution_disputes_agency_check'
          ) THEN
            ALTER TABLE statutory_contribution_disputes
              ADD CONSTRAINT statutory_contribution_disputes_agency_check
              CHECK (agency IN ('SSS', 'PhilHealth', 'Pag-IBIG'));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'statutory_contribution_disputes_issue_check'
          ) THEN
            ALTER TABLE statutory_contribution_disputes
              ADD CONSTRAINT statutory_contribution_disputes_issue_check
              CHECK (issue_type IN ('missing_posting', 'wrong_amount', 'wrong_reference', 'other'));
          END IF;
        END
        $compat$;
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
