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
