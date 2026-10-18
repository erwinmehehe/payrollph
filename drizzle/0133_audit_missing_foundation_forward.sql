-- Issue #908: one atomic forward repair for the observed missing foundation.
-- Run only through the reviewed exact-main migration runner after owner apply approval.
-- Source merge is not authorization; historical receipts must not be fabricated.
-- Trusted NOLOGIN groups must already exist and pass the companion checks.
-- Does not provision logins, switch credentials, seal rows, or enable any flag.
-- Existing owner credentials remain unsafe until the separate restricted-login cutover.
DO $pre$
BEGIN
 IF current_database() IS DISTINCT FROM 'neondb'
 OR current_setting('neon.project_id',true) IS DISTINCT FROM 'calm-wave-70219564'
 OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-lucky-sound-b79i56jw'
 OR current_setting('neon.endpoint_id',true) IS DISTINCT FROM 'ep-cool-hat-b7e7gpoo'
 THEN RAISE EXCEPTION 'ISSUE908_FORWARD_TARGET_MISMATCH'; END IF;
 PERFORM set_config('lock_timeout','3s',true);
 IF to_regclass('public.audit_events') IS NULL OR to_regclass('public.audit_chain_heads') IS NOT NULL
 OR to_regprocedure('public.audit_events_protect()') IS NOT NULL
 OR to_regprocedure('public.seal_audit_events(integer)') IS NOT NULL
 OR to_regprocedure('public.audit_event_row_hash(text,bigint,integer,integer,text,text,text,jsonb,timestamptz)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('audit_events_chain_seq_unique','audit_events_unsealed_idx'))
 THEN RAISE EXCEPTION 'ISSUE908_FOUNDATION_MISSING_OR_PARTIAL_STATE'; END IF;
 LOCK TABLE public.audit_events IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(
  SELECT 1 FROM (VALUES
   ('id','integer',true),('organization_id','integer',false),
   ('actor','character varying(120)',true),('action','character varying(160)',true),
   ('resource','character varying(160)',true),('metadata','jsonb',true),
   ('created_at','timestamp with time zone',true),('chain_seq','bigint',false),
   ('prev_hash','character varying(64)',false),('row_hash','character varying(64)',false)
  ) wanted(name,kind,required)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid='public.audit_events'::regclass
   AND a.attname=wanted.name AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attname IS NULL OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>wanted.kind
   OR a.attnotnull<>wanted.required)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
   ON a.attrelid=d.adrelid AND a.attnum=d.adnum
   WHERE a.attrelid='public.audit_events'::regclass AND a.attname IN ('chain_seq','prev_hash','row_hash'))
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k
   JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='id'
   WHERE k.conrelid='public.audit_events'::regclass AND k.contype='p' AND k.conkey=ARRAY[a.attnum])
 THEN RAISE EXCEPTION 'ISSUE908_FOUNDATION_AUDIT_SHAPE_REFUSED'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_events WHERE chain_seq IS NOT NULL OR prev_hash IS NOT NULL OR row_hash IS NOT NULL)
 THEN RAISE EXCEPTION 'ISSUE908_FOUNDATION_EXISTING_CHAIN_EVIDENCE_REFUSED'; END IF;
END $pre$;

