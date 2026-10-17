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
  FROM (VALUES ('public.organizations'), ('public.spend_cards'), ('public.users')) AS parents(parent_name)
  WHERE pg_catalog.to_regclass(parent_name) IS NULL;
  IF missing_parent IS NOT NULL THEN
    RAISE EXCEPTION 'SPEND_CARD_TRANSACTIONS_PARENT_MISSING: %', missing_parent USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.to_regclass('public.spend_card_transactions') IS NOT NULL THEN
    RAISE EXCEPTION 'SPEND_CARD_TRANSACTIONS_ALREADY_PRESENT_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  CREATE TABLE public."spend_card_transactions" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "card_id" integer NOT NULL,
    "external_reference" varchar(120) NOT NULL,
    "merchant" varchar(160) NOT NULL,
    "category" varchar(60) NOT NULL DEFAULT 'Other',
    "amount" numeric(12,2) NOT NULL,
    "spent_on" date NOT NULL,
    "recorded_by_user_id" integer,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "spend_card_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES public."organizations"("id") ON DELETE cascade,
    CONSTRAINT "spend_card_transactions_card_id_spend_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES public."spend_cards"("id") ON DELETE restrict,
    CONSTRAINT "spend_card_transactions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES public."users"("id") ON DELETE set null,
    CONSTRAINT "spend_card_tx_amount_check" CHECK ("amount" > 0)
  );
  CREATE UNIQUE INDEX "spend_card_transactions_dedupe" ON public."spend_card_transactions" ("organization_id", "card_id", "external_reference");
  CREATE INDEX "spend_card_transactions_org_idx" ON public."spend_card_transactions" ("organization_id", "spent_on");

  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.spend_card_transactions'::regclass
        AND attnum > 0 AND NOT attisdropped) <> 10
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.spend_card_transactions'::regclass AND contype = 'f' AND convalidated) <> 3
    OR (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.spend_card_transactions'::regclass AND contype = 'c' AND convalidated) <> 1
    OR (SELECT count(*) FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'spend_card_transactions') <> 3
  THEN
    RAISE EXCEPTION 'SPEND_CARD_TRANSACTIONS_POSTFLIGHT_CATALOG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
END
$review_candidate$;
