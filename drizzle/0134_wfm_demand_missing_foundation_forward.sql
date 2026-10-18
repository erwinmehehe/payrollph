-- #1198 / #1031: forward-only candidate to restore six WFM demand tables
-- observed MISSING on the 2026-10-17 Neon-default catalog snapshot.
-- Source-ported DDL from drizzle/0112, 0113, 0114; those historical
-- sources are NOT replayed, and this file is NOT a historical receipt.
-- DRAFT. The protected reviewed-migration runner owns a single atomic
-- transaction and validates database identity, source SHA, independent
-- DBA approvals and historical controls. NEVER invoke manually on Neon.
-- No data backfill, payroll recalculation, permissions/role changes, or
-- feature-flag activation. Application endpoints are NOT repaired by merge.
--
-- Refuse partial or already-recovered catalogs: never IF NOT EXISTS away a
-- shape mismatch or overwrite tables that now contain business records.
DO $issue1198_preflight$
DECLARE missing_parents text;
        already_present text;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF current_schema() <> 'public' THEN
    RAISE EXCEPTION 'ISSUE1198_WRONG_SCHEMA';
  END IF;
  SELECT string_agg(n, ', ' ORDER BY n) INTO missing_parents
    FROM (VALUES ('public.organizations'), ('public.users'),
                 ('public.worksites'), ('public.job_profiles')) p(n)
    WHERE to_regclass(n) IS NULL;
  IF missing_parents IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1198_MISSING_REQUIRED_PARENTS: %', missing_parents;
  END IF;
  SELECT string_agg(n, ', ' ORDER BY n) INTO already_present
    FROM (VALUES
       ('public.workforce_demand_import_batches'),
       ('public.workforce_demand_observation_revisions'),
       ('public.workforce_demand_forecast_issues'),
       ('public.workforce_demand_forecast_scores'),
       ('public.workforce_demand_staffing_policies'),
       ('public.workforce_demand_staffing_policy_events')
    ) p(n) WHERE to_regclass(n) IS NOT NULL;
  IF already_present IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1198_ALREADY_PRESENT_OR_PARTIAL_STATE: %', already_present;
  END IF;
  -- Composite FKs below need exact parent identity and employer ownership.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.worksites'::regclass, 'id', 'integer'),
      ('public.worksites'::regclass, 'organization_id', 'integer'),
      ('public.job_profiles'::regclass, 'id', 'integer'),
      ('public.job_profiles'::regclass, 'organization_id', 'integer'),
      ('public.users'::regclass, 'id', 'integer'),
      ('public.organizations'::regclass, 'id', 'integer')
    ) expected(rel, column_name, kind)
    LEFT JOIN pg_catalog.pg_attribute a ON
        a.attrelid=expected.rel AND a.attname=expected.column_name
        AND a.attnum>0 AND NOT a.attisdropped
    WHERE a.attnum IS NULL OR
          pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.kind
  ) THEN
    RAISE EXCEPTION 'ISSUE1198_PARENT_COLUMN_SHAPE_MISMATCH';
  END IF;
END $issue1198_preflight$;

-- Ensure the real worksite/job-profile parent pairs are FK-eligible. PK
-- identity alone is not a sufficient UNIQUE reference for a composite FK.
-- These indexes may lock existing parents; the 3s timeout fails closed.
CREATE UNIQUE INDEX wfm_demand_worksites_org_id_fk_unique
  ON public.worksites(organization_id, id);
CREATE UNIQUE INDEX wfm_demand_job_profiles_org_id_fk_unique
  ON public.job_profiles(organization_id, id);

-- Forward source section 1: drizzle/0112_wfm_operational_demand_observations.sql
CREATE TABLE workforce_demand_import_batches (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  worksite_id integer NOT NULL REFERENCES worksites(id) ON DELETE CASCADE,
  source_key varchar(64) NOT NULL,
  metric_kind varchar(24) NOT NULL,
  interval_minutes integer NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  request_sha256 varchar(64) NOT NULL,
  row_count integer NOT NULL,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfm_demand_import_interval_check CHECK (interval_minutes IN (15,30,60)),
  CONSTRAINT wfm_demand_import_count_check CHECK (row_count BETWEEN 1 AND 100),
  CONSTRAINT wfm_demand_import_metric_check CHECK
    (metric_kind IN ('transactions','visits','orders','appointments','calls'))
);
CREATE UNIQUE INDEX wfm_demand_import_idempotency_unique
  ON workforce_demand_import_batches(organization_id,idempotency_key);
CREATE INDEX wfm_demand_import_scope_idx
  ON workforce_demand_import_batches(organization_id,worksite_id,imported_at);

