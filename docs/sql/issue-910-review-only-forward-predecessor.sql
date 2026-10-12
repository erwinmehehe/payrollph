-- #910 REVIEW-ONLY FORWARD PREDECESSOR SOURCE CANDIDATE — NOT AN AUTHORIZED MIGRATION.
-- NOT IN drizzle/; DO NOT RUN against Neon (even staging/clone) without DBA review.
-- Built from already merged historical source paths, preserving statement order.
-- This file contains additive DDL and indexes ONLY; intentionally omits 0050's
-- mutable position-to-current-employee legal-entity UPDATE (unsafe attribution).
-- All existing historical objects and data must be independently preflighted.
-- No historical applied receipts/approvals/backup/restore evidence are implied.
-- Reconcile duplicates, future migration number, exact SQL SHA and 0121 order.
-- The human operator must stop on missing receipts, duplicate live business keys,
-- mismatched types, or errors; no retry that fabricates employer-history rows.
-- SOURCE BEGIN
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
-- SOURCE COMPLETE
