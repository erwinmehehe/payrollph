-- 0123: Issue #910 additive multi-entity forward schema repair (DRAFT; NOT applied).
-- NUMBERED SOURCE CANDIDATE ONLY. Never use outside the protected reviewed release runner.
-- NO historical row mutations; NO inferred employee-current-employer backfill.
-- Reviewed runner owns an atomic transaction. CI always ROLLBACKs.
-- Expects separately installed 0115-0120 canonical objects; NOT standalone.
-- This numbered SQL is not an applied-production-migration receipt.
DO $issue910_preflight$
DECLARE missing_objects text;
BEGIN
  -- Prerequisites 0115-0120 must exist before additive 0121 columns/FKs.
  SELECT string_agg(object_name, ', ' ORDER BY object_name)
    INTO missing_objects FROM (VALUES
      ('public.organizations'), ('public.users'), ('public.user_organizations'),
      ('public.legal_entities'), ('public.org_units'), ('public.employees'),
      ('public.payroll_runs'), ('public.payroll_entries'), ('public.payslips'),
      ('public.payroll_jobs'), ('public.bank_file_validations'),
      ('public.historical_payroll_entries'), ('public.year_end_adjustments'),
      ('public.separation_records'), ('public.payout_batches'),
      ('public.payout_transfers')
    ) AS required(object_name) WHERE to_regclass(object_name) IS NULL;
  IF missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE910_MISSING_SCHEMA_PREREQUISITES: %', missing_objects
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_organizations
             GROUP BY organization_id, user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'ISSUE910_DUPLICATE_USER_ORGANIZATION_MEMBERSHIP'
      USING ERRCODE = 'P0001';
  END IF;
END $issue910_preflight$;

-- ISSUE910 SOURCE missing-historical-predecessors [docs/sql/issue-910-review-only-forward-predecessor.sql] SHA256 7849b3f50db1ae039e664dbbe3d60a57b940cd5d0aaa87b53a65e0f28adedd3f
-- SOURCE STAGE drizzle/0022_job_architecture_positions.sql
CREATE TABLE IF NOT EXISTS "job_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "title" varchar(160) NOT NULL,
  "family" varchar(120) DEFAULT 'General' NOT NULL,
  "level" varchar(80) DEFAULT 'Individual Contributor' NOT NULL,
  "grade" varchar(40),
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_profiles_org_title_level_unique" ON "job_profiles" ("organization_id","title","level");
CREATE INDEX IF NOT EXISTS "job_profiles_org_active_idx" ON "job_profiles" ("organization_id","active");

CREATE TABLE IF NOT EXISTS "workforce_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_by" varchar(120) DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_plans_org_name_dates_unique" ON "workforce_plans" ("organization_id","name","start_date","end_date");
CREATE INDEX IF NOT EXISTS "workforce_plans_org_status_idx" ON "workforce_plans" ("organization_id","status");

CREATE TABLE IF NOT EXISTS "positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(48) NOT NULL,
  "job_profile_id" integer NOT NULL REFERENCES "job_profiles"("id") ON DELETE restrict,
  "org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "plan_id" integer REFERENCES "workforce_plans"("id") ON DELETE set null,
  "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "employment_type" varchar(32) DEFAULT 'Regular' NOT NULL,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "planned_start_date" date,
  "annual_budget" numeric(14,2) DEFAULT '0' NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "positions_org_code_unique" ON "positions" ("organization_id","code");