CREATE TABLE public.audit_chain_heads (
 chain_key integer PRIMARY KEY,
 last_seq bigint NOT NULL DEFAULT 0,
 last_hash varchar(64) NOT NULL DEFAULT repeat('0',64),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX audit_events_chain_seq_unique ON public.audit_events
 ((coalesce(organization_id,0)),chain_seq) WHERE chain_seq IS NOT NULL;
CREATE INDEX audit_events_unsealed_idx ON public.audit_events(id) WHERE chain_seq IS NULL;

CREATE FUNCTION public.audit_event_row_hash(prev text,seq bigint,event_id integer,org integer,
 actor text,action text,resource text,metadata jsonb,created timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $hash$
 SELECT encode(sha256(convert_to(jsonb_build_array(prev,seq,event_id,org,actor,action,resource,metadata,
  to_char(created AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'))::text,'UTF8')),'hex')
$hash$;

-- Fail CLOSED until the companion installs the membership-authorized v2 guard.
-- No caller-set maintenance or nested-trigger exception exists here.
CREATE FUNCTION public.audit_events_protect() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $protect$
BEGIN
 RAISE EXCEPTION 'audit_events is append-only; approved forward guard required'
 USING ERRCODE='insufficient_privilege';
END $protect$;
CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON public.audit_events
 FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect();

CREATE FUNCTION public.seal_audit_events(max_rows integer DEFAULT 500) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $seal$
DECLARE event record; key integer; head_seq bigint; head_hash varchar(64); next_hash varchar(64); sealed integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('linaw:audit-chain-seal')) THEN RETURN 0; END IF;
 PERFORM set_config('linaw.audit_sealing','on',true);
 FOR event IN SELECT id,organization_id,actor,action,resource,metadata,created_at
  FROM public.audit_events WHERE chain_seq IS NULL ORDER BY id LIMIT greatest(max_rows,1)
 LOOP
  key:=coalesce(event.organization_id,0);
  INSERT INTO public.audit_chain_heads(chain_key) VALUES(key) ON CONFLICT(chain_key) DO NOTHING;
  SELECT last_seq,last_hash INTO head_seq,head_hash FROM public.audit_chain_heads WHERE chain_key=key;
  next_hash:=public.audit_event_row_hash(head_hash,head_seq+1,event.id,event.organization_id,
   event.actor,event.action,event.resource,event.metadata,event.created_at);
  UPDATE public.audit_events SET chain_seq=head_seq+1,prev_hash=head_hash,row_hash=next_hash WHERE id=event.id;
  UPDATE public.audit_chain_heads SET last_seq=head_seq+1,last_hash=next_hash,updated_at=now() WHERE chain_key=key;
  sealed:=sealed+1;
 END LOOP;
 PERFORM set_config('linaw.audit_sealing','off',true);
 RETURN sealed;
END $seal$;
REVOKE ALL ON FUNCTION public.seal_audit_events(integer) FROM PUBLIC;
-- No data rewrite, sealing/backfill, role grant, migration receipt or cutover here.

-- Companion boundary: failure rolls back the entire foundation with the runner.
DO $pre$
BEGIN
 IF current_database() IS DISTINCT FROM 'neondb'
 OR current_setting('neon.project_id',true) IS DISTINCT FROM 'calm-wave-70219564'
 OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-lucky-sound-b79i56jw'
 OR current_setting('neon.endpoint_id',true) IS DISTINCT FROM 'ep-cool-hat-b7e7gpoo'
 THEN RAISE EXCEPTION 'ISSUE908_FORWARD_TARGET_MISMATCH'; END IF;
 IF to_regprocedure('public.audit_events_protect_v2()') IS NOT NULL
 OR to_regprocedure('public.audit_events_insert_guard_v2()') IS NOT NULL
 OR to_regprocedure('public.audit_events_reject_truncate_v2()') IS NOT NULL
 THEN RAISE EXCEPTION 'ISSUE908_FORWARD_REPLAY_OR_PARTIAL_STATE'; END IF;
 IF to_regclass('public.audit_events') IS NULL OR to_regclass('public.audit_chain_heads') IS NULL
 OR to_regprocedure('public.audit_events_protect()') IS NULL
 OR to_regprocedure('public.seal_audit_events(integer)') IS NULL
 THEN RAISE EXCEPTION 'ISSUE908_FOUNDATION_AND_HISTORY_REQUIRED'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
  ('payrollph_audit_maintenance','payrollph_audit_sealing') AND NOT
  (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))<>2
 THEN RAISE EXCEPTION 'ISSUE908_TRUSTED_NONLOGIN_GROUPS_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member
  WHERE r.rolname IN ('payrollph_audit_sealing','payrollph_audit_maintenance'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d JOIN pg_catalog.pg_roles r ON r.oid=d.refobjid
  WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.deptype='o'
   AND r.rolname IN ('payrollph_audit_sealing','payrollph_audit_maintenance'))
 THEN RAISE EXCEPTION 'ISSUE908_TRUSTED_GROUP_ESCALATION'; END IF;
END $pre$;

CREATE FUNCTION public.audit_events_protect_v2() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
 IF current_setting('linaw.audit_maintenance',true)='on'
 AND pg_catalog.pg_has_role(session_user,'payrollph_audit_maintenance','MEMBER')
 THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='UPDATE' AND current_setting('linaw.audit_sealing',true)='on'
 AND pg_catalog.pg_has_role(session_user,'payrollph_audit_sealing','MEMBER')
 AND OLD.chain_seq IS NULL
 AND (NEW.id,NEW.organization_id,NEW.actor,NEW.action,NEW.resource,NEW.metadata,NEW.created_at)
 IS NOT DISTINCT FROM (OLD.id,OLD.organization_id,OLD.actor,OLD.action,OLD.resource,OLD.metadata,OLD.created_at)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE='insufficient_privilege';
END $body$;

CREATE FUNCTION public.audit_events_insert_guard_v2() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
 IF NEW.chain_seq IS NOT NULL OR NEW.prev_hash IS NOT NULL OR NEW.row_hash IS NOT NULL
 THEN RAISE EXCEPTION 'chain evidence may only be filled by the trusted sealer'
 USING ERRCODE='insufficient_privilege'; END IF;
 RETURN NEW;
END $body$;

CREATE FUNCTION public.audit_events_reject_truncate_v2() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
 RAISE EXCEPTION 'audit history cannot be truncated' USING ERRCODE='insufficient_privilege';
END $body$;

DROP TRIGGER audit_events_protect_mutation ON public.audit_events;
CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON public.audit_events
 FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect_v2();
CREATE TRIGGER audit_events_insert_guard_v2 BEFORE INSERT ON public.audit_events
 FOR EACH ROW EXECUTE FUNCTION public.audit_events_insert_guard_v2();
CREATE TRIGGER audit_events_reject_truncate_v2 BEFORE TRUNCATE ON public.audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.audit_events_reject_truncate_v2();

-- Exact executor/membership grants belong to the separately reviewed credential
-- binding plan. Preserve invoker-rights sealing; never make this SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.seal_audit_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seal_audit_events(integer) TO payrollph_audit_sealing;
