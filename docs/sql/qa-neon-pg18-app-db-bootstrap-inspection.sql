-- READ ONLY: source-first PG18 development app_db inspection.
-- Scope: project calm-wave-70219564; branch br-twilight-shape-b70olxgv.
-- Does not create historical migration receipts or authorize real payroll.
WITH s AS (
 SELECT current_database() AS db,current_user AS role_name,
 current_setting('server_version_num')::int AS pg_version,
 pg_catalog.shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),'pg_database') AS label,
 (SELECT count(*)::int FROM pg_catalog.pg_tables WHERE schemaname='public') AS tables,
 (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S') AS sequences,
 (SELECT count(*)::int FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public') AS indexes,
 (SELECT count(*)::int FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND k.contype='f') AS foreign_keys,
 (SELECT count(*)::int FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND k.contype='c') AS checks,
 (SELECT count(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions,
 (SELECT count(*)::int FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS triggers,
 (SELECT count(*)::int FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND NOT k.convalidated) AS invalid_constraints,
 (SELECT count(*)::int FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)) AS invalid_indexes,
 EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.audit_events'::regclass AND tgname='audit_events_protect_mutation' AND tgenabled='O') AS audit_protected,
 EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='qa_bootstrap_evidence.events'::regclass AND tgname='reject_event_update_delete' AND tgenabled='O') AS receipts_append_only,
 EXISTS(SELECT 1 FROM public.organizations) OR EXISTS(SELECT 1 FROM public.employees) OR EXISTS(SELECT 1 FROM public.payroll_runs) OR EXISTS(SELECT 1 FROM public.audit_events) AS sample_employer_rows
),
e AS (
 SELECT count(*)::int AS events,
 count(*) FILTER (WHERE event_type='bootstrap_started')::int AS started,
 count(*) FILTER (WHERE event_type='batch_completed')::int AS batches,
 count(*) FILTER (WHERE event_type='bootstrap_completed')::int AS finished,
 bool_and(artifact_sha256='f7c0a0ce0804c4f1395b11c1c8510f4d4c10286885ebbdc440d7f9645f80a774'
 AND source_commit='0c7295b716476e2493407b5c5549c29b02fdd9b2'
 AND source_schema_blob='8b14e2e20f6d2098254d9e40727c3eda973f464c'
 AND source_action_run=39033078844) AS verified_source
 FROM qa_bootstrap_evidence.events
),
b AS (
 SELECT count(DISTINCT batch_no)::int AS unique_batches,
 min(statement_from)::int AS first_statement,
 max(statement_to)::int AS last_statement,
 bool_and(statement_from=(batch_no-1)*200
 AND statement_to=least(batch_no*200,2836)-1) AS contiguous
 FROM qa_bootstrap_evidence.events WHERE event_type='batch_completed'
)
SELECT 'SOURCE_FIRST_QA_ONLY_NOT_HISTORICAL_MIGRATION' AS evidence_scope,
s.db,s.role_name,s.pg_version,s.tables,s.sequences,s.indexes,s.foreign_keys,s.checks,s.functions,s.triggers,
s.invalid_constraints,s.invalid_indexes,e.events,e.batches,e.finished,b.first_statement,b.last_statement,
(s.db='app_db' AND s.role_name='neondb_owner' AND s.pg_version=180006 AND s.label LIKE 'PAYROLLPH_CLEAN_PG18_DEVELOPMENT_ONLY%'
AND (s.tables,s.sequences,s.indexes,s.foreign_keys,s.checks,s.functions,s.triggers,s.invalid_constraints,s.invalid_indexes)=(280,269,825,920,181,3,1,0,0)
AND s.audit_protected AND s.receipts_append_only AND NOT s.sample_employer_rows
AND e.events=17 AND e.started=1 AND e.batches=15 AND e.finished=1 AND e.verified_source
AND b.unique_batches=15 AND b.first_statement=0 AND b.last_statement=2835 AND b.contiguous)
AS dev_source_bootstrap_structural_pass,
false AS production_release_approved
FROM s CROSS JOIN e CROSS JOIN b;
