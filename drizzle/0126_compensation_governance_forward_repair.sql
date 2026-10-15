-- Issue #1061: additive, final-state compensation schema candidate.
-- Source-only until independent DBA cutover/receipts, protected backup + restore,
-- forward migration ordering (#1057 -> #1058 -> this 0126), and approval.
-- Not a replay of historical drizzle/0042 or drizzle/0054.
-- The protected reviewed migration runner owns BEGIN/COMMIT and the immutable
-- SHA-256/full-path journal receipt. Never db:push a production employer DB.
-- No backfills, payroll row reads/updates, grants, payment or salary releases.

DO $comp1061_preflight$
DECLARE
  drifted_parent_names text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
      'compensation_bands','compensation_cycles','compensation_proposals',
      'compensation_components','employee_compensation_components','compensation_events'
    ])
  ) THEN
    RAISE EXCEPTION 'COMP1061_PARTIAL_OR_EXISTING_COMPENSATION_SCHEMA'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.string_agg(required.name, ', ' ORDER BY required.name)
  INTO drifted_parent_names
  FROM (VALUES
    ('organizations'), ('users'), ('employees'), ('job_profiles'),
    ('job_grades'), ('legal_entities'), ('worker_effective_changes'),
    ('employee_pay_revisions')
  ) AS required(name)
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class parent
    ON parent.relnamespace = n.oid
    AND parent.relname = required.name AND parent.relkind IN ('r','p')
  LEFT JOIN pg_catalog.pg_attribute id
    ON id.attrelid = parent.oid AND id.attname = 'id'
    AND id.attnum > 0 AND NOT id.attisdropped
  WHERE parent.oid IS NULL
    OR id.atttypid IS NULL
    OR pg_catalog.format_type(id.atttypid, id.atttypmod) <> 'integer'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint pk
      WHERE pk.conrelid = parent.oid AND pk.contype = 'p'
        AND pg_catalog.array_length(pk.conkey, 1) = 1
        AND pk.conkey[1] = id.attnum
    );

  IF drifted_parent_names IS NOT NULL THEN
    RAISE EXCEPTION 'COMP1061_MISSING_OR_DRIFTED_PARENT_INTEGER_PK: %',
      drifted_parent_names USING ERRCODE = 'P0001';
  END IF;

  -- An interrupted historical attempt can leave sequences or indexes even
  -- where target tables were dropped. Refuse the ambiguous state up front.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
      'compensation_bands_id_seq','compensation_bands_pkey',
      'compensation_bands_org_scope_effective_unique',
      'compensation_bands_org_grade_idx','compensation_bands_org_legal_entity_idx',
      'compensation_bands_org_effective_idx','compensation_bands_org_active_idx',
      'compensation_cycles_id_seq','compensation_cycles_pkey',
      'compensation_cycles_org_name_dates_unique','compensation_cycles_org_status_idx',
      'compensation_proposals_id_seq','compensation_proposals_pkey',
      'compensation_proposals_cycle_employee_unique',
      'compensation_proposals_org_status_idx',
      'compensation_components_id_seq','compensation_components_pkey',
      'compensation_components_org_code_unique','compensation_components_org_name_unique',
      'compensation_components_org_active_idx',
      'employee_compensation_components_id_seq','employee_compensation_components_pkey',
      'employee_comp_components_active_idx','employee_comp_components_employee_date_idx',
      'employee_comp_components_status_date_idx',
      'compensation_events_id_seq','compensation_events_pkey',
      'compensation_events_employee_date_idx','compensation_events_org_type_idx'
    ])
  ) THEN
    RAISE EXCEPTION 'COMP1061_ORPHANED_INDEX_OR_SEQUENCE' USING ERRCODE = 'P0001';
  END IF;
END
$comp1061_preflight$;

