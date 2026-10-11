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
