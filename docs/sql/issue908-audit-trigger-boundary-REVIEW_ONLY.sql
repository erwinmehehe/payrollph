-- Review-only forward candidate, not a numbered migration or applied receipt.
-- Requires approved 0109-equivalent foundation and separately mapped role grants.
-- Never execute on original or active QA; synthetic runner binds only in memory.
DO $pre$
BEGIN
 IF '__ISSUE908_ISOLATED_BRANCH__' = ('__ISSUE908_ISOLATED_' || 'BRANCH__')
 OR current_database() IS DISTINCT FROM 'neondb'
 OR current_setting('neon.project_id',true) IS DISTINCT FROM 'calm-wave-70219564'
 OR current_setting('neon.branch_id',true) IS DISTINCT FROM '__ISSUE908_ISOLATED_BRANCH__'
 OR current_setting('neon.branch_id',true) IN ('br-lucky-sound-b79i56jw','br-green-hat-b77qj8fs')
 THEN RAISE EXCEPTION 'ISSUE908_ISOLATED_REVIEW_ONLY'; END IF;
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