CREATE TABLE workforce_demand_observation_revisions (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  worksite_id integer NOT NULL REFERENCES worksites(id) ON DELETE CASCADE,
  import_batch_id integer NOT NULL REFERENCES workforce_demand_import_batches(id) ON DELETE RESTRICT,
  source_key varchar(64) NOT NULL,
  metric_kind varchar(24) NOT NULL,
  interval_start timestamptz NOT NULL,
  interval_minutes integer NOT NULL,
  revision integer NOT NULL,
  observed_count integer NOT NULL,
  quality varchar(20) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfm_demand_observation_interval_check CHECK (interval_minutes IN (15,30,60)),
  CONSTRAINT wfm_demand_observation_revision_check CHECK (revision BETWEEN 1 AND 1000),
  CONSTRAINT wfm_demand_observation_count_check CHECK (observed_count BETWEEN 0 AND 1000000),
  CONSTRAINT wfm_demand_observation_quality_check CHECK
    (quality IN ('complete','partial','unverified')),
  CONSTRAINT wfm_demand_observation_metric_check CHECK
    (metric_kind IN ('transactions','visits','orders','appointments','calls'))
);
CREATE UNIQUE INDEX wfm_demand_observation_version_unique
  ON workforce_demand_observation_revisions(
    organization_id,worksite_id,source_key,metric_kind,interval_start,interval_minutes,revision
  );
CREATE INDEX wfm_demand_observation_history_idx
  ON workforce_demand_observation_revisions(
    organization_id,worksite_id,metric_kind,interval_start
  );

-- These are append-only through the application. A privileged DBA may still
-- make SQL changes, so the UI must never claim cryptographic immutability.
-- Strict tenant and batch consistency is rechecked by the server inside a
-- transaction. Production release must verify indexes/constraints explicitly.

-- Forward source section 2: drizzle/0113_wfm_issued_demand_forecasts.sql
CREATE TABLE workforce_demand_forecast_issues (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  worksite_id integer NOT NULL REFERENCES worksites(id) ON DELETE CASCADE,
  source_key varchar(64) NOT NULL,
  metric_kind varchar(24) NOT NULL,
  interval_minutes integer NOT NULL,
  horizon_days integer NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  request_sha256 varchar(64) NOT NULL,
  issued_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL,
  source_cutoff_at timestamptz NOT NULL,
  training_evidence_sha256 varchar(64) NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  points_count integer NOT NULL,
  snapshot jsonb NOT NULL,
  CONSTRAINT wfm_demand_issued_interval_check CHECK (interval_minutes IN (15,30,60)),
  CONSTRAINT wfm_demand_issued_horizon_check CHECK (horizon_days IN (7,14)),
  CONSTRAINT wfm_demand_issued_points_check CHECK (points_count BETWEEN 1 AND 400),
  CONSTRAINT wfm_demand_issued_hash_check CHECK (
    request_sha256 ~ '^[a-f0-9]{64}$'
    AND snapshot_sha256 ~ '^[a-f0-9]{64}$'
    AND training_evidence_sha256 ~ '^[a-f0-9]{64}$'
  )
);
CREATE UNIQUE INDEX wfm_demand_issued_key_unique
  ON workforce_demand_forecast_issues(organization_id, idempotency_key);
CREATE INDEX wfm_demand_issued_scope_idx
  ON workforce_demand_forecast_issues(organization_id,worksite_id,issued_at);

