-- P0-4 DBA-ONLY CUTOVER TEMPLATE. DO NOT RUN FROM APP, CI OR A WEB REQUEST.
-- Must be separately approved and executed against a verified DB with restore.
-- Existing historical receipts are NOT created, amended or inferred here.
-- These tables are controlled infrastructure, deliberately outside drizzle/.
CREATE TABLE public.payrollph_migration_cutover (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  historical_prefix integer NOT NULL CHECK (historical_prefix BETWEEN 1 AND 9999),
  historical_manifest_sha256 char(64) NOT NULL
    CHECK (historical_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_ref text NOT NULL CHECK (length(evidence_ref) BETWEEN 8 AND 240),
  reviewed_by text NOT NULL CHECK (length(reviewed_by) BETWEEN 8 AND 240),
  reviewed_at timestamptz NOT NULL
);

CREATE TABLE public.payrollph_schema_migrations (
  migration_path text PRIMARY KEY
    CHECK (migration_path ~ '^drizzle/[0-9]{4}_[a-z0-9][a-z0-9_-]*[.]sql$'),
  migration_number integer NOT NULL UNIQUE CHECK (migration_number BETWEEN 1 AND 9999),
  source_sha256 char(64) NOT NULL
    CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  applied_by text NOT NULL CHECK (length(applied_by) BETWEEN 8 AND 240),
  change_ref text NOT NULL CHECK (length(change_ref) BETWEEN 8 AND 240),
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_number_matches_path CHECK (
    migration_number = split_part(split_part(migration_path, '/', 2), '_', 1)::integer
  )
);

-- DBA inserts ONE independently validated cutover record, not a guessed row.
-- Example only; DO NOT paste placeholders as live SQL:
-- INSERT INTO public.payrollph_migration_cutover
-- (id, historical_prefix, historical_manifest_sha256, evidence_ref, reviewed_by, reviewed_at)
-- VALUES (1, <reviewed historical last prefix>, <reviewed digest>,
--         <DBA change ID>, <independent reviewer>, now());
--
-- The least-privilege plan role needs SELECT on this cutover, the execution
-- journal, and public.payrollph_release_migration_receipts only.
-- The least-privilege execution role needs SELECT on those three tables,
-- INSERT on public.payrollph_schema_migrations, and only the DDL privileges
-- required for the reviewed new migration. DO NOT grant UPDATE/DELETE on the
-- journals. Restrict table ownership to the independent DBA/release role.
-- A clean receipt and a populated cutover row never authorize payroll release.
