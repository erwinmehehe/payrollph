-- A-2 DRAFT SQL. Do not apply this candidate in production.
-- This is NOT a numbered migration: PR #745 has reserved 0110 and must
-- be independently reviewed and merged before a DBA assigns the next number.
-- Rehearse against a disposable staging clone with a verified backup.

CREATE TABLE IF NOT EXISTS payout_batches (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payroll_run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  provider varchar(24) NOT NULL DEFAULT 'paymongo' CHECK (provider = 'paymongo'),
  idempotency_key varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL,
  transfer_count integer NOT NULL CHECK (transfer_count > 0),
  total_amount_cents bigint NOT NULL CHECK (total_amount_cents > 0),
  status varchar(32) NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared','submitting','submitted','reconciliation_required','settled','failed','cancelled'
  )),
  provider_batch_id varchar(160),
  claimed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_provider_idempotency_unique
  ON payout_batches (provider, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_remote_batch_unique
  ON payout_batches (provider, provider_batch_id)
  WHERE provider_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payout_batches_org_run_status_idx
  ON payout_batches (organization_id, payroll_run_id, status);

CREATE TABLE IF NOT EXISTS payout_transfers (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payroll_run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  payroll_entry_id integer NOT NULL REFERENCES payroll_entries(id) ON DELETE RESTRICT,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  reference_number varchar(120) NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status varchar(32) NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared','submitting','submitted','succeeded','failed','reconciliation_required','cancelled'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_transfers_run_employee_unique
  ON payout_transfers (organization_id, payroll_run_id, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS payout_transfers_run_reference_unique
  ON payout_transfers (payroll_run_id, reference_number);
CREATE UNIQUE INDEX IF NOT EXISTS payout_transfers_entry_unique
  ON payout_transfers (payroll_entry_id);
CREATE INDEX IF NOT EXISTS payout_transfers_org_status_idx
  ON payout_transfers (organization_id, status);

CREATE TABLE IF NOT EXISTS payout_batch_transfers (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payout_batch_id integer NOT NULL REFERENCES payout_batches(id) ON DELETE RESTRICT,
  payout_transfer_id integer NOT NULL REFERENCES payout_transfers(id) ON DELETE RESTRICT,
  provider_transfer_id varchar(160),
  status varchar(32) NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared','submitting','submitted','succeeded','failed','reconciliation_required','cancelled'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_batch_transfers_batch_transfer_unique
  ON payout_batch_transfers (payout_batch_id, payout_transfer_id);
CREATE UNIQUE INDEX IF NOT EXISTS payout_batch_transfers_provider_transfer_unique
  ON payout_batch_transfers (provider_transfer_id) WHERE provider_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payout_batch_transfers_org_batch_idx
  ON payout_batch_transfers (organization_id, payout_batch_id);

-- A payout's identity and amount must not be rewritten after creation.
-- Adjustments require an independently approved new run, not mutation.
CREATE OR REPLACE FUNCTION protect_payout_transfer_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.payroll_entry_id IS DISTINCT FROM OLD.payroll_entry_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.reference_number IS DISTINCT FROM OLD.reference_number
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
  THEN
    RAISE EXCEPTION 'PAYOUT_IMMUTABLE_TRANSFER_IDENTITY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'payout_transfers'::regclass
                 AND tgname = 'payout_transfer_identity_guard') THEN
    CREATE TRIGGER payout_transfer_identity_guard
      BEFORE UPDATE ON payout_transfers FOR EACH ROW
      EXECUTE FUNCTION protect_payout_transfer_identity();
  END IF;
END $$;

-- A single provider request's idempotency and frozen total are immutable.
CREATE OR REPLACE FUNCTION protect_payout_batch_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.transfer_count IS DISTINCT FROM OLD.transfer_count
     OR NEW.total_amount_cents IS DISTINCT FROM OLD.total_amount_cents
  THEN
    RAISE EXCEPTION 'PAYOUT_IMMUTABLE_BATCH_IDENTITY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'payout_batches'::regclass
                 AND tgname = 'payout_batch_identity_guard') THEN
    CREATE TRIGGER payout_batch_identity_guard
      BEFORE UPDATE ON payout_batches FOR EACH ROW
      EXECUTE FUNCTION protect_payout_batch_identity();
  END IF;
END $$;

-- DBA acceptance: demonstrate unique constraints and trigger rejection,
-- two-worker claim race, tenant isolation and replay before any rollout.
