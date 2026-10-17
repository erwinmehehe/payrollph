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
  FROM (VALUES ('public.organizations'), ('public.expense_reports'), ('public.expense_claims')) AS parents(parent_name)
  WHERE pg_catalog.to_regclass(parent_name) IS NULL;
  IF missing_parent IS NOT NULL THEN
    RAISE EXCEPTION 'EXPENSE_REPORT_ITEMS_PARENT_MISSING: %', missing_parent USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.to_regclass('public.expense_report_items') IS NOT NULL THEN
    RAISE EXCEPTION 'EXPENSE_REPORT_ITEMS_ALREADY_PRESENT_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  CREATE TABLE public."expense_report_items" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "report_id" integer NOT NULL,
    "claim_id" integer NOT NULL,
    CONSTRAINT "expense_report_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES public."organizations"("id") ON DELETE cascade,
    CONSTRAINT "expense_report_items_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES public."expense_reports"("id") ON DELETE restrict,
    CONSTRAINT "expense_report_items_claim_id_expense_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES public."expense_claims"("id") ON DELETE restrict
  );
  CREATE UNIQUE INDEX "expense_report_items_claim_unique" ON public."expense_report_items" ("claim_id");
  CREATE INDEX "expense_report_items_org_report_idx" ON public."expense_report_items" ("organization_id", "report_id");

  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.expense_report_items'::regclass
        AND attnum > 0 AND NOT attisdropped) <> 4
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.expense_report_items'::regclass AND contype = 'f' AND convalidated) <> 3
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.expense_report_items'::regclass AND contype = 'c' AND convalidated) <> 0
    OR (SELECT count(*) FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'expense_report_items') <> 3
  THEN
    RAISE EXCEPTION 'EXPENSE_REPORT_ITEMS_POSTFLIGHT_CATALOG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
END
$review_candidate$;
