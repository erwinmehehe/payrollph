-- Forward repair for the observed legacy filing/remittance catalog.
-- Source merge does not execute SQL or authorize live payroll/agency actions.
-- Run atomically through the reviewed runner; do not replay historical 0026/0031.
-- Historical filing outcomes/hashes remain unchanged; new snapshot fields are NULL.
DO $filing_remittance_forward$
DECLARE
  target oid;
  item record;
  mismatch text;
BEGIN
  IF pg_catalog.to_regclass('public.government_filing_validations') IS NULL
    OR pg_catalog.to_regclass('public.statutory_remittance_batches') IS NULL
    OR pg_catalog.to_regclass('public.organizations') IS NULL
    OR pg_catalog.to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'FILING_FORWARD_PARENT_MISSING';
  END IF;
  -- Hold parents stable before validating their keys. Never wait behind active
  -- writers/readers: the operator chooses another window on lock contention.
  LOCK TABLE public.organizations, public.users, public.statutory_remittance_batches
    IN SHARE MODE NOWAIT;
  LOCK TABLE public.government_filing_validations IN ACCESS EXCLUSIVE MODE NOWAIT;
  target := 'public.government_filing_validations'::regclass;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=target
    AND (relkind<>'r' OR relpersistence<>'p')) THEN
    RAISE EXCEPTION 'FILING_FORWARD_RELATION_DRIFT';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=target
    AND attnum>0 AND NOT attisdropped)<>19 THEN
    RAISE EXCEPTION 'FILING_FORWARD_LEGACY_COLUMN_COUNT';
  END IF;
  SELECT string_agg(e.name, ', ' ORDER BY e.name) INTO mismatch
  FROM (VALUES
    ('id','integer',true),('organization_id','integer',true),
    ('legal_entity_id','integer',true),('payroll_run_id','integer',false),
    ('agency','character varying(16)',true),('form','character varying(24)',true),
    ('period_label','character varying(80)',true),('file_name','character varying(160)',true),
    ('file_sha256','character varying(64)',true),('generator_version','character varying(48)',true),
    ('status','character varying(16)',true),('submission_method','character varying(16)',false),
    ('agency_reference','character varying(80)',false),('submitted_at','timestamp with time zone',false),
    ('outcome_note','text',false),('generated_by','character varying(120)',true),
    ('recorded_by','character varying(120)',false),('recorded_at','timestamp with time zone',false),
    ('created_at','timestamp with time zone',true)
  ) AS e(name,sql_type,not_null)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=target AND a.attname=e.name
    AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attnum IS NULL OR a.attnotnull IS DISTINCT FROM e.not_null
    OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>e.sql_type;
  IF mismatch IS NOT NULL THEN RAISE EXCEPTION 'FILING_FORWARD_LEGACY_COLUMN_DRIFT: %',mismatch; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=target AND a.attnum>0 AND NOT a.attisdropped
      AND (a.attidentity<>'' OR a.attgenerated<>'' OR
        pg_catalog.pg_get_expr(d.adbin,d.adrelid) IS DISTINCT FROM
        CASE a.attname
          WHEN 'id' THEN pg_catalog.format('nextval(%L::regclass)',
            pg_catalog.pg_get_serial_sequence('public.government_filing_validations','id')::regclass::text)
          WHEN 'status' THEN '''generated''::character varying'
          WHEN 'created_at' THEN 'now()'
          ELSE NULL END)) THEN
    RAISE EXCEPTION 'FILING_FORWARD_LEGACY_DEFAULT_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
      'government_filing_month_idx','statutory_remittance_payment_evidence',
      'statutory_remittance_payment_evidence_id_seq','statutory_remittance_payment_evidence_pkey',
      'statutory_remittance_payment_evidence_hash_unique','statutory_remittance_payment_evidence_batch_idx'])) THEN
    RAISE EXCEPTION 'FILING_FORWARD_TARGET_OCCUPIED';
  END IF;
  FOR item IN SELECT * FROM (VALUES ('organizations'),('users'),
    ('statutory_remittance_batches'),('government_filing_validations')) e(name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='id'
      WHERE k.conrelid=pg_catalog.to_regclass('public.'||item.name)
        AND k.contype='p' AND k.convalidated AND NOT k.condeferrable
        AND k.conkey=ARRAY[a.attnum]::smallint[]
        AND a.attnotnull AND pg_catalog.format_type(a.atttypid,a.atttypmod)='integer') THEN
      RAISE EXCEPTION 'FILING_FORWARD_PARENT_KEY_DRIFT: %',item.name;
    END IF;
  END LOOP;
  -- Existing employer attribution must already be governed; no repair creates
  -- permission grants, assigns an employer, or changes an existing FK action.
  FOR item IN SELECT * FROM (VALUES
    ('organization_id','organizations','c'),('legal_entity_id','legal_entities','r'),
    ('payroll_run_id','payroll_runs','n')) e(column_name,parent_name,delete_action) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname=item.column_name
      JOIN pg_catalog.pg_attribute p ON p.attrelid=k.confrelid AND p.attname='id'
      WHERE k.conrelid=target AND k.contype='f'
        AND k.confrelid=pg_catalog.to_regclass('public.'||item.parent_name)
        AND k.conkey=ARRAY[a.attnum]::smallint[] AND k.confkey=ARRAY[p.attnum]::smallint[]
        AND k.confdeltype::text=item.delete_action AND k.confupdtype='a'
        AND k.confmatchtype='s' AND k.convalidated AND NOT k.condeferrable) THEN
      RAISE EXCEPTION 'FILING_FORWARD_ATTRIBUTION_FK_DRIFT';
    END IF;
  END LOOP;

  ALTER TABLE public.government_filing_validations
    ADD COLUMN applicable_month varchar(7),
    ADD COLUMN employee_count integer,
    ADD COLUMN reported_total numeric(14,2);
  CREATE INDEX government_filing_month_idx
    ON public.government_filing_validations(organization_id,agency,applicable_month,status);
  CREATE TABLE public.statutory_remittance_payment_evidence (
    id serial PRIMARY KEY,
    organization_id integer NOT NULL,
    batch_id integer NOT NULL,
    file_name varchar(180) NOT NULL,
    mime_type varchar(100) NOT NULL,
    byte_size integer NOT NULL,
    file_sha256 varchar(64) NOT NULL,
    file_data_base64 text NOT NULL,
    status varchar(24) NOT NULL DEFAULT 'active',
    replacement_reason varchar(280),
    uploaded_by_user_id integer,
    uploaded_by_name varchar(120) NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    superseded_at timestamptz,
    CONSTRAINT statutory_remittance_payment_evidence_organization_id_organizat
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT statutory_remittance_payment_evidence_batch_id_statutory_remitt
      FOREIGN KEY (batch_id) REFERENCES public.statutory_remittance_batches(id) ON DELETE CASCADE,
    CONSTRAINT statutory_remittance_payment_evidence_uploaded_by_user_id_users
      FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX statutory_remittance_payment_evidence_hash_unique
    ON public.statutory_remittance_payment_evidence(batch_id,file_sha256);
  CREATE INDEX statutory_remittance_payment_evidence_batch_idx
    ON public.statutory_remittance_payment_evidence(organization_id,batch_id,status);

  SELECT string_agg(e.name, ', ' ORDER BY e.name) INTO mismatch
  FROM (VALUES ('applicable_month','character varying(7)'),
    ('employee_count','integer'),('reported_total','numeric(14,2)')) e(name,sql_type)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=target AND a.attname=e.name
    AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attnum IS NULL OR a.attnotnull OR d.oid IS NOT NULL
    OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>e.sql_type;
  IF mismatch IS NOT NULL OR (SELECT count(*) FROM pg_catalog.pg_attribute
    WHERE attrelid='public.statutory_remittance_payment_evidence'::regclass
      AND attnum>0 AND NOT attisdropped)<>14 THEN
    RAISE EXCEPTION 'FILING_FORWARD_POSTFLIGHT_DRIFT';
  END IF;
END
$filing_remittance_forward$;