CREATE TABLE workforce_demand_forecast_scores (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  issue_id integer NOT NULL REFERENCES workforce_demand_forecast_issues(id) ON DELETE RESTRICT,
  scored_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  scored_at timestamptz NOT NULL,
  evaluation_cutoff_at timestamptz NOT NULL,
  points_count integer NOT NULL,
  report_sha256 varchar(64) NOT NULL,
  report jsonb NOT NULL,
  CONSTRAINT wfm_demand_score_points_check CHECK (points_count BETWEEN 1 AND 400),
  CONSTRAINT wfm_demand_score_hash_check CHECK (report_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX wfm_demand_issued_score_unique
  ON workforce_demand_forecast_scores(issue_id);
CREATE INDEX wfm_demand_score_tenant_idx
  ON workforce_demand_forecast_scores(organization_id,scored_at);

-- Application routes only INSERT, never UPDATE/DELETE. This is NOT DBA-proof
-- or cryptographically tamper-evident immutability; qualified operator can
-- alter the database. Retained hashes are reproducibility aids.

-- Forward source section 3: drizzle/0114_wfm_demand_staffing_policies.sql
CREATE TABLE workforce_demand_staffing_policies (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  worksite_id integer NOT NULL REFERENCES worksites(id) ON DELETE RESTRICT,
  job_profile_id integer REFERENCES job_profiles(id) ON DELETE RESTRICT,
  metric_kind varchar(24) NOT NULL,
  interval_minutes integer NOT NULL,
  effective_from date NOT NULL,
  effective_until date NOT NULL,
  version integer NOT NULL,
  productive_units_per_worker_hour numeric(12,4) NOT NULL,
  service_target_coverage_percent numeric(5,2) NOT NULL,
  rationale varchar(400) NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  content_sha256 varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  proposed_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfm_staffing_policy_metric_check CHECK (metric_kind IN
    ('transactions','visits','orders','appointments','calls')),
  CONSTRAINT wfm_staffing_policy_interval_check CHECK (interval_minutes IN (15,30,60)),
  CONSTRAINT wfm_staffing_policy_dates_check CHECK (effective_from <= effective_until),
  CONSTRAINT wfm_staffing_policy_values_check CHECK (
    productive_units_per_worker_hour BETWEEN 0.01 AND 1000000
    AND service_target_coverage_percent BETWEEN 0.01 AND 100
  ),
  CONSTRAINT wfm_staffing_policy_version_check CHECK (version BETWEEN 1 AND 10000),
  CONSTRAINT wfm_staffing_policy_status_check CHECK (
    status IN ('draft','submitted','approved','rejected','superseded')),
  CONSTRAINT wfm_staffing_policy_sha_check CHECK (content_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX wfm_staffing_policy_idempotency_unique
  ON workforce_demand_staffing_policies(organization_id,idempotency_key);
CREATE UNIQUE INDEX wfm_staffing_policy_scope_version_unique
  ON workforce_demand_staffing_policies(
    organization_id,worksite_id,coalesce(job_profile_id,0),
    metric_kind,interval_minutes,version
  );
CREATE INDEX wfm_staffing_policy_dates_idx
  ON workforce_demand_staffing_policies(
    organization_id,worksite_id,metric_kind,interval_minutes,
    status,effective_from,effective_until
  );

CREATE TABLE workforce_demand_staffing_policy_events (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id integer NOT NULL REFERENCES workforce_demand_staffing_policies(id) ON DELETE RESTRICT,
  actor_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(20) NOT NULL,
  occurred_at timestamptz NOT NULL,
  policy_sha256 varchar(64) NOT NULL,
  receipt_sha256 varchar(64) NOT NULL,
  prior_policy_id integer REFERENCES workforce_demand_staffing_policies(id) ON DELETE RESTRICT,
  decision_note varchar(400) NOT NULL DEFAULT '',
  CONSTRAINT wfm_staffing_policy_event_action_check CHECK (
    action IN ('created','submitted','approved','rejected','superseded')),
  CONSTRAINT wfm_staffing_policy_event_hash_check CHECK (
    policy_sha256 ~ '^[a-f0-9]{64}$' AND receipt_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX wfm_staffing_policy_event_unique
  ON workforce_demand_staffing_policy_events(policy_id,action);
CREATE INDEX wfm_staffing_policy_event_scope_idx
  ON workforce_demand_staffing_policy_events(organization_id,policy_id,occurred_at);

-- The application serializes transition decisions per employer in one DB
-- transaction and writes independent audit events in that same transaction.
-- This SQL intentionally does not enable new provider, roster, or payroll flows.
-- A DBA must separately verify live schema prefix, applied-object checksums,
-- ownership, referential integrity and rollback/retention before any deployment.

-- Additional tenant-integrity FKs, intentionally stricter than the
-- historical single-column ID references above. No server-side permission
-- is broadened; reject cross-organization reference IDs at the DB layer.
CREATE UNIQUE INDEX wfm_demand_import_org_worksite_id_fk_unique
  ON public.workforce_demand_import_batches(organization_id,worksite_id,id);
CREATE UNIQUE INDEX wfm_demand_issued_org_id_fk_unique
  ON public.workforce_demand_forecast_issues(organization_id,id);
CREATE UNIQUE INDEX wfm_demand_policy_org_id_fk_unique
  ON public.workforce_demand_staffing_policies(organization_id,id);

ALTER TABLE public.workforce_demand_import_batches
  ADD CONSTRAINT wfm_demand_import_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE CASCADE;
ALTER TABLE public.workforce_demand_observation_revisions
  ADD CONSTRAINT wfm_demand_revision_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT wfm_demand_revision_batch_tenant_fk
  FOREIGN KEY(organization_id,worksite_id,import_batch_id)
  REFERENCES public.workforce_demand_import_batches(organization_id,worksite_id,id)
  ON DELETE RESTRICT;
ALTER TABLE public.workforce_demand_forecast_issues
  ADD CONSTRAINT wfm_demand_issued_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE CASCADE;
ALTER TABLE public.workforce_demand_forecast_scores
  ADD CONSTRAINT wfm_demand_score_issue_tenant_fk
  FOREIGN KEY(organization_id,issue_id)
  REFERENCES public.workforce_demand_forecast_issues(organization_id,id)
  ON DELETE RESTRICT;
ALTER TABLE public.workforce_demand_staffing_policies
  ADD CONSTRAINT wfm_demand_policy_worksite_tenant_fk
  FOREIGN KEY(organization_id,worksite_id)
  REFERENCES public.worksites(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT wfm_demand_policy_job_tenant_fk
  FOREIGN KEY(organization_id,job_profile_id)
  REFERENCES public.job_profiles(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE public.workforce_demand_staffing_policy_events
  ADD CONSTRAINT wfm_demand_event_policy_tenant_fk
  FOREIGN KEY(organization_id,policy_id)
  REFERENCES public.workforce_demand_staffing_policies(organization_id,id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT wfm_demand_event_prior_policy_tenant_fk
  FOREIGN KEY(organization_id,prior_policy_id)
  REFERENCES public.workforce_demand_staffing_policies(organization_id,id)
  ON DELETE RESTRICT;

-- No synthetic observation/forecast/policy rows, fake evidence, migration
-- receipts or approval records are inserted. DB owner/runner must verify the
-- serving connection, protected role, backup and postflight before release.
