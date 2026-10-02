import type { PoolClient } from "pg";
import { pool } from "@/db";
import { bankEncryptionConfigured, decryptBankAccount, encryptBankAccount, isEncryptedBankAccount } from "@/lib/bank-account-crypto";

let coreSchemaReady = false;
let coreSchemaInFlight: Promise<void> | null = null;

async function backfillBankDataEncryption(client: PoolClient) {
  if (!bankEncryptionConfigured()) return { employees: 0, snapshots: 0 };

  const employeeRows = await client.query<{ id: number; bank_account: string }>(`
    SELECT id, bank_account
    FROM employees
    WHERE bank_account IS NOT NULL
      AND bank_account <> ''
      AND bank_account NOT LIKE 'enc:v1:%'
    ORDER BY id
  `);

  let employeesEncrypted = 0;
  for (const row of employeeRows.rows) {
    const plain = row.bank_account.trim();
    if (!plain) continue;
    const sealed = encryptBankAccount(plain);
    if (!sealed || !isEncryptedBankAccount(sealed) || decryptBankAccount(sealed) !== plain) {
      throw new Error(`Bank-account encryption round-trip failed for employee id ${row.id}.`);
    }
    await client.query("UPDATE employees SET bank_account = $1 WHERE id = $2", [sealed, row.id]);
    employeesEncrypted += 1;
  }

  const snapshotRows = await client.query<{ id: number; bank_account: string }>(`
    SELECT id, trace #>> '{payment,bankAccount}' AS bank_account
    FROM payroll_entries
    WHERE trace #>> '{payment,bankAccount}' IS NOT NULL
      AND trace #>> '{payment,bankAccount}' <> ''
      AND trace #>> '{payment,bankAccount}' NOT LIKE 'enc:v1:%'
    ORDER BY id
  `);

  let snapshotsEncrypted = 0;
  for (const row of snapshotRows.rows) {
    const plain = row.bank_account.trim();
    if (!plain) continue;
    const sealed = encryptBankAccount(plain);
    if (!sealed || !isEncryptedBankAccount(sealed) || decryptBankAccount(sealed) !== plain) {
      throw new Error(`Bank-account snapshot encryption round-trip failed for payroll entry ${row.id}.`);
    }
    await client.query(
      `UPDATE payroll_entries
       SET trace = jsonb_set(trace, '{payment,bankAccount}', to_jsonb($1::text), true)
       WHERE id = $2`,
      [sealed, row.id],
    );
    snapshotsEncrypted += 1;
  }

  if (employeesEncrypted > 0 || snapshotsEncrypted > 0) {
    console.info(
      `Bank-data compatibility backfill encrypted ${employeesEncrypted} employee account(s) and ${snapshotsEncrypted} payroll snapshot(s).`,
    );
  }

  return { employees: employeesEncrypted, snapshots: snapshotsEncrypted };
}

export async function bankDataEncryptionReady() {
  if (!bankEncryptionConfigured()) return false;
  const result = await pool.query<{ remaining: number }>(`
    SELECT (
      (SELECT COUNT(*) FROM employees
       WHERE bank_account IS NOT NULL
         AND bank_account <> ''
         AND bank_account NOT LIKE 'enc:v1:%')
      +
      (SELECT COUNT(*) FROM payroll_entries
       WHERE trace #>> '{payment,bankAccount}' IS NOT NULL
         AND trace #>> '{payment,bankAccount}' <> ''
         AND trace #>> '{payment,bankAccount}' NOT LIKE 'enc:v1:%')
    )::int AS remaining
  `);
  return Number(result.rows[0]?.remaining ?? 0) === 0;
}

/**
 * Production on Vercel does not run drizzle db:push automatically.
 * Keep additive schema changes required by the current workspace idempotent so
 * older production databases can upgrade before Drizzle selects the new fields.
 */