CREATE INDEX IF NOT EXISTS "positions_org_status_idx" ON "positions" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "positions_org_unit_idx" ON "positions" ("organization_id","org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_plan_idx" ON "positions" ("plan_id");

CREATE TABLE IF NOT EXISTS "position_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "position_id" integer NOT NULL REFERENCES "positions"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "reason" varchar(240) DEFAULT 'Position assignment' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_position_from_unique" ON "position_assignments" ("position_id","effective_from");
CREATE INDEX IF NOT EXISTS "position_assignments_employee_idx" ON "position_assignments" ("organization_id","employee_id");
-- SOURCE END drizzle/0022_job_architecture_positions.sql

-- SOURCE STAGE drizzle/0050_hcm_core_worker_history.sql
ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict;

CREATE INDEX IF NOT EXISTS "positions_legal_entity_idx"
  ON "positions" ("organization_id", "legal_entity_id");

ALTER TABLE "position_assignments"
  ADD COLUMN IF NOT EXISTS "assignment_type" varchar(24) NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS "fte" numeric(5,4) NOT NULL DEFAULT '1.0000';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "position_assignments"
    WHERE "effective_until" IS NULL
      AND "assignment_type" = 'primary'
    GROUP BY "organization_id", "employee_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HCM Core 2.0 requires at most one active primary position assignment per employee. Resolve duplicate active assignments before applying this migration.';
  END IF;
END
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS "position_assignments_active_primary_employee_unique"
  ON "position_assignments" ("organization_id", "employee_id")
  WHERE "assignment_type" = 'primary' AND "effective_until" IS NULL;

CREATE INDEX IF NOT EXISTS "position_assignments_employee_date_idx"
  ON "position_assignments" ("employee_id", "effective_from");

CREATE TABLE IF NOT EXISTS "worker_employment_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "effective_date" date NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "position_assignment_id" integer REFERENCES "position_assignments"("id") ON DELETE set null,
  "from_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "to_position_id" integer REFERENCES "positions"("id") ON DELETE set null,
  "from_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "to_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  "from_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE set null,
  "to_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE set null,
  "from_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "to_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  "from_employment_type" varchar(32),
  "to_employment_type" varchar(32),
  "from_status" varchar(32),
  "to_status" varchar(32),
  "reason" varchar(240) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "actor_name" varchar(120) NOT NULL DEFAULT 'System',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "worker_employment_events_employee_date_idx"
  ON "worker_employment_events" ("organization_id", "employee_id", "effective_date");

CREATE INDEX IF NOT EXISTS "worker_employment_events_org_type_idx"
  ON "worker_employment_events" ("organization_id", "event_type");
-- SOURCE END drizzle/0050_hcm_core_worker_history.sql

-- SOURCE STAGE drizzle/0051_hcm_org_job_architecture.sql
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "org_units"
    GROUP BY "organization_id", "code"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HCM Core 2.1 requires organization-unit codes to be unique inside each organization. Resolve duplicate codes before applying this migration.';
  END IF;
END
$guard$;

ALTER TABLE "org_units"
  ADD COLUMN IF NOT EXISTS "legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "manager_employee_id" integer REFERENCES "employees"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "effective_from" date,
  ADD COLUMN IF NOT EXISTS "effective_until" date,
  ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "org_units_org_code_unique"
  ON "org_units" ("organization_id", "code");
CREATE INDEX IF NOT EXISTS "org_units_org_parent_idx"
  ON "org_units" ("organization_id", "parent_id");
CREATE INDEX IF NOT EXISTS "org_units_org_type_idx"
  ON "org_units" ("organization_id", "type", "active");
CREATE INDEX IF NOT EXISTS "org_units_legal_entity_idx"
  ON "org_units" ("organization_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "org_units_cost_center_idx"
  ON "org_units" ("organization_id", "cost_center_id");

CREATE TABLE IF NOT EXISTS "job_families" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_families_org_code_unique" ON "job_families" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "job_families_org_name_unique" ON "job_families" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "job_families_org_active_idx" ON "job_families" ("organization_id", "active");

CREATE TABLE IF NOT EXISTS "job_levels" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(80) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 0,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_levels_org_code_unique" ON "job_levels" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "job_levels_org_name_unique" ON "job_levels" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "job_levels_org_sequence_idx" ON "job_levels" ("organization_id", "sequence");

CREATE TABLE IF NOT EXISTS "job_grades" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" varchar(40) NOT NULL,
  "name" varchar(80) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 0,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_grades_org_code_unique" ON "job_grades" ("organization_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "job_grades_org_name_unique" ON "job_grades" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "job_grades_org_sequence_idx" ON "job_grades" ("organization_id", "sequence");

ALTER TABLE "job_profiles"
  ADD COLUMN IF NOT EXISTS "family_id" integer REFERENCES "job_families"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "level_id" integer REFERENCES "job_levels"("id") ON DELETE restrict,
  ADD COLUMN IF NOT EXISTS "grade_id" integer REFERENCES "job_grades"("id") ON DELETE restrict;

CREATE INDEX IF NOT EXISTS "job_profiles_org_family_idx" ON "job_profiles" ("organization_id", "family_id");
CREATE INDEX IF NOT EXISTS "job_profiles_org_level_idx" ON "job_profiles" ("organization_id", "level_id");
CREATE INDEX IF NOT EXISTS "job_profiles_org_grade_idx" ON "job_profiles" ("organization_id", "grade_id");

ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "positions_supervisory_org_idx"
  ON "positions" ("organization_id", "supervisory_org_unit_id");
CREATE INDEX IF NOT EXISTS "positions_cost_center_idx"
  ON "positions" ("organization_id", "cost_center_id");
-- SOURCE END drizzle/0051_hcm_org_job_architecture.sql

-- SOURCE STAGE drizzle/0052_hcm_effective_dated_changes.sql
CREATE TABLE IF NOT EXISTS "worker_effective_changes" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "change_type" varchar(32) DEFAULT 'job_change' NOT NULL,
  "movement_type" varchar(24) DEFAULT 'job_change' NOT NULL,
  "effective_date" date NOT NULL,
  "status" varchar(24) DEFAULT 'pending_approval' NOT NULL,
  "target_position_id" integer REFERENCES "positions"("id") ON DELETE restrict,
  "target_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "target_supervisory_org_unit_id" integer REFERENCES "org_units"("id") ON DELETE restrict,
  "target_legal_entity_id" integer REFERENCES "legal_entities"("id") ON DELETE restrict,
  "target_cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE restrict,
  "target_manager_employee_id" integer REFERENCES "employees"("id") ON DELETE restrict,
  "target_employment_type" varchar(32),
  "target_employee_status" varchar(32),
  "target_fte" numeric(5,4),
  "reason" varchar(240) NOT NULL,
  "from_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "to_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "requested_by" varchar(120) NOT NULL,
  "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "approved_by" varchar(120),
  "approved_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "applied_event_id" integer REFERENCES "worker_employment_events"("id") ON DELETE set null,
  "cancelled_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "cancelled_by" varchar(120),
  "cancelled_at" timestamp with time zone,
  "failure" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "worker_effective_changes_org_status_date_idx"
  ON "worker_effective_changes" ("organization_id","status","effective_date");
CREATE INDEX IF NOT EXISTS "worker_effective_changes_employee_date_idx"
  ON "worker_effective_changes" ("organization_id","employee_id","effective_date");
CREATE UNIQUE INDEX IF NOT EXISTS "worker_effective_changes_active_employee_unique"
  ON "worker_effective_changes" ("organization_id","employee_id")
  WHERE "status" IN ('pending_approval','scheduled');
CREATE UNIQUE INDEX IF NOT EXISTS "worker_effective_changes_active_target_position_unique"
  ON "worker_effective_changes" ("target_position_id")
  WHERE "target_position_id" IS NOT NULL
    AND "status" IN ('pending_approval','scheduled');
-- SOURCE END drizzle/0052_hcm_effective_dated_changes.sql

-- SOURCE STAGE drizzle/0110_provider_events_inbox.sql
-- A-1: durable PayMongo/provider event inbox. Append after 0109 audit-chain SQL.
-- Must be applied in the selected staging/production database under the
-- database release runbook; a GitHub source merge does not run migrations.
CREATE TABLE IF NOT EXISTS "provider_events" (
  "id" serial PRIMARY KEY,
  "provider" varchar(32) NOT NULL,
  "event_id" varchar(180) NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "payroll_run_id" integer REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "event_type" varchar(120) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_events_provider_event_id_unique"
  ON "provider_events" ("provider", "event_id");
CREATE INDEX IF NOT EXISTS "provider_events_organization_run_idx"
  ON "provider_events" ("organization_id", "payroll_run_id");
-- SOURCE END drizzle/0110_provider_events_inbox.sql

-- SOURCE STAGE drizzle/0112_wfm_operational_demand_observations.sql
-- WFM observational demand pilot. DOES NOT infer employees, wages or shifts.
-- App source merge does not apply SQL to any existing employer database.
-- DBA must review/run in staging, compare against src/db/schema.ts, then
-- separately approve exact-org feature activation. Do not replay all historical
-- numbered migrations in this repository as an ordered journal.
CREATE TABLE IF NOT EXISTS workforce_demand_import_batches (
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
CREATE UNIQUE INDEX IF NOT EXISTS wfm_demand_import_idempotency_unique
  ON workforce_demand_import_batches(organization_id,idempotency_key);
CREATE INDEX IF NOT EXISTS wfm_demand_import_scope_idx
  ON workforce_demand_import_batches(organization_id,worksite_id,imported_at);

CREATE TABLE IF NOT EXISTS workforce_demand_observation_revisions (
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
CREATE UNIQUE INDEX IF NOT EXISTS wfm_demand_observation_version_unique
  ON workforce_demand_observation_revisions(
    organization_id,worksite_id,source_key,metric_kind,interval_start,interval_minutes,revision
  );
CREATE INDEX IF NOT EXISTS wfm_demand_observation_history_idx
  ON workforce_demand_observation_revisions(
    organization_id,worksite_id,metric_kind,interval_start
  );

-- These are append-only through the application. A privileged DBA may still
-- make SQL changes, so the UI must never claim cryptographic immutability.
-- Strict tenant and batch consistency is rechecked by the server inside a
-- transaction. Production release must verify indexes/constraints explicitly.
-- SOURCE END drizzle/0112_wfm_operational_demand_observations.sql

-- SOURCE STAGE drizzle/0113_wfm_issued_demand_forecasts.sql
-- WFM staged issued-demand evidence (0113).
-- Depends on the separately reviewed 0112 WFM source-revision schema. The separately draft 0114
-- payout provider is NOT a WFM predecessor or activation requirement. Source merge does not run
-- this DDL in staging or production. There is no ordered Drizzle journal.
-- A DBA must review constraints, verify table ownership and plan rollback.
CREATE TABLE IF NOT EXISTS workforce_demand_forecast_issues (
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
CREATE UNIQUE INDEX IF NOT EXISTS wfm_demand_issued_key_unique
  ON workforce_demand_forecast_issues(organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS wfm_demand_issued_scope_idx
  ON workforce_demand_forecast_issues(organization_id,worksite_id,issued_at);

CREATE TABLE IF NOT EXISTS workforce_demand_forecast_scores (
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
CREATE UNIQUE INDEX IF NOT EXISTS wfm_demand_issued_score_unique
  ON workforce_demand_forecast_scores(issue_id);
CREATE INDEX IF NOT EXISTS wfm_demand_score_tenant_idx
  ON workforce_demand_forecast_scores(organization_id,scored_at);

-- Application routes only INSERT, never UPDATE/DELETE. This is NOT DBA-proof
-- or cryptographically tamper-evident immutability; qualified operator can
-- alter the database. Retained hashes are reproducibility aids.
-- SOURCE END drizzle/0113_wfm_issued_demand_forecasts.sql

-- SOURCE STAGE drizzle/0114_wfm_demand_staffing_policies.sql
-- 0114: governed, versioned WFM demand-to-staffing productivity policies.
-- Applied independently only AFTER DBA-approved 0112 operational demand imports
-- and 0113 issued forecasting. Xendit payout draft must reserve a later number;
-- merging/activating payout is NOT a prerequisite for this WFM release.
-- This file does not run on source merge and there is no ordered Drizzle journal.
CREATE TABLE IF NOT EXISTS workforce_demand_staffing_policies (
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
CREATE UNIQUE INDEX IF NOT EXISTS wfm_staffing_policy_idempotency_unique
  ON workforce_demand_staffing_policies(organization_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS wfm_staffing_policy_scope_version_unique
  ON workforce_demand_staffing_policies(
    organization_id,worksite_id,coalesce(job_profile_id,0),
    metric_kind,interval_minutes,version
  );
CREATE INDEX IF NOT EXISTS wfm_staffing_policy_dates_idx
  ON workforce_demand_staffing_policies(
    organization_id,worksite_id,metric_kind,interval_minutes,
    status,effective_from,effective_until
  );

CREATE TABLE IF NOT EXISTS workforce_demand_staffing_policy_events (
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
CREATE UNIQUE INDEX IF NOT EXISTS wfm_staffing_policy_event_unique
  ON workforce_demand_staffing_policy_events(policy_id,action);
CREATE INDEX IF NOT EXISTS wfm_staffing_policy_event_scope_idx
  ON workforce_demand_staffing_policy_events(organization_id,policy_id,occurred_at);

-- The application serializes transition decisions per employer in one DB
-- transaction and writes independent audit events in that same transaction.
-- This SQL intentionally does not enable new provider, roster, or payroll flows.
-- A DBA must separately verify live schema prefix, applied-object checksums,
-- ownership, referential integrity and rollback/retention before any deployment.
-- SOURCE END drizzle/0114_wfm_demand_staffing_policies.sql

-- ISSUE910 SOURCE 0121-schema-only [docs/sql/issue-910-review-only-0121-schema.sql] SHA256 4cabef62a4f450913a1d6d79e65f5c4caaf08b49382b7c0b3a62ba5f942c6891
ALTER TABLE legal_entities ADD COLUMN IF NOT EXISTS registered_address text;
CREATE UNIQUE INDEX IF NOT EXISTS legal_entities_org_id_unique ON legal_entities(organization_id, id);

ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payroll_jobs ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE payout_transfers ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE bank_file_validations ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE historical_payroll_entries ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE year_end_adjustments ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;

-- Immutable parent run is the authoritative historical employer.

CREATE TABLE IF NOT EXISTS user_legal_entity_grants (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  granted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_entity_grants_unique ON user_legal_entity_grants(organization_id,user_id,legal_entity_id);
CREATE INDEX IF NOT EXISTS user_entity_grants_user_idx ON user_legal_entity_grants(user_id,organization_id);

CREATE TABLE IF NOT EXISTS user_entity_preferences (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_entity_preferences_unique ON user_entity_preferences(organization_id,user_id);

CREATE TABLE IF NOT EXISTS employee_entity_assignments (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_entity_assignment_interval_check CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_entity_assignment_start_unique ON employee_entity_assignments(organization_id,employee_id,effective_from);
CREATE INDEX IF NOT EXISTS employee_entity_assignment_effective_idx ON employee_entity_assignments(organization_id,legal_entity_id,effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS employee_entity_one_open_unique ON employee_entity_assignments(organization_id,employee_id) WHERE effective_until IS NULL;

CREATE TABLE IF NOT EXISTS entity_transfer_requests (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  from_legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  to_legal_entity_id integer NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending_approval',
  reason varchar(400) NOT NULL,
  service_start_date date NOT NULL,
  leave_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  thirteenth_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  continuity_note text NOT NULL,
  requested_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_transfer_distinct_entity_check CHECK (from_legal_entity_id <> to_legal_entity_id),
  CONSTRAINT entity_transfer_maker_checker_check CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id),
  CONSTRAINT entity_transfer_status_check CHECK (status IN ('pending_approval','approved','rejected','applied','cancelled','blocked'))
);
CREATE INDEX IF NOT EXISTS entity_transfer_org_employee_idx ON entity_transfer_requests(organization_id,employee_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS entity_transfer_one_open_unique ON entity_transfer_requests(organization_id,employee_id) WHERE status IN ('pending_approval','approved');

-- Tenant consistency checks for NEW authorization and history data; safe on
-- re-execution, and do not trust unscoped numerical IDs from callers.
DO $checks$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_entity_grants_tenant_entity_fk') THEN
   ALTER TABLE user_legal_entity_grants ADD CONSTRAINT user_entity_grants_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_entity_pref_tenant_entity_fk') THEN
   ALTER TABLE user_entity_preferences ADD CONSTRAINT user_entity_pref_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignment_tenant_entity_fk') THEN
   ALTER TABLE employee_entity_assignments ADD CONSTRAINT assignment_tenant_entity_fk
     FOREIGN KEY (organization_id, legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_from_tenant_entity_fk') THEN
   ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_from_tenant_entity_fk
     FOREIGN KEY (organization_id, from_legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transfer_to_tenant_entity_fk') THEN
   ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_to_tenant_entity_fk
     FOREIGN KEY (organization_id, to_legal_entity_id) REFERENCES legal_entities(organization_id,id);
 END IF;
END $checks$;

-- Existing entity-scoped staff receive ONE conservative initial grant.
-- Group-wide owner/admin/bookkeeper are resolved at runtime, not here.

-- ISSUE910 SOURCE post-0121-tenant-integrity [docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql] SHA256 74ce275d51f8f7db627d13451fa8675a8abde8af2d09c8969ac0a1505bb4b8d
-- ISSUE #910 — REVIEW-ONLY post-0121 tenant/entity integrity proposal.
-- UNNUMBERED. DO NOT APPLY on Neon, staging, a real employer clone, or production.
-- Existing historical migration files remain immutable. 0121 predecessor evidence
-- and review must be complete before any separate DBA-approved forward migration.
-- All FKs are NOT VALID to protect against retroactively inventing attribution:
-- they protect NEW operations, but old rows require a separate audit + VALIDATE.
-- These constraints are proposed for controlled PostgreSQL16/18 synthetic tests.
CREATE UNIQUE INDEX IF NOT EXISTS employee_org_id_for_entity_scope ON employees(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS user_org_id_for_entity_scope ON user_organizations(organization_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_run_employer_identity_unique ON payroll_runs(id,legal_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_entry_employer_identity_unique ON payroll_entries(id,legal_entity_id);
DO $issue910_scope$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.employees'::regclass AND conname='employees_tenant_employer_fk') THEN
  ALTER TABLE employees ADD CONSTRAINT employees_tenant_employer_fk
    FOREIGN KEY (organization_id,legal_entity_id) REFERENCES legal_entities(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payroll_runs'::regclass AND conname='payroll_runs_tenant_employer_fk') THEN
  ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_tenant_employer_fk
    FOREIGN KEY (organization_id,legal_entity_id) REFERENCES legal_entities(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.employee_entity_assignments'::regclass AND conname='assignment_employee_tenant_fk') THEN
  ALTER TABLE employee_entity_assignments ADD CONSTRAINT assignment_employee_tenant_fk
    FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.entity_transfer_requests'::regclass AND conname='transfer_employee_tenant_fk') THEN
  ALTER TABLE entity_transfer_requests ADD CONSTRAINT transfer_employee_tenant_fk
    FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.user_legal_entity_grants'::regclass AND conname='entity_grant_membership_tenant_fk') THEN
  ALTER TABLE user_legal_entity_grants ADD CONSTRAINT entity_grant_membership_tenant_fk
    FOREIGN KEY (organization_id,user_id) REFERENCES user_organizations(organization_id,user_id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.user_entity_preferences'::regclass AND conname='entity_preference_membership_tenant_fk') THEN
  ALTER TABLE user_entity_preferences ADD CONSTRAINT entity_preference_membership_tenant_fk
    FOREIGN KEY (organization_id,user_id) REFERENCES user_organizations(organization_id,user_id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payroll_entries'::regclass AND conname='payroll_entries_run_employer_fk') THEN
  ALTER TABLE payroll_entries ADD CONSTRAINT payroll_entries_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payslips'::regclass AND conname='payslips_entry_employer_fk') THEN
  ALTER TABLE payslips ADD CONSTRAINT payslips_entry_employer_fk
    FOREIGN KEY (payroll_entry_id,legal_entity_id) REFERENCES payroll_entries(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payroll_jobs'::regclass AND conname='payroll_jobs_run_employer_fk') THEN
  ALTER TABLE payroll_jobs ADD CONSTRAINT payroll_jobs_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payout_batches'::regclass AND conname='payout_batches_run_employer_fk') THEN
  ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.payout_transfers'::regclass AND conname='payout_transfers_run_employer_fk') THEN
  ALTER TABLE payout_transfers ADD CONSTRAINT payout_transfers_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.bank_file_validations'::regclass AND conname='bank_file_validations_run_employer_fk') THEN
  ALTER TABLE bank_file_validations ADD CONSTRAINT bank_file_validations_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.year_end_adjustments'::regclass AND conname='year_end_adjustments_run_employer_fk') THEN
  ALTER TABLE year_end_adjustments ADD CONSTRAINT year_end_adjustments_run_employer_fk
    FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)  NOT VALID;
 END IF;
END $issue910_scope$;
