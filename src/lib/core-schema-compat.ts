import type { PoolClient } from "pg";
import { pool } from "@/db";
import { bankEncryptionConfigured, decryptBankAccount, encryptBankAccount, isEncryptedBankAccount } from "@/lib/bank-account-crypto";
import {
  decryptGovernmentId,
  encryptGovernmentId,
  governmentIdEncryptionConfigured,
  isEncryptedGovernmentId,
} from "@/lib/government-id-crypto";

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


async function backfillGovernmentIdEncryption(client: PoolClient) {
  if (!governmentIdEncryptionConfigured()) return { employees: 0, contractors: 0 };

  const employeeRows = await client.query<{
    id: number;
    tin: string | null;
    tin_branch_code: string | null;
    sss_no: string | null;
    philhealth_no: string | null;
    pagibig_no: string | null;
  }>(`
    SELECT id, tin, tin_branch_code, sss_no, philhealth_no, pagibig_no
    FROM employees
    WHERE (tin IS NOT NULL AND tin <> '' AND tin NOT LIKE 'enc:govid:v1:%')
       OR (tin_branch_code IS NOT NULL AND tin_branch_code <> '' AND tin_branch_code NOT LIKE 'enc:govid:v1:%')
       OR (sss_no IS NOT NULL AND sss_no <> '' AND sss_no NOT LIKE 'enc:govid:v1:%')
       OR (philhealth_no IS NOT NULL AND philhealth_no <> '' AND philhealth_no NOT LIKE 'enc:govid:v1:%')
       OR (pagibig_no IS NOT NULL AND pagibig_no <> '' AND pagibig_no NOT LIKE 'enc:govid:v1:%')
    ORDER BY id
  `);

  let employeesEncrypted = 0;
  for (const row of employeeRows.rows) {
    const next = {
      tin: encryptGovernmentId(row.tin, { required: true }),
      tinBranchCode: encryptGovernmentId(row.tin_branch_code, { required: true }),
      sssNo: encryptGovernmentId(row.sss_no, { required: true }),
      philHealthNo: encryptGovernmentId(row.philhealth_no, { required: true }),
      pagIbigNo: encryptGovernmentId(row.pagibig_no, { required: true }),
    };
    for (const [label, sealed, original] of [
      ["TIN", next.tin, row.tin],
      ["TIN branch", next.tinBranchCode, row.tin_branch_code],
      ["SSS", next.sssNo, row.sss_no],
      ["PhilHealth", next.philHealthNo, row.philhealth_no],
      ["Pag-IBIG", next.pagIbigNo, row.pagibig_no],
    ] as const) {
      if (!original) continue;
      if (!sealed || !isEncryptedGovernmentId(sealed) || decryptGovernmentId(sealed) !== original.trim()) {
        throw new Error(`Government-ID encryption round-trip failed for employee ${row.id} ${label}.`);
      }
    }
    await client.query(
      `UPDATE employees
       SET tin = $1,
           tin_branch_code = $2,
           sss_no = $3,
           philhealth_no = $4,
           pagibig_no = $5
       WHERE id = $6`,
      [next.tin, next.tinBranchCode, next.sssNo, next.philHealthNo, next.pagIbigNo, row.id],
    );
    employeesEncrypted += 1;
  }

  const contractorRows = await client.query<{ id: number; tin: string }>(`
    SELECT id, tin
    FROM contractors
    WHERE tin IS NOT NULL
      AND tin <> ''
      AND tin NOT LIKE 'enc:govid:v1:%'
    ORDER BY id
  `);

  let contractorsEncrypted = 0;
  for (const row of contractorRows.rows) {
    const sealed = encryptGovernmentId(row.tin, { required: true });
    if (!sealed || !isEncryptedGovernmentId(sealed) || decryptGovernmentId(sealed) !== row.tin.trim()) {
      throw new Error(`Government-ID encryption round-trip failed for contractor ${row.id}.`);
    }
    await client.query("UPDATE contractors SET tin = $1 WHERE id = $2", [sealed, row.id]);
    contractorsEncrypted += 1;
  }

  if (employeesEncrypted > 0 || contractorsEncrypted > 0) {
    console.info(
      `Government-ID compatibility backfill encrypted ${employeesEncrypted} employee record(s) and ${contractorsEncrypted} contractor TIN(s).`,
    );
  }

  return { employees: employeesEncrypted, contractors: contractorsEncrypted };
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
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_core_schema_compat_v13'))");

      await client.query(`
        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS bir_tin varchar(16),
          ADD COLUMN IF NOT EXISTS bir_branch_code varchar(4),
          ADD COLUMN IF NOT EXISTS sss_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS philhealth_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS pagibig_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS statutory_deduction_timing varchar(24) NOT NULL DEFAULT 'split',
          ADD COLUMN IF NOT EXISTS payroll_calendar_mode varchar(24) NOT NULL DEFAULT 'flexible'
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'organizations_statutory_deduction_timing_check'
          ) THEN
            ALTER TABLE organizations
              ADD CONSTRAINT organizations_statutory_deduction_timing_check
              CHECK (statutory_deduction_timing IN ('split', 'first_cutoff', 'second_cutoff'));
          END IF;
        END
        $compat$;
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'organizations_payroll_calendar_mode_check'
          ) THEN
            ALTER TABLE organizations
              ADD CONSTRAINT organizations_payroll_calendar_mode_check
              CHECK (payroll_calendar_mode IN ('flexible', 'ph_semi_monthly'));
          END IF;
        END
        $compat$;
      `);

      await client.query(`
        ALTER TABLE employees
          ADD COLUMN IF NOT EXISTS middle_name varchar(80),
          ADD COLUMN IF NOT EXISTS tin_branch_code varchar(180),
          ADD COLUMN IF NOT EXISTS nationality varchar(60) NOT NULL DEFAULT 'Filipino',
          ADD COLUMN IF NOT EXISTS rest_day varchar(10),
          ADD COLUMN IF NOT EXISTS pagibig_voluntary_monthly numeric(10,2) NOT NULL DEFAULT 0
      `);
      await client.query("ALTER TABLE employees ALTER COLUMN tin TYPE varchar(180)");
      await client.query("ALTER TABLE employees ALTER COLUMN tin_branch_code TYPE varchar(180)");
      await client.query("ALTER TABLE employees ALTER COLUMN sss_no TYPE varchar(180)");
      await client.query("ALTER TABLE employees ALTER COLUMN philhealth_no TYPE varchar(180)");
      await client.query("ALTER TABLE employees ALTER COLUMN pagibig_no TYPE varchar(180)");

      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_rest_day_revisions (
          id serial PRIMARY KEY,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          effective_date date NOT NULL,
          previous_rest_day varchar(10),
          new_rest_day varchar(10),
          reason varchar(240) NOT NULL DEFAULT 'Work schedule change',
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_rest_day_revisions_org_employee_idx
        ON employee_rest_day_revisions(organization_id, employee_id)
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS employee_rest_day_revisions_employee_effective_idx
        ON employee_rest_day_revisions(employee_id, effective_date)
      `);

      await client.query(`
        ALTER TABLE data_requests
          ADD COLUMN IF NOT EXISTS fulfillment_action varchar(64),
          ADD COLUMN IF NOT EXISTS fulfillment_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS legal_retention_applied boolean NOT NULL DEFAULT false
      `);

      await client.query(`
        ALTER TABLE contractors
          ADD COLUMN IF NOT EXISTS tin varchar(180),
          ADD COLUMN IF NOT EXISTS withholding_atc varchar(24),
          ADD COLUMN IF NOT EXISTS withholding_rate numeric(6,3)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS contractor_payments (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          contractor_id integer NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
          payment_date date NOT NULL,
          gross_amount_php numeric(14,2) NOT NULL,
          withholding_atc varchar(24) NOT NULL,
          withholding_rate numeric(6,3) NOT NULL,
          withholding_amount numeric(14,2) NOT NULL,
          net_amount_php numeric(14,2) NOT NULL,
          reference varchar(160),
          created_by varchar(120) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS contractor_payment_org_date_idx
        ON contractor_payments(organization_id, payment_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS contractor_payment_contractor_idx
        ON contractor_payments(contractor_id)
      `);

      await client.query(`
        ALTER TABLE time_punches
          ADD COLUMN IF NOT EXISTS break_start timestamptz,
          ADD COLUMN IF NOT EXISTS break_end timestamptz
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS overtime_requests (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          work_date date NOT NULL,
          requested_minutes integer NOT NULL,
          reason varchar(240) NOT NULL,
          request_kind varchar(32) NOT NULL DEFAULT 'pre_approved',
          status varchar(24) NOT NULL DEFAULT 'pending',
          approval_task_id integer,
          requested_by varchar(120) NOT NULL,
          requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_by varchar(120),
          decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_at timestamptz,
          decision_note varchar(240),
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE overtime_requests
          ADD COLUMN IF NOT EXISTS requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS overtime_requests_org_date_idx
        ON overtime_requests(organization_id, work_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS overtime_requests_employee_date_idx
        ON overtime_requests(employee_id, work_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS overtime_requests_status_idx
        ON overtime_requests(organization_id, status)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS cost_centers (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          code varchar(40) NOT NULL,
          name varchar(140) NOT NULL,
          description text,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_org_code_unique
        ON cost_centers(organization_id, code)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS cost_centers_org_active_idx
        ON cost_centers(organization_id, active)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_labor_allocations (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          cost_center_id integer NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
          effective_from date NOT NULL,
          effective_until date,
          allocation_percent numeric(6,3) NOT NULL,
          allocation_basis varchar(24) NOT NULL DEFAULT 'percentage',
          project_code varchar(64),
          client_code varchar(64),
          job_code varchar(64),
          reason varchar(240) NOT NULL DEFAULT 'Labor costing allocation',
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_labor_allocations_employee_date_idx
        ON employee_labor_allocations(employee_id, effective_from)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_labor_allocations_org_cost_center_idx
        ON employee_labor_allocations(organization_id, cost_center_id)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'employee_labor_allocations_percent_check'
          ) THEN
            ALTER TABLE employee_labor_allocations
              ADD CONSTRAINT employee_labor_allocations_percent_check
              CHECK (allocation_percent > 0 AND allocation_percent <= 100);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'employee_labor_allocations_basis_check'
          ) THEN
            ALTER TABLE employee_labor_allocations
              ADD CONSTRAINT employee_labor_allocations_basis_check
              CHECK (allocation_basis = 'percentage');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'employee_labor_allocations_dates_check'
          ) THEN
            ALTER TABLE employee_labor_allocations
              ADD CONSTRAINT employee_labor_allocations_dates_check
              CHECK (effective_until IS NULL OR effective_until >= effective_from);
          END IF;
        END
        $compat$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS compliance_rules (
          id serial PRIMARY KEY,
          rule_key varchar(80) NOT NULL,
          agency varchar(40) NOT NULL,
          jurisdiction varchar(80) NOT NULL DEFAULT 'PH',
          region varchar(40) NOT NULL DEFAULT 'ALL',
          rule_version varchar(64) NOT NULL,
          effective_from date NOT NULL,
          effective_until date,
          source_document varchar(240) NOT NULL,
          source_url text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          status varchar(24) NOT NULL DEFAULT 'draft',
          future_effective boolean NOT NULL DEFAULT false,
          reviewed_by varchar(120),
          approved_by varchar(120),
          approved_at timestamptz,
          supersedes_rule_version varchar(64),
          rollback_version varchar(64),
          notes text,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS compliance_rules_version_unique
        ON compliance_rules(rule_key, jurisdiction, region, rule_version)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS compliance_rules_effective_idx
        ON compliance_rules(rule_key, jurisdiction, region, effective_from)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS compliance_rules_status_idx
        ON compliance_rules(status, effective_from)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS worksites (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          org_unit_id integer REFERENCES org_units(id) ON DELETE SET NULL,
          code varchar(32) NOT NULL,
          name varchar(160) NOT NULL,
          site_type varchar(32) NOT NULL DEFAULT 'office',
          timezone varchar(64) NOT NULL DEFAULT 'Asia/Manila',
          region varchar(64),
          province varchar(100),
          city_municipality varchar(120),
          address_line_1 varchar(200),
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS worksites_org_code_unique
        ON worksites(organization_id, code)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS worksites_org_active_idx
        ON worksites(organization_id, active)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS worksites_org_unit_idx
        ON worksites(organization_id, org_unit_id)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_worksite_assignments (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          worksite_id integer NOT NULL REFERENCES worksites(id) ON DELETE RESTRICT,
          effective_from date NOT NULL,
          effective_until date,
          reason varchar(240) NOT NULL DEFAULT 'Worksite assignment',
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_worksite_assignments_employee_date_idx
        ON employee_worksite_assignments(employee_id, effective_from)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_worksite_assignments_org_worksite_idx
        ON employee_worksite_assignments(organization_id, worksite_id)
      `);

      await client.query(`
        ALTER TABLE employee_schedule_assignments
          ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE SET NULL
      `);
      await client.query(`
        ALTER TABLE schedule_overrides
          ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE SET NULL
      `);

      await client.query(`
        ALTER TABLE holidays
          ADD COLUMN IF NOT EXISTS org_unit_id integer REFERENCES org_units(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE CASCADE
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS holidays_org_unit_date_idx
        ON holidays(organization_id, org_unit_id, holiday_date)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS supplementary_earnings (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          earning_type varchar(32) NOT NULL,
          label varchar(120) NOT NULL,
          amount numeric(12,2) NOT NULL,
          taxable boolean NOT NULL DEFAULT true,
          include_in_sss_base boolean NOT NULL DEFAULT true,
          include_in_pagibig_base boolean NOT NULL DEFAULT true,
          effective_date date NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'approved',
          payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS supplementary_earnings_org_employee_idx
        ON supplementary_earnings(organization_id, employee_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS supplementary_earnings_status_effective_idx
        ON supplementary_earnings(status, effective_date)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'supplementary_earnings_status_check'
          ) THEN
            ALTER TABLE supplementary_earnings
              ADD CONSTRAINT supplementary_earnings_status_check
              CHECK (status IN ('pending', 'approved', 'settled', 'void'));
          END IF;
        END
        $compat$;
      `);

      // Government identifiers now use AES-GCM envelopes. Widen first, then
      // opportunistically backfill only when production key material exists.
      await backfillGovernmentIdEncryption(client);

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

      await client.query(`
        ALTER TABLE historical_payroll_entries
          ADD COLUMN IF NOT EXISTS de_minimis_breakdown jsonb
      `);

      // Advanced workforce scheduling. Keep this additive and idempotent so
      // existing production databases can adopt rotating/split/cross-midnight
      // schedules without rewriting historical employee rest-day records.
      await client.query(`
        CREATE TABLE IF NOT EXISTS shift_definitions (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          code varchar(32) NOT NULL,
          name varchar(120) NOT NULL,
          start_time varchar(8) NOT NULL,
          end_time varchar(8) NOT NULL,
          break_minutes integer NOT NULL DEFAULT 60,
          spans_midnight boolean NOT NULL DEFAULT false,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS shift_definitions_org_code_unique
        ON shift_definitions(organization_id, code)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS shift_definitions_org_active_idx
        ON shift_definitions(organization_id, active)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS schedule_patterns (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          code varchar(32) NOT NULL,
          name varchar(120) NOT NULL,
          cycle_days integer NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS schedule_patterns_org_code_unique
        ON schedule_patterns(organization_id, code)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS schedule_patterns_org_active_idx
        ON schedule_patterns(organization_id, active)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS schedule_pattern_days (
          id serial PRIMARY KEY,
          pattern_id integer NOT NULL REFERENCES schedule_patterns(id) ON DELETE CASCADE,
          day_index integer NOT NULL,
          is_rest_day boolean NOT NULL DEFAULT false,
          label varchar(80)
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS schedule_pattern_days_pattern_day_unique
        ON schedule_pattern_days(pattern_id, day_index)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS schedule_pattern_segments (
          id serial PRIMARY KEY,
          pattern_day_id integer NOT NULL REFERENCES schedule_pattern_days(id) ON DELETE CASCADE,
          shift_definition_id integer NOT NULL REFERENCES shift_definitions(id) ON DELETE RESTRICT,
          segment_order integer NOT NULL DEFAULT 1
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS schedule_pattern_segments_day_order_unique
        ON schedule_pattern_segments(pattern_day_id, segment_order)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS employee_schedule_assignments (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          pattern_id integer NOT NULL REFERENCES schedule_patterns(id) ON DELETE RESTRICT,
          effective_from date NOT NULL,
          effective_until date,
          anchor_date date NOT NULL,
          work_location_org_unit_id integer REFERENCES org_units(id) ON DELETE SET NULL,
          reason varchar(240) NOT NULL DEFAULT 'Schedule assignment',
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_schedule_assignments_employee_date_idx
        ON employee_schedule_assignments(employee_id, effective_from)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS employee_schedule_assignments_org_idx
        ON employee_schedule_assignments(organization_id)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS schedule_overrides (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          work_date date NOT NULL,
          kind varchar(24) NOT NULL DEFAULT 'shift',
          is_rest_day boolean NOT NULL DEFAULT false,
          segments jsonb NOT NULL DEFAULT '[]'::jsonb,
          work_location_org_unit_id integer REFERENCES org_units(id) ON DELETE SET NULL,
          reason varchar(240) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'approved',
          created_by varchar(120) NOT NULL DEFAULT 'System',
          approved_by varchar(120),
          approved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS schedule_overrides_employee_date_unique
        ON schedule_overrides(employee_id, work_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS schedule_overrides_org_date_idx
        ON schedule_overrides(organization_id, work_date)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS schedule_swap_requests (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          requester_employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          counterparty_employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          requester_work_date date NOT NULL,
          counterparty_work_date date NOT NULL,
          requester_schedule_snapshot jsonb NOT NULL,
          counterparty_schedule_snapshot jsonb NOT NULL,
          reason varchar(240) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'pending',
          requested_by varchar(120) NOT NULL,
          requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_by varchar(120),
          decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_at timestamptz,
          decision_note varchar(240),
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS schedule_swap_requests_org_status_idx
        ON schedule_swap_requests(organization_id, status)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS schedule_swap_requests_requester_date_idx
        ON schedule_swap_requests(requester_employee_id, requester_work_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS schedule_swap_requests_counterparty_date_idx
        ON schedule_swap_requests(counterparty_employee_id, counterparty_work_date)
      `);

      // Evidence that a corporate bank portal accepted an exact Linaw-generated
      // payroll file. Only the hash/reference is retained, never file contents.
      await client.query(`
        CREATE TABLE IF NOT EXISTS bank_file_validations (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
          template_name varchar(100) NOT NULL,
          template_version varchar(32) NOT NULL,
          file_name varchar(180) NOT NULL,
          file_sha256 varchar(64) NOT NULL,
          status varchar(16) NOT NULL DEFAULT 'generated',
          portal_reference varchar(120),
          submitted_at timestamptz,
          outcome_note text,
          generated_by varchar(120) NOT NULL,
          recorded_by varchar(120),
          recorded_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS bank_file_validation_unique
        ON bank_file_validations(organization_id, template_name, template_version, file_sha256)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS bank_file_validation_status_idx
        ON bank_file_validations(status, template_name)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'bank_file_validations_status_check'
          ) THEN
            ALTER TABLE bank_file_validations
              ADD CONSTRAINT bank_file_validations_status_check
              CHECK (status IN ('generated', 'accepted', 'rejected'));
          END IF;
        END
        $compat$;
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

      await client.query(`
        CREATE TABLE IF NOT EXISTS labor_inspection_remediations (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          finding_key varchar(220) NOT NULL,
          rule_code varchar(80) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'open',
          owner varchar(120),
          acknowledged_by varchar(120),
          acknowledged_at timestamptz,
          resolution_note text,
          evidence_reference varchar(240),
          resolved_by varchar(120),
          resolved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS labor_inspection_remediation_unique
        ON labor_inspection_remediations(organization_id, finding_key)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS labor_inspection_remediation_status_idx
        ON labor_inspection_remediations(organization_id, status)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'labor_inspection_remediations_status_check'
          ) THEN
            ALTER TABLE labor_inspection_remediations
              ADD CONSTRAINT labor_inspection_remediations_status_check
              CHECK (status IN ('open', 'acknowledged', 'resolved'));
          END IF;
        END
        $compat$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS statutory_contribution_issue_events (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          case_id integer NOT NULL REFERENCES statutory_contribution_issue_cases(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          event_type varchar(32) NOT NULL,
          visibility varchar(24) NOT NULL DEFAULT 'employee',
          message varchar(1000) NOT NULL,
          actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          actor_name varchar(120) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_contribution_issue_event_case_idx
        ON statutory_contribution_issue_events(organization_id, case_id, created_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_contribution_issue_event_employee_idx
        ON statutory_contribution_issue_events(organization_id, employee_id, created_at)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'statutory_contribution_issue_event_type_check'
          ) THEN
            ALTER TABLE statutory_contribution_issue_events
              ADD CONSTRAINT statutory_contribution_issue_event_type_check
              CHECK (event_type IN ('reported', 'review_started', 'payroll_update', 'resolved'));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'statutory_contribution_issue_event_visibility_check'
          ) THEN
            ALTER TABLE statutory_contribution_issue_events
              ADD CONSTRAINT statutory_contribution_issue_event_visibility_check
              CHECK (visibility IN ('employee', 'internal'));
          END IF;
        END
        $compat$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS labor_inspection_drills (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          status varchar(24) NOT NULL,
          range_label varchar(120) NOT NULL,
          evidence_pack_sha256 varchar(64) NOT NULL,
          evidence_pack_version varchar(64) NOT NULL,
          snapshot_sha256 varchar(64) NOT NULL,
          high_findings integer NOT NULL DEFAULT 0,
          medium_findings integer NOT NULL DEFAULT 0,
          info_findings integer NOT NULL DEFAULT 0,
          recorded_exposure numeric(14,2) NOT NULL DEFAULT '0',
          screening_exposure numeric(14,2) NOT NULL DEFAULT '0',
          unowned_actionable integer NOT NULL DEFAULT 0,
          ready_to_close integer NOT NULL DEFAULT 0,
          blocker_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
          action_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
          section_row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
          generated_by varchar(120) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS labor_inspection_drills_org_created_idx
        ON labor_inspection_drills(organization_id, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS labor_inspection_drills_status_idx
        ON labor_inspection_drills(organization_id, status)
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'labor_inspection_drills_status_check'
          ) THEN
            ALTER TABLE labor_inspection_drills
              ADD CONSTRAINT labor_inspection_drills_status_check
              CHECK (status IN ('blocked', 'needs-work', 'evidence-ready'));
          END IF;
        END
        $compat$;
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_correction_requests (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          punch_id integer NOT NULL REFERENCES time_punches(id) ON DELETE CASCADE,
          work_date date NOT NULL,
          original_punch_snapshot jsonb NOT NULL,
          proposed_punch_snapshot jsonb NOT NULL,
          reason varchar(240) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'pending',
          requested_by varchar(120) NOT NULL,
          requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_by varchar(120),
          decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_at timestamptz,
          decision_note varchar(240),
          applied_at timestamptz,
          invalidated_payroll_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS attendance_corrections_org_status_idx
        ON attendance_correction_requests(organization_id, status)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS attendance_corrections_employee_date_idx
        ON attendance_correction_requests(employee_id, work_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS attendance_corrections_punch_idx
        ON attendance_correction_requests(punch_id)
      `);

      await client.query(`
        ALTER TABLE statutory_remittance_batches
          ADD COLUMN IF NOT EXISTS payment_recorded_by_user_id integer REFERENCES users(id) ON DELETE SET NULL
      `);
      await client.query(`
        ALTER TABLE statutory_remittance_batches
          ADD COLUMN IF NOT EXISTS reconciled_by_user_id integer REFERENCES users(id) ON DELETE SET NULL
      `);
      await client.query(`
        ALTER TABLE statutory_remittance_members
          ADD COLUMN IF NOT EXISTS confirmed_by_user_id integer REFERENCES users(id) ON DELETE SET NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_batches_payment_recorder_idx
        ON statutory_remittance_batches(organization_id, payment_recorded_by_user_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_batches_reconciler_idx
        ON statutory_remittance_batches(organization_id, reconciled_by_user_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_members_confirmer_idx
        ON statutory_remittance_members(organization_id, confirmed_by_user_id)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS managed_payroll_engagements (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          status varchar(24) NOT NULL DEFAULT 'pilot',
          service_tier varchar(48) NOT NULL DEFAULT 'Managed payroll',
          client_approver_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          sla_hours integer NOT NULL DEFAULT 24,
          target_go_live date,
          created_by varchar(120) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS managed_payroll_engagement_org_unique
        ON managed_payroll_engagements(organization_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS managed_payroll_gates (
          id serial PRIMARY KEY,
          engagement_id integer NOT NULL REFERENCES managed_payroll_engagements(id) ON DELETE CASCADE,
          gate_key varchar(64) NOT NULL,
          label varchar(180) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'pending',
          evidence_ref text,
          completed_by varchar(120),
          completed_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS managed_payroll_gate_unique
        ON managed_payroll_gates(engagement_id, gate_key)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS managed_payroll_run_approvals (
          id serial PRIMARY KEY,
          engagement_id integer NOT NULL REFERENCES managed_payroll_engagements(id) ON DELETE CASCADE,
          payroll_run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
          approver_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          approved_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          approved_by varchar(120) NOT NULL,
          payroll_fingerprint varchar(64) NOT NULL,
          approved_gross numeric(14,2) NOT NULL,
          approved_net numeric(14,2) NOT NULL,
          approved_employee_count integer NOT NULL,
          note text,
          approved_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS managed_payroll_run_approval_unique
        ON managed_payroll_run_approvals(payroll_run_id)
      `);

      // Governed compensation bands, review cycles and approved proposals.
      await client.query(`
        CREATE TABLE IF NOT EXISTS compensation_bands (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          job_profile_id integer NOT NULL REFERENCES job_profiles(id) ON DELETE RESTRICT,
          location_code varchar(80) NOT NULL DEFAULT 'PH',
          currency varchar(8) NOT NULL DEFAULT 'PHP',
          minimum_annual numeric(14,2) NOT NULL,
          midpoint_annual numeric(14,2) NOT NULL,
          maximum_annual numeric(14,2) NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS compensation_bands_org_profile_location_unique
        ON compensation_bands(organization_id, job_profile_id, location_code)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS compensation_bands_org_active_idx
        ON compensation_bands(organization_id, active)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS compensation_cycles (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name varchar(160) NOT NULL,
          start_date date NOT NULL,
          end_date date NOT NULL,
          effective_date date NOT NULL,
          budget_pool numeric(14,2) NOT NULL DEFAULT 0,
          status varchar(24) NOT NULL DEFAULT 'draft',
          created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          created_by varchar(120) NOT NULL DEFAULT 'System',
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS compensation_cycles_org_name_dates_unique
        ON compensation_cycles(organization_id, name, start_date, end_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS compensation_cycles_org_status_idx
        ON compensation_cycles(organization_id, status)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS compensation_proposals (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          cycle_id integer NOT NULL REFERENCES compensation_cycles(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          band_id integer NOT NULL REFERENCES compensation_bands(id) ON DELETE RESTRICT,
          current_annual numeric(14,2) NOT NULL,
          proposed_annual numeric(14,2) NOT NULL,
          reason varchar(500) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'proposed',
          submitted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          approved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          approved_at timestamptz,
          applied_pay_revision_id integer REFERENCES employee_pay_revisions(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS compensation_proposals_cycle_employee_unique
        ON compensation_proposals(cycle_id, employee_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS compensation_proposals_org_status_idx
        ON compensation_proposals(organization_id, status)
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
