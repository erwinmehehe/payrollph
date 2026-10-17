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
  FROM (VALUES ('public.organizations'), ('public.employees'), ('public.users')) AS parents(parent_name)
  WHERE pg_catalog.to_regclass(parent_name) IS NULL;
  IF missing_parent IS NOT NULL THEN
    RAISE EXCEPTION 'EXPENSE_REPORTS_PARENT_MISSING: %', missing_parent USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.to_regclass('public.expense_reports') IS NOT NULL THEN
    RAISE EXCEPTION 'EXPENSE_REPORTS_ALREADY_PRESENT_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  CREATE TABLE public."expense_reports" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "employee_id" integer NOT NULL,
    "title" varchar(180) NOT NULL,
    "total_amount" numeric(12,2) NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'submitted',
    "submitted_by_user_id" integer NOT NULL,
    "submitted_at" timestamptz NOT NULL DEFAULT now(),
    "decided_by_user_id" integer,
    "decided_at" timestamptz,
    "decision_note" varchar(240),
    CONSTRAINT "expense_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES public."organizations"("id") ON DELETE cascade,
    CONSTRAINT "expense_reports_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE restrict,
    CONSTRAINT "expense_reports_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES public."users"("id") ON DELETE restrict,
    CONSTRAINT "expense_reports_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES public."users"("id") ON DELETE set null,
    CONSTRAINT "expense_report_amount_check" CHECK ("total_amount" > 0),
    CONSTRAINT "expense_report_state_check" CHECK ("status" in ('submitted','approved','rejected')),
    CONSTRAINT "expense_report_maker_checker_check" CHECK ("decided_by_user_id" is null or "decided_by_user_id" <> "submitted_by_user_id")
  );
  CREATE INDEX "expense_reports_queue_idx" ON public."expense_reports" ("organization_id", "status", "employee_id");

  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.expense_reports'::regclass
        AND attnum > 0 AND NOT attisdropped) <> 11
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.expense_reports'::regclass AND contype = 'f' AND convalidated) <> 4
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.expense_reports'::regclass AND contype = 'c' AND convalidated) <> 3
    OR (SELECT count(*) FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'expense_reports') <> 2
  THEN
    RAISE EXCEPTION 'EXPENSE_REPORTS_POSTFLIGHT_CATALOG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
END
$review_candidate$;
