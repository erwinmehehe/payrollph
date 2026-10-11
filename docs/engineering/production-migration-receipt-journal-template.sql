-- DBA-REVIEWED TEMPLATE ONLY. DO NOT RUN FROM CI, WEB REQUESTS OR APP STARTUP.
-- This is a RECORD of individually verified migration history, not an executor.
-- Never insert receipts automatically based on presence of files in GitHub.
-- Every record requires DBA evidence from the actual target and approved owner.
CREATE TABLE IF NOT EXISTS public.payrollph_release_migration_receipts (
  migration_path text PRIMARY KEY
    CHECK (migration_path ~ '^drizzle/[0-9]{4}_[a-z0-9][a-z0-9_-]*[.]sql$'),
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  disposition text NOT NULL
    CHECK (disposition IN ('applied', 'baseline-included', 'not-applied')),
  evidence_ref text NOT NULL CHECK (length(evidence_ref) BETWEEN 8 AND 240),
  reviewed_by text NOT NULL CHECK (length(reviewed_by) BETWEEN 8 AND 240),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- A separate DBA change request must provision a SELECT-only audit role.
-- Do not grant this role SELECT on payroll, employees, bank accounts or audit logs.
-- Audit scripts never create this table or INSERT/UPDATE/DELETE receipts.
