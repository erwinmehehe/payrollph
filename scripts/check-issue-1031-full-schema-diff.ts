import { assertCatalogAuditorPrivilegeBoundary, catalogAuditorConnectionOptions } from "./lib/production-catalog-auditor-gate.mjs";
import { Client } from "pg";
import { generateSchemaManifest } from "./lib/issue-1031-schema-manifest";
import { diffSchema, EVIDENCE, type CatalogRow } from "../src/lib/issue-1031-full-schema-diff";
import { summarizeRlsPolicyCoverage, type RlsCatalogRow } from "../src/lib/issue-1031-rls-catalog";

/** Metadata-only. No application-table SELECT, no DDL or writes. */
export const fullSchemaCatalogSql = `
WITH tab AS (
 SELECT c.oid, c.relname AS table_name
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
), objects AS (
 SELECT t.table_name, 'table'::text AS kind, t.table_name AS object_name, '{}'::jsonb AS details
 FROM tab t
 UNION ALL
 SELECT t.table_name,'column',a.attname,
 pg_catalog.jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),
  'nullable',NOT a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),
  'identity',NULLIF(a.attidentity,''))
 FROM tab t JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT t.table_name,'foreign_key',con.conname,
 pg_catalog.jsonb_build_object(
 'columns',(SELECT pg_catalog.jsonb_agg(a.attname ORDER BY u.ord) FROM pg_catalog.unnest(con.conkey) WITH ORDINALITY AS u(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.num),
 'ref_table',ref.relname,
 'ref_columns',(SELECT pg_catalog.jsonb_agg(a.attname ORDER BY u.ord) FROM pg_catalog.unnest(con.confkey) WITH ORDINALITY AS u(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=ref.oid AND a.attnum=u.num),
 'on_delete',CASE con.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END,
 'on_update',CASE con.confupdtype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END,
 'validated',con.convalidated)
 FROM tab t JOIN pg_catalog.pg_constraint con ON con.conrelid=t.oid AND con.contype='f'
 JOIN pg_catalog.pg_class ref ON ref.oid=con.confrelid
 UNION ALL
 SELECT t.table_name,'check',con.conname,
 pg_catalog.jsonb_build_object('expression',pg_catalog.pg_get_expr(con.conbin,con.conrelid),'validated',con.convalidated)
 FROM tab t JOIN pg_catalog.pg_constraint con ON con.conrelid=t.oid AND con.contype='c'
 UNION ALL
 SELECT t.table_name,CASE WHEN con.contype='p' THEN 'primary_key' ELSE 'unique_constraint' END,con.conname,
 pg_catalog.jsonb_build_object('columns',(SELECT pg_catalog.jsonb_agg(a.attname ORDER BY u.ord) FROM pg_catalog.unnest(con.conkey) WITH ORDINALITY AS u(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.num),
 'nulls_not_distinct',ind.indnullsnotdistinct,'validated',con.convalidated)
 FROM tab t JOIN pg_catalog.pg_constraint con ON con.conrelid=t.oid AND con.contype IN ('p','u')
 LEFT JOIN pg_catalog.pg_index ind ON ind.indexrelid=con.conindid
 UNION ALL
 SELECT t.table_name,'index',idx.relname,
 pg_catalog.jsonb_build_object('unique',ind.indisunique,'method',am.amname,
 'keys',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(ind.indexrelid,k,true) ORDER BY k) FROM pg_catalog.generate_series(1,ind.indnkeyatts) k),
 'predicate',pg_catalog.pg_get_expr(ind.indpred,ind.indrelid),'valid',ind.indisvalid,'ready',ind.indisready)
 FROM tab t JOIN pg_catalog.pg_index ind ON ind.indrelid=t.oid
 JOIN pg_catalog.pg_class idx ON idx.oid=ind.indexrelid
 JOIN pg_catalog.pg_am am ON am.oid=idx.relam
 WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint con WHERE con.conindid=idx.oid AND con.contype IN ('p','u'))
)
SELECT table_name,kind,object_name,details FROM objects ORDER BY table_name,kind,object_name
`;

