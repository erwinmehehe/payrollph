#!/usr/bin/env node
/**
 * Synthetic #0129 exact-source rehearsal. Installs no journal receipts and
 * touches only atlas_final_db in an ephemeral PG16 GitHub Actions container.
 * Never run with Neon, a live customer database, or payroll data.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const SOURCE = "drizzle/0129_non_recovery_fk_names_forward.sql";
const writerUrl = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const finalUrl = "postgresql://postgres:postgres@127.0.0.1:5432/atlas_final_db";
assert.equal(process.env.CI,"true");
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE,"isolated-local-pg16");
assert.equal(process.env.DATABASE_URL,writerUrl);
assert.equal(process.env.PRODUCTION_DATABASE_URL,undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED,undefined);
assert.equal(new URL(finalUrl).hostname,"127.0.0.1");

const sql=readFileSync(new URL("../"+SOURCE,import.meta.url),"utf8");
const clean=sql.replace(/--[^\r\n]*/g,"");
assert.match(clean,/DO \$issue_0129_preflight\$/);
assert.doesNotMatch(clean,/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|GRANT|REVOKE)\s*;/im);
assert.doesNotMatch(clean,/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|TRUNCATE|DROP\s+(?:TABLE|COLUMN|CONSTRAINT)|VALIDATE\s+CONSTRAINT)\b/i);
const renameRegex=/ALTER TABLE public\."([a-z_]+)" RENAME CONSTRAINT "([a-z0-9_]+)" TO "([a-z0-9_]+)";/g;
const changes=[...clean.matchAll(renameRegex)].map(([,table,oldName,newName])=>({table,oldName,newName}));
assert.equal(changes.length,54,"Exact 54 catalog renames required");
const seenOld=new Set(),seenNew=new Set();
for (const item of changes) {
  assert.ok(item.oldName.endsWith("_fkey"),"Only PostgreSQL-generated FK names may be renamed");
  assert.notEqual(item.oldName,item.newName);
  assert.ok(item.oldName.length<=63 && item.newName.length<=63);
  const old=item.table+"/"+item.oldName;
  const next=item.table+"/"+item.newName;
  assert.ok(!seenOld.has(old)&&!seenNew.has(next),"Duplicate FK name in reviewed source");
  seenOld.add(old);seenNew.add(next);
}
assert.equal(
  (clean.match(/ALTER TABLE public\."/g)||[]).length,54,
  "Unreviewed ALTER TABLE SQL in proposed source"
);
const afterPreflight=clean.replace(/DO \$issue_0129_preflight\$[\s\S]*?END \$issue_0129_preflight\$;/m,"");
assert.notEqual(afterPreflight,clean,"Strict 0129 preflight must be present");
const standaloneStatements=afterPreflight.split(";").map(x=>x.trim()).filter(Boolean);
assert.equal(standaloneStatements.length,54,"Unknown or hidden SQL outside 0129 preflight");
for(const statement of standaloneStatements){
  assert.match(statement,
    /^ALTER TABLE public\."[a-z_]+"\s+RENAME CONSTRAINT "[a-z0-9_]+"\s+TO "[a-z0-9_]+"$/,
    "Only literal, reviewed FK name-only ALTER TABLE may execute");
}
const catalogSql=String.raw`
SELECT c.oid::text AS oid,t.relname AS table_name,c.conname AS name,
 c.contype,c.convalidated,c.condeferrable,c.condeferred,
 c.conkey::text AS conkey,c.confkey::text AS confkey,
 c.confrelid::text AS ref_table_oid,c.confupdtype,c.confdeltype,
 c.confmatchtype,pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
JOIN pg_catalog.pg_namespace ns ON ns.oid=t.relnamespace
WHERE ns.nspname='public' ORDER BY c.oid
`;
const nonConstraintSql=String.raw`
SELECT
 (SELECT md5(coalesce(string_agg(c.relname || ':' || c.relkind::text,
  '|' ORDER BY c.relname,c.relkind::text),''))
  FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace
  AND c.relkind IN ('r','p','v','m','i','S')) AS relations,
 (SELECT md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' ||
   pg_catalog.format_type(a.atttypid,a.atttypmod),'|'
   ORDER BY c.relname,a.attname),''))
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
  WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
  AND a.attnum>0 AND NOT a.attisdropped) AS columns,
 (SELECT md5(coalesce(string_agg(indexname || ':' || indexdef,'|'
   ORDER BY indexname),''))
   FROM pg_catalog.pg_indexes WHERE schemaname='public') AS indexes,
 (SELECT md5(coalesce(string_agg(p.proname || '(' ||
   pg_catalog.pg_get_function_identity_arguments(p.oid) || '):' ||
   pg_catalog.pg_get_functiondef(p.oid),'|'
   ORDER BY p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),''))
   FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace) AS functions,
 (SELECT md5(coalesce(string_agg(t.tgname||':'||pg_catalog.pg_get_triggerdef(t.oid),
   '|' ORDER BY t.tgname,t.oid),''))
   FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid IN (SELECT oid FROM pg_catalog.pg_class
     WHERE relnamespace='public'::regnamespace)
   AND NOT t.tgisinternal) AS triggers
`;
const renamed=new Map(changes.map(m=>[m.table+"/"+m.oldName,m.newName]));
async function snapshot(db){
  return {
    constraints:(await db.query(catalogSql)).rows,
    nonConstraint:(await db.query(nonConstraintSql)).rows[0],
  };
}
function onlyNamesChanged(before,after){
  assert.equal(after.constraints.length,before.constraints.length);
  const expected=before.constraints.map(x=>{
    const name=renamed.get(x.table_name+"/"+x.name);
    return name?{...x,name}:x;
  });
  assert.deepEqual(after.constraints,expected,
    "0129 must preserve every FK catalog contract, OID and status");
  assert.deepEqual(after.nonConstraint,before.nonConstraint,
    "0129 must not change relations, columns, indexes, functions or triggers");
}
const db=new pg.Client({connectionString:finalUrl,connectionTimeoutMillis:5000,query_timeout:180000});
let active=false;
try {
  await db.connect();
  const [identity]=(await db.query(
    "SELECT current_database() AS db,current_user AS role,"+
    "current_setting('server_version_num')::integer AS major,pg_is_in_recovery() AS recovering"
  )).rows;
  assert.equal(identity.db,"atlas_final_db");
  assert.equal(identity.role,"postgres");
  assert.ok(identity.major>=160000&&identity.major<170000);
  assert.equal(identity.recovering,false);
  await db.query("BEGIN");
  active=true;
  await db.query("SET LOCAL lock_timeout='5s'");
  await db.query("SET LOCAL statement_timeout='120s'");
  await db.query("SET LOCAL search_path=public");
  const before=await snapshot(db);
  for(const m of changes) {
    assert.equal(before.constraints.filter(x=>
      x.table_name===m.table&&x.name===m.oldName&&x.contype==="f"&&x.convalidated).length,1,
      "Expected exact valid old FK absent: "+m.table+"/"+m.oldName);
    assert.equal(before.constraints.some(x=>x.table_name===m.table&&x.name===m.newName),false,
      "Target FK name already exists");
  }


  // Close the catalog-check / rename TOCTOU window. A second session must
  // be unable to alter even the first FK while the preflight has finished
  // but the protected outer transaction still holds all 15 child locks.
  const reviewedPreflight = sql.match(
    /DO \\$issue_0129_preflight\\$[\\s\\S]*?END \\$issue_0129_preflight\\$;/m
  )?.[0];
  assert.ok(reviewedPreflight, "0129 catalog preflight SQL absent");
  const lockedTables=[...new Set(changes.map(item=>item.table))].sort();
  await db.query("SAVEPOINT preflight_concurrent_ddl");
  await db.query(reviewedPreflight);
  const lockRows=(await db.query(`
    SELECT DISTINCT cls.relname AS table_name
    FROM pg_catalog.pg_locks AS locks
    JOIN pg_catalog.pg_class AS cls ON cls.oid=locks.relation
    WHERE locks.pid=pg_backend_pid() AND locks.granted
      AND locks.mode='AccessExclusiveLock'
      AND cls.relnamespace='public'::regnamespace
      AND cls.relname=ANY($1::text[])
    ORDER BY cls.relname
  `,[lockedTables])).rows;
  assert.deepEqual(lockRows.map(row=>row.table_name),lockedTables,
    "all reviewed FK child tables must be held exclusively before checks");
  const contender=new pg.Client({
    connectionString:finalUrl,connectionTimeoutMillis:5000,query_timeout:5000,
  });
  try {
    await contender.connect();
    await contender.query("SET lock_timeout='250ms'");
    const target=changes[0];
    await assert.rejects(
      ()=>contender.query(
        'ALTER TABLE public."'+target.table+'" RENAME CONSTRAINT "'+
        target.oldName+'" TO "qa_concurrent_fk_swap"'
      ),
      error=>error.code==="55P03",
      "concurrent FK mutation must time out behind the preflight locks"
    );
  } finally {
    await contender.end().catch(()=>{});
  }
  await db.query("ROLLBACK TO SAVEPOINT preflight_concurrent_ddl");
  await db.query("RELEASE SAVEPOINT preflight_concurrent_ddl");
  assert.deepEqual(await snapshot(db),before,
    "concurrency probe must leave every catalog object unchanged");

  // Negative regression: a fake swap must fail the explicit catalog preflight
  // before any of the 54 rename statements run. All changes in this test
  // are rolled back inside the disposable DB.
  const first=changes[0];
  await db.query("SAVEPOINT fake_fk_name");
  await db.query(
    'ALTER TABLE public."'+first.table+'" RENAME CONSTRAINT "'+
      first.oldName+'" TO "qa_swapped_name"'
  );
  await assert.rejects(()=>db.query(sql),e=>e.code==="P0001" &&
    e.message.includes("ISSUE0129_FK_CATALOG_CONTRACT_MISMATCH"));
  await db.query("ROLLBACK TO SAVEPOINT fake_fk_name");
  assert.deepEqual(await snapshot(db),before,"Swapped-FK rejection must roll back");
  await db.query("RELEASE SAVEPOINT fake_fk_name");

  // Negative regression: preserve FK name but swap ON DELETE semantics.
  // No payroll/provider/worker rows exist in this synthetic fixture.
  const semantics=changes.find(m=>m.table==="payout_profiles" &&
    m.oldName==="payout_profiles_organization_id_fkey");
  assert.ok(semantics);
  await db.query("SAVEPOINT fake_fk_semantics");
  await db.query(
    'ALTER TABLE public."payout_profiles" DROP CONSTRAINT "'+semantics.oldName+'"'
  );
  await db.query(
    'ALTER TABLE public."payout_profiles" ADD CONSTRAINT "'+semantics.oldName+
    '" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT'
  );
  await assert.rejects(()=>db.query(sql),e=>e.code==="P0001" &&
    e.message.includes("ISSUE0129_FK_CATALOG_CONTRACT_MISMATCH"));
  await db.query("ROLLBACK TO SAVEPOINT fake_fk_semantics");
  assert.deepEqual(await snapshot(db),before,"Wrong-action rejection must roll back");
  await db.query("RELEASE SAVEPOINT fake_fk_semantics");

  // Successful exact-source rehearsal MUST be wholly reversible.
  await db.query("SAVEPOINT intended_0129_rollback");
  await db.query(sql);
  onlyNamesChanged(before,await snapshot(db));
  await db.query("ROLLBACK TO SAVEPOINT intended_0129_rollback");
  assert.deepEqual(await snapshot(db),before,"0129 successful path must roll back");
  await db.query("RELEASE SAVEPOINT intended_0129_rollback");

  // ONLY this ephemeral fourth database is committed so independent,
  // catalog-only readers can inspect the resulting state.
  await db.query(sql);
  onlyNamesChanged(before,await snapshot(db));
  await db.query("COMMIT");
  active=false;
  console.log(JSON.stringify({
    status:"SYNTHETIC_ONLY_0129_RENAME_REHEARSAL_PASS",
    database:"atlas_final_db",previous:"atlas_reconciled_db",
    file:SOURCE,sha256:createHash("sha256").update(sql).digest("hex"),
    sameContractRenamed:changes.length,
    negativeNameSwapRejected:true,negativeDeleteActionRejected:true,
    successfulRollbackVerified:true,wholeConstraintCatalogPreserved:true,
    nonConstraintCatalogPreserved:true,
    committedToDisposablePG16Only:true,productionContact:false,
    receiptCreated:false,appDataTouched:false,approvedForDeployment:false,
    prHeadSha:process.env.PR_HEAD_SHA||null,
    workflowSha:process.env.GITHUB_SHA||null,
  },null,2));
} catch(error){
  if(active)await db.query("ROLLBACK").catch(()=>{});
  console.error("0129 isolated PG16 checkpoint failed closed: "+error.message);
  process.exitCode=1;
} finally{
  await db.end().catch(()=>{});
}
