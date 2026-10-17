-- #1031 / 2026-10-17: REVIEW-ONLY, UNNUMBERED ADDITIVE SOURCE CANDIDATE.
-- NOT a migration, execution receipt, or permission to run against Neon/production.
-- Do not copy into drizzle/ or execute against any real database. DBA review,
-- historic receipt reconciliation, reviewed SHA and protected PLAN/APPLY are
-- mandatory before a separately approved release repair.
-- Exact src/db/schema.ts table shape; independent disposable PG16/18 first-push
-- catalog comparison is required before accepting this candidate.
-- Single atomic DO block: parent/target preflight, DDL, structural postflight.
-- No DML, no drops, no history backfills; pre-existing target fails closed.
DO $review_candidate$
DECLARE
  missing_parent text;
BEGIN
  SELECT pg_catalog.string_agg(parent_name, ', ' ORDER BY parent_name)
  INTO missing_parent
  FROM (VALUES ('public.organizations'), ('public.employees')) AS parents(parent_name)
  WHERE pg_catalog.to_regclass(parent_name) IS NULL;
  IF missing_parent IS NOT NULL THEN
    RAISE EXCEPTION 'SPEND_CARDS_PARENT_MISSING: %', missing_parent USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.to_regclass('public.spend_cards') IS NOT NULL THEN
    RAISE EXCEPTION 'SPEND_CARDS_ALREADY_PRESENT_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  CREATE TABLE public."spend_cards" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "employee_id" integer,
    "issuer" varchar(100) NOT NULL,
    "last_four" varchar(4) NOT NULL,
    "reference" varchar(120),
    "status" varchar(20) NOT NULL DEFAULT 'registered',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "spend_cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES public."organizations"("id") ON DELETE cascade,
    CONSTRAINT "spend_cards_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE set null,
    CONSTRAINT "spend_card_last_four_check" CHECK ("last_four" ~ '^[0-9]{4}$'),
    CONSTRAINT "spend_card_state_check" CHECK ("status" in ('registered','closed'))
  );
  CREATE INDEX "spend_cards_org_idx" ON public."spend_cards" ("organization_id", "employee_id");
  CREATE UNIQUE INDEX "spend_cards_ref_unique" ON public."spend_cards" ("organization_id", "reference");

  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.spend_cards'::regclass
        AND attnum > 0 AND NOT attisdropped) <> 8
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.spend_cards'::regclass AND contype = 'f' AND convalidated) <> 2
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.spend_cards'::regclass AND contype = 'c' AND convalidated) <> 2
    OR (SELECT count(*) FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'spend_cards') <> 3
  THEN
    RAISE EXCEPTION 'SPEND_CARDS_POSTFLIGHT_CATALOG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
END
$review_candidate$;