CREATE TABLE public.compensation_bands (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_profile_id integer REFERENCES public.job_profiles(id) ON DELETE RESTRICT,
  grade_id integer REFERENCES public.job_grades(id) ON DELETE RESTRICT,
  legal_entity_id integer REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  location_code varchar(80) NOT NULL DEFAULT 'PH',
  currency varchar(8) NOT NULL DEFAULT 'PHP',
  minimum_annual numeric(14,2) NOT NULL,
  midpoint_annual numeric(14,2) NOT NULL,
  maximum_annual numeric(14,2) NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compensation_bands_org_scope_effective_unique ON public.compensation_bands
  (organization_id, job_profile_id, grade_id, legal_entity_id, location_code, effective_from);
CREATE INDEX compensation_bands_org_grade_idx ON public.compensation_bands (organization_id, grade_id);
CREATE INDEX compensation_bands_org_legal_entity_idx ON public.compensation_bands (organization_id, legal_entity_id);
CREATE INDEX compensation_bands_org_effective_idx ON public.compensation_bands
  (organization_id, effective_from, effective_until);
CREATE INDEX compensation_bands_org_active_idx ON public.compensation_bands (organization_id, active);

CREATE TABLE public.compensation_cycles (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  effective_date date NOT NULL,
  budget_pool numeric(14,2) NOT NULL DEFAULT '0',
  status varchar(24) NOT NULL DEFAULT 'draft',
  created_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_by varchar(120) NOT NULL DEFAULT 'System',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compensation_cycles_org_name_dates_unique ON public.compensation_cycles
  (organization_id, name, start_date, end_date);
CREATE INDEX compensation_cycles_org_status_idx ON public.compensation_cycles (organization_id, status);

CREATE TABLE public.compensation_proposals (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cycle_id integer NOT NULL REFERENCES public.compensation_cycles(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  band_id integer NOT NULL REFERENCES public.compensation_bands(id) ON DELETE RESTRICT,
  current_annual numeric(14,2) NOT NULL,
  proposed_annual numeric(14,2) NOT NULL,
  reason varchar(500) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'proposed',
  submitted_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  scheduled_at timestamptz,
  applied_at timestamptz,
  failure text,
  worker_effective_change_id integer REFERENCES public.worker_effective_changes(id) ON DELETE SET NULL,
  applied_pay_revision_id integer REFERENCES public.employee_pay_revisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compensation_proposals_cycle_employee_unique ON public.compensation_proposals
  (cycle_id, employee_id);
CREATE INDEX compensation_proposals_org_status_idx ON public.compensation_proposals (organization_id, status);

CREATE TABLE public.compensation_components (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  name varchar(120) NOT NULL,
  kind varchar(32) NOT NULL DEFAULT 'allowance',
  amount_frequency varchar(24) NOT NULL DEFAULT 'monthly',
  taxable boolean NOT NULL DEFAULT true,
  include_in_sss_base boolean NOT NULL DEFAULT true,
  include_in_pagibig_base boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compensation_components_org_code_unique ON public.compensation_components
  (organization_id, code);
CREATE UNIQUE INDEX compensation_components_org_name_unique ON public.compensation_components
  (organization_id, name);
CREATE INDEX compensation_components_org_active_idx ON public.compensation_components (organization_id, active);

CREATE TABLE public.employee_compensation_components (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  component_id integer NOT NULL REFERENCES public.compensation_components(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  status varchar(24) NOT NULL DEFAULT 'pending_approval',
  reason varchar(240) NOT NULL,
  requested_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  requested_by varchar(120) NOT NULL,
  approved_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by varchar(120),
  approved_at timestamptz,
  activated_at timestamptz,
  cancelled_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_by varchar(120),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_comp_components_active_idx ON public.employee_compensation_components
  (organization_id, employee_id, component_id, status);
CREATE INDEX employee_comp_components_employee_date_idx ON public.employee_compensation_components
  (organization_id, employee_id, effective_from);
CREATE INDEX employee_comp_components_status_date_idx ON public.employee_compensation_components
  (organization_id, status, effective_from);

CREATE TABLE public.compensation_events (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL,
  effective_date date NOT NULL,
  previous_annual numeric(14,2),
  new_annual numeric(14,2),
  band_id integer REFERENCES public.compensation_bands(id) ON DELETE SET NULL,
  proposal_id integer REFERENCES public.compensation_proposals(id) ON DELETE SET NULL,
  component_assignment_id integer REFERENCES public.employee_compensation_components(id) ON DELETE SET NULL,
  pay_revision_id integer REFERENCES public.employee_pay_revisions(id) ON DELETE SET NULL,
  compa_ratio_before numeric(8,4),
  compa_ratio_after numeric(8,4),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name varchar(120) NOT NULL DEFAULT 'System',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compensation_events_employee_date_idx ON public.compensation_events
  (organization_id, employee_id, effective_date);
CREATE INDEX compensation_events_org_type_idx ON public.compensation_events
  (organization_id, event_type);

-- In-transaction fail-closed structural postflight. The separate audit
-- must check exact columns, key orders, defaults and FK targets before release.
DO $comp1061_postflight$
DECLARE
  incomplete_count integer;
BEGIN
  WITH expected(table_name, cols, fks, indexes) AS (
    VALUES
      ('compensation_bands',16,5,6),
      ('compensation_cycles',12,2,3),
      ('compensation_proposals',19,8,3),
      ('compensation_components',13,2,4),
      ('employee_compensation_components',20,6,4),
      ('compensation_events',17,7,3)
  )
  SELECT pg_catalog.count(*) INTO incomplete_count
  FROM expected e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class t ON t.relnamespace = n.oid
    AND t.relname = e.table_name AND t.relkind IN ('r','p')
  WHERE t.oid IS NULL
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped) <> e.cols
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = t.oid AND c.contype = 'f' AND c.convalidated) <> e.fks
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index ix
        WHERE ix.indrelid = t.oid AND ix.indisvalid AND ix.indisready) <> e.indexes
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = t.oid AND c.contype = 'p' AND c.convalidated) <> 1;

  IF incomplete_count <> 0 THEN
    RAISE EXCEPTION 'COMP1061_POSTFLIGHT_INCOMPLETE_FINAL_COMPENSATION_SCHEMA'
      USING ERRCODE = 'P0001';
  END IF;
END
$comp1061_postflight$;

-- This source file does NOT record an applied migration receipt. Only the
-- independently approved protected runner can atomically journal its SHA.
