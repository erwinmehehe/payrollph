-- P0 payroll financial control: one overlapping release per legal employer/population.
--
-- A NULL scope_org_unit_id means company-wide, so its generated unbounded
-- int4range overlaps every explicitly scoped org unit. Different explicit
-- org units remain independent and may run the same cutoff.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS release_period_guard daterange
    GENERATED ALWAYS AS (daterange(period_start, period_end, '[]')) STORED,
  ADD COLUMN IF NOT EXISTS release_scope_guard int4range
    GENERATED ALWAYS AS (
      CASE
        WHEN scope_org_unit_id IS NULL THEN int4range(NULL, NULL, '()')
        ELSE int4range(scope_org_unit_id, scope_org_unit_id, '[]')
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS release_legal_entity_guard bigint
    GENERATED ALWAYS AS (COALESCE(legal_entity_id::bigint, 0::bigint)) STORED;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM payroll_runs a
    JOIN payroll_runs b
      ON a.id < b.id
     AND a.organization_id = b.organization_id
     AND COALESCE(a.legal_entity_id, 0) = COALESCE(b.legal_entity_id, 0)
     AND daterange(a.period_start, a.period_end, '[]') && daterange(b.period_start, b.period_end, '[]')
     AND (
       a.scope_org_unit_id IS NULL
       OR b.scope_org_unit_id IS NULL
       OR a.scope_org_unit_id = b.scope_org_unit_id
     )
    WHERE a.status IN ('Releasing', 'Released')
      AND b.status IN ('Releasing', 'Released')
  ) THEN
    RAISE EXCEPTION
      'Existing overlapping Releasing/Released payroll runs must be reconciled before installing payroll release overlap protection.';
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE payroll_runs
    ADD CONSTRAINT payroll_runs_no_overlapping_release
    EXCLUDE USING gist (
      organization_id WITH =,
      release_legal_entity_guard WITH =,
      release_period_guard WITH &&,
      release_scope_guard WITH &&
    )
    WHERE (status IN ('Releasing', 'Released'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
