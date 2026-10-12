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
