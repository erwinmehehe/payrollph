-- 2026-10-17: REVIEW-ONLY, UNNUMBERED ADDITIVE CANDIDATE. Do NOT execute against
-- production or rename into drizzle/ without a separate reviewed SHA and the
-- protected PLAN/APPLY path; production schema repair stays human/DBA-gated.
-- Why: src/db/schema.ts declares email_change_tokens but no migration creates
-- it, so schema-recovered databases lack it. Retention then fails with 42P01
-- (contained by the isolated retention steps, but the purge and email change
-- flow stay broken until the table exists).
-- Shape mirrors schema.ts exactly. One DO block: preflight, DDL and postflight
-- run atomically; it never runs DML and fails closed if the table already exists
-- (an existing table needs a catalog review, not a silent no-op).
DO $retention_email_change_tokens$
BEGIN
  IF pg_catalog.to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'EMAIL_CHANGE_TOKENS_USERS_TABLE_MISSING' USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.to_regclass('public.email_change_tokens') IS NOT NULL THEN
    RAISE EXCEPTION 'EMAIL_CHANGE_TOKENS_ALREADY_EXISTS_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  CREATE TABLE public.email_change_tokens (
    id serial PRIMARY KEY NOT NULL,
    user_id integer NOT NULL,
    new_email varchar(180) NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_change_tokens_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT email_change_tokens_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
  );

  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.email_change_tokens'::regclass AND attnum > 0 AND NOT attisdropped) <> 7
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.email_change_tokens'::regclass AND contype = 'f' AND convalidated) THEN
    RAISE EXCEPTION 'EMAIL_CHANGE_TOKENS_POSTFLIGHT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
END
$retention_email_change_tokens$;