export const rlsCatalogSql = `
SELECT c.relname::text AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       p.polname::text AS policy_name,
       p.polcmd::text AS policy_command,
       p.polpermissive AS policy_permissive,
       CASE WHEN p.oid IS NULL THEN NULL ELSE ARRAY(
         SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'::text
                     ELSE pg_catalog.pg_get_userbyid(role_oid)::text END
         FROM pg_catalog.unnest(p.polroles) AS policy_role(role_oid) ORDER BY 1
       ) END AS policy_roles,
       pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname, p.polname
`;

async function main(){
 const db=process.env.EXPECTED_PRODUCTION_DATABASE_NAME;
 const url=process.env.PRODUCTION_DATABASE_URL;
 const sha=process.env.REVIEWED_SHA;
 const runSha=process.env.GITHUB_SHA;
 if(!url||!db||!sha||!runSha||!(/^[a-f0-9]{40}$/.test(sha))||sha!==runSha||process.env.GITHUB_REF!=="refs/heads/main"){
  console.error("Missing protected target or exact reviewed main SHA; no database queried.");process.exitCode=2;return;
 }
 const manifest=generateSchemaManifest();
 let options;
 try { options=catalogAuditorConnectionOptions(url,db); }
 catch { console.error("Catalog connection must use the pinned protected TLS endpoint; no database queried.");process.exitCode=2;return; }
 const client=new Client(options);
 let connected=false,tx=false;
 try{
  await client.connect();connected=true;
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");tx=true;
  await client.query("SET LOCAL statement_timeout='7000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  await client.query("SET LOCAL search_path=pg_catalog");
  await assertCatalogAuditorPrivilegeBoundary(client,{expectedDatabase:db});
  // Exact same role/identity guard predicates as check-production-schema-preflight.ts,
  // with the complete manifest's table names instead of its 13 canaries.
  const identity=await client.query<{databaseMatches:boolean;readOnly:boolean;elevated:boolean;canWrite:boolean;canReadPayrollRows:boolean}>(`
    SELECT
      current_database() = $1::text AS "databaseMatches",
      current_setting('transaction_read_only') = 'on' AS "readOnly",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
        WHERE r.rolname = current_user AND
          (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
      ) AS elevated,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($2::text[])
          AND pg_catalog.has_table_privilege(current_user, c.oid,
            'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      ) AS "canWrite",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY(ARRAY['employees', 'payroll_entries', 'payroll_runs', 'separation_records'])
          AND pg_catalog.has_any_column_privilege(current_user, c.oid, 'SELECT')
      ) AS "canReadPayrollRows"
  `,[db,manifest.tables.map(t=>t.name)]);
  const i=identity.rows[0];
  if(!i?.databaseMatches||!i.readOnly||i.elevated||i.canWrite||i.canReadPayrollRows)throw new Error("catalog-only role guard failed");
  const observed=await client.query<{table_name:string;kind:string;object_name:string;details:Record<string,unknown>}>(fullSchemaCatalogSql);
  const rows:CatalogRow[]=observed.rows.map(({table_name,kind,object_name,details})=>({table_name,kind,object_name,...details}));
  const diff=diffSchema(manifest,rows);
  // The same approved catalog-only transaction captures all public base and
  // partitioned-table RLS metadata. No application rows or policy evaluation.
  const observedRls=await client.query<RlsCatalogRow>(rlsCatalogSql);
  const rlsCoverage=summarizeRlsPolicyCoverage(manifest.tables.map(t=>t.name),observedRls.rows);
  await client.query("ROLLBACK");tx=false;
  const counts=Object.fromEntries(["PASS","MISSING","DRIFT","EXTRA"].map(s=>[s,diff.filter(r=>r.status===s).length]));
  console.log(JSON.stringify({evidenceScope:EVIDENCE,sourceSha:sha,checkedTables:manifest.tables.length,counts,rows:diff,rlsCoverage,policyParityVerified:false,completeSchemaParity:false,readOnly:true,applicationRowsQueried:false,migrationReceiptsVerified:false,approvedForDeployment:false},null,2));
  if(diff.some(r=>r.status!=="PASS"))process.exitCode=1;
 }catch{if(tx)try{await client.query("ROLLBACK")}catch{}console.error("Catalog-only full schema inspection failed closed; no database error details printed.");process.exitCode=2;}finally{if(connected)try{await client.end()}catch{}}
}
if(process.argv[1]?.endsWith("check-issue-1031-full-schema-diff.ts"))void main();
