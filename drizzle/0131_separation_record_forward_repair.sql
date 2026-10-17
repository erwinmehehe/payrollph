-- #1113: additive repair of the observed 20-column legacy separation table.
-- Source merge is NOT production APPLY authorization. The protected runner
-- owns one transaction, exact source checksum, ordered receipts and timeouts.
-- Never infer historic money, actors, approval or release evidence from defaults.
DO $issue1113_separation$
DECLARE
  target_oid oid;
  mismatch text;
  item record;
BEGIN
  target_oid := pg_catalog.to_regclass('public.separation_records');
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_TABLE_MISSING';
  END IF;
  LOCK TABLE public.separation_records IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
    WHERE oid=target_oid AND relkind='r' AND relpersistence='p') THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_RELATION_DRIFT';
  END IF;

  -- Verify the complete observed legacy shape, not only the columns we add.
  SELECT string_agg(e.name, ', ' ORDER BY e.name) INTO mismatch
  FROM (VALUES
    ('id','integer'), ('organization_id','integer'), ('employee_id','integer'),
    ('separation_type','character varying(32)'), ('notice_date','date'),
    ('last_day','date'), ('clearance_status','character varying(32)'),
    ('it_cleared','boolean'), ('admin_cleared','boolean'),
    ('finance_cleared','boolean'), ('hr_cleared','boolean'),
    ('prorated_13th_month','numeric(12,2)'), ('unused_leave_credits','numeric(6,1)'),
    ('leave_monetization_pay','numeric(12,2)'), ('tax_adjustment','numeric(12,2)'),
    ('loan_deductions','numeric(12,2)'), ('net_final_pay','numeric(12,2)'),
    ('status','character varying(32)'), ('coe_issued','boolean'),
    ('created_at','timestamp with time zone')
  ) AS e(name, sql_type)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=target_oid
    AND a.attname=e.name AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attnum IS NULL OR NOT a.attnotnull
    OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>e.sql_type;
  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_LEGACY_COLUMN_DRIFT: %', mismatch;
  END IF;

  -- Refuse partial/replayed repairs: existing fields need a receipt/disposition.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid=target_oid AND attnum>0 AND NOT attisdropped AND attname=ANY(ARRAY[
      'thirteenth_entitlement','thirteenth_paid_ytd','basic_salary_earned_ytd',
      'historical_basic_salary_earned','unpaid_basic_salary','separation_pay',
      'retirement_pay','other_benefits','final_statutory_deductions','gross_final_pay',
      'final_pay_due_date','computation_snapshot','approved_at','released_at',
      'release_reference','prepared_by_user_id','approved_by_user_id','released_by_user_id'
    ])) THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_COLUMNS_ALREADY_PRESENT_REQUIRES_REVIEW';
  END IF;
  IF pg_catalog.to_regclass('public.separation_records_org_status_idx') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=target_oid
      AND conname=ANY(ARRAY['separation_review_identity_separation_check',
        'separation_records_prepared_by_user_id_users_id_fk',
        'separation_records_approved_by_user_id_users_id_fk',
        'separation_records_released_by_user_id_users_id_fk'])) THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_TARGET_NAME_OCCUPIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='id'
    WHERE k.conrelid=target_oid AND k.contype='p' AND k.convalidated
      AND NOT k.condeferrable AND k.conkey=ARRAY[a.attnum]::smallint[]) THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_PRIMARY_KEY_DRIFT';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('organization_id','organizations'), ('employee_id','employees')
  ) AS e(column_name,parent_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname=item.column_name
      JOIN pg_catalog.pg_attribute p ON p.attrelid=k.confrelid AND p.attname='id'
      WHERE k.conrelid=target_oid AND k.contype='f'
        AND k.confrelid=pg_catalog.to_regclass('public.'||item.parent_name)
        AND k.conkey=ARRAY[a.attnum]::smallint[] AND k.confkey=ARRAY[p.attnum]::smallint[]
        AND k.confdeltype='c' AND k.confupdtype='a' AND k.confmatchtype='s'
        AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred) THEN
      RAISE EXCEPTION 'ISSUE1113_SEPARATION_TENANT_FK_DRIFT';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='id'
    WHERE k.conrelid=pg_catalog.to_regclass('public.users') AND k.contype='p'
      AND k.convalidated AND NOT k.condeferrable
      AND k.conkey=ARRAY[a.attnum]::smallint[]
      AND pg_catalog.format_type(a.atttypid,a.atttypmod)='integer') THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_ACTOR_PARENT_DRIFT';
  END IF;

  ALTER TABLE public.separation_records
    ADD COLUMN thirteenth_entitlement numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN thirteenth_paid_ytd numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN basic_salary_earned_ytd numeric(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN historical_basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN unpaid_basic_salary numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN separation_pay numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN retirement_pay numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN other_benefits numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN final_statutory_deductions numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN gross_final_pay numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN final_pay_due_date date,
    ADD COLUMN computation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN approved_at timestamptz,
    ADD COLUMN released_at timestamptz,
    ADD COLUMN release_reference varchar(160),
    ADD COLUMN prepared_by_user_id integer,
    ADD COLUMN approved_by_user_id integer,
    ADD COLUMN released_by_user_id integer,
    ADD CONSTRAINT separation_records_prepared_by_user_id_users_id_fk
      FOREIGN KEY (prepared_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    ADD CONSTRAINT separation_records_approved_by_user_id_users_id_fk
      FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    ADD CONSTRAINT separation_records_released_by_user_id_users_id_fk
      FOREIGN KEY (released_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    ADD CONSTRAINT separation_review_identity_separation_check CHECK (
      prepared_by_user_id IS NULL OR approved_by_user_id IS NULL
      OR prepared_by_user_id <> approved_by_user_id);
  CREATE INDEX separation_records_org_status_idx
    ON public.separation_records(organization_id,status,id);

  -- Verify every added column, including defaults, before the journal can commit.
  SELECT string_agg(e.name, ', ' ORDER BY e.name) INTO mismatch
  FROM (VALUES
    ('thirteenth_entitlement','numeric(12,2)',true,'0'),
    ('thirteenth_paid_ytd','numeric(12,2)',true,'0'),
    ('basic_salary_earned_ytd','numeric(14,2)',true,'0'),
    ('historical_basic_salary_earned','numeric(14,2)',true,'0'),
    ('unpaid_basic_salary','numeric(12,2)',true,'0'),
    ('separation_pay','numeric(12,2)',true,'0'),
    ('retirement_pay','numeric(12,2)',true,'0'),
    ('other_benefits','numeric(12,2)',true,'0'),
    ('final_statutory_deductions','numeric(12,2)',true,'0'),
    ('gross_final_pay','numeric(12,2)',true,'0'),
    ('final_pay_due_date','date',false,NULL),
    ('computation_snapshot','jsonb',true,'''{}''::jsonb'),
    ('approved_at','timestamp with time zone',false,NULL),
    ('released_at','timestamp with time zone',false,NULL),
    ('release_reference','character varying(160)',false,NULL),
    ('prepared_by_user_id','integer',false,NULL),
    ('approved_by_user_id','integer',false,NULL),
    ('released_by_user_id','integer',false,NULL)
  ) AS e(name,sql_type,not_null,default_value)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=target_oid AND a.attname=e.name
    AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attnum IS NULL OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>e.sql_type
    OR a.attnotnull IS DISTINCT FROM e.not_null
    OR pg_catalog.pg_get_expr(d.adbin,d.adrelid) IS DISTINCT FROM e.default_value;
  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE1113_SEPARATION_POSTFLIGHT_DRIFT: %', mismatch;
  END IF;
END
$issue1113_separation$;