export async function ensureCoreCompatibilitySchema() {
  if (coreSchemaReady) return;
  if (coreSchemaInFlight) return coreSchemaInFlight;

  coreSchemaInFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_core_schema_compat_v2'))");

      await client.query(`
        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS bir_tin varchar(16),
          ADD COLUMN IF NOT EXISTS bir_branch_code varchar(4),
          ADD COLUMN IF NOT EXISTS sss_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS philhealth_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS pagibig_employer_no varchar(24)
      `);

      await client.query(`
        ALTER TABLE employees
          ADD COLUMN IF NOT EXISTS middle_name varchar(80),
          ADD COLUMN IF NOT EXISTS tin_branch_code varchar(4),
          ADD COLUMN IF NOT EXISTS nationality varchar(60) NOT NULL DEFAULT 'Filipino'
      `);

      // BANK_DATA_ENCRYPTION_KEY stores AES-GCM envelopes that are longer than
      // the legacy varchar(40) account-number column. Widening is non-destructive
      // and idempotent, and prevents production-only insert failures after rollout.
      await client.query("ALTER TABLE employees ALTER COLUMN bank_account TYPE varchar(160)");

      // Once a stable encryption key is available, seal legacy plaintext in the
      // same advisory-locked transaction as the compatibility schema upgrade.
      // This makes rollout idempotent and prevents a split state where the app
      // is deployed but old database rows remain readable.
      await backfillBankDataEncryption(client);

      // Session/device fields were added after the first production schema.
      // Demo launch creates a real authenticated session, so these must exist
      // before createSession() inserts or getSessionUser() selects them.
      await client.query(`
        ALTER TABLE sessions
          ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
          ADD COLUMN IF NOT EXISTS user_agent text,
          ADD COLUMN IF NOT EXISTS ip varchar(64),
          ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
          ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
          ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()
      `);

      await client.query(`
        ALTER TABLE outbox
          ADD COLUMN IF NOT EXISTS dedupe_key varchar(200),
          ADD COLUMN IF NOT EXISTS provider_message_id varchar(200),
          ADD COLUMN IF NOT EXISTS delivery_status varchar(32),
          ADD COLUMN IF NOT EXISTS delivery_detail text,
          ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz,
          ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 4,
          ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
          ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key_unique
        ON outbox(dedupe_key)
        WHERE dedupe_key IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_org_created_idx
        ON outbox(organization_id, created_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_retry_idx
        ON outbox(status, next_attempt_at)
      `);

      await client.query(`
        ALTER TABLE payroll_runs
          ADD COLUMN IF NOT EXISTS period_start date,
          ADD COLUMN IF NOT EXISTS period_end date,
          ADD COLUMN IF NOT EXISTS scope_org_unit_id integer
      `);

      // Older runs pre-date explicit period boundaries. Use pay date as a safe
      // compatibility fallback so current UI/API reads never receive null.
      await client.query(`
        UPDATE payroll_runs
        SET period_start = COALESCE(period_start, pay_date),
            period_end = COALESCE(period_end, pay_date)
        WHERE period_start IS NULL OR period_end IS NULL
      `);

      await client.query("ALTER TABLE payroll_runs ALTER COLUMN period_start SET NOT NULL");
      await client.query("ALTER TABLE payroll_runs ALTER COLUMN period_end SET NOT NULL");

      await client.query(`
        ALTER TABLE import_batches
          ADD COLUMN IF NOT EXISTS source_system varchar(64) NOT NULL DEFAULT 'generic',
          ADD COLUMN IF NOT EXISTS import_kind varchar(40) NOT NULL DEFAULT 'employees'
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS historical_payroll_entries (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          import_batch_id integer REFERENCES import_batches(id) ON DELETE SET NULL,
          source_system varchar(64) NOT NULL DEFAULT 'generic',
          source_reference varchar(180) NOT NULL,
          period_label varchar(120) NOT NULL,
          pay_date date NOT NULL,
          gross_pay numeric(14,2) NOT NULL,
          net_pay numeric(14,2) NOT NULL,
          tax_withheld numeric(14,2) NOT NULL DEFAULT 0,
          sss_employee numeric(14,2) NOT NULL DEFAULT 0,
          philhealth_employee numeric(14,2) NOT NULL DEFAULT 0,
          pagibig_employee numeric(14,2) NOT NULL DEFAULT 0,
          thirteenth_month numeric(14,2) NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS historical_payroll_source_unique
        ON historical_payroll_entries(
          organization_id,
          employee_id,
          source_system,
          source_reference
        )
      `);

      // Evidence that agencies accepted files Linaw generated. Readiness reads
      // this table, so it must exist on databases that never ran db:push.
      await client.query(`
        CREATE TABLE IF NOT EXISTS government_filing_validations (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
          agency varchar(16) NOT NULL,
          form varchar(24) NOT NULL,
          period_label varchar(80) NOT NULL,
          file_name varchar(160) NOT NULL,
          file_sha256 varchar(64) NOT NULL,
          generator_version varchar(48) NOT NULL,
          status varchar(16) NOT NULL DEFAULT 'generated',
          submission_method varchar(16),
          agency_reference varchar(80),
          submitted_at timestamptz,
          outcome_note text,
          generated_by varchar(120) NOT NULL,
          recorded_by varchar(120),
          recorded_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS government_filing_file_unique
        ON government_filing_validations(organization_id, agency, form, file_sha256)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS government_filing_status_idx
        ON government_filing_validations(agency, form, status)
      `);

      await client.query("COMMIT");
      coreSchemaReady = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      coreSchemaInFlight = null;
    }
  })();

  return coreSchemaInFlight;
}
