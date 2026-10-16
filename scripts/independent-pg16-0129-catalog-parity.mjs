#!/usr/bin/env node
/**
 * #0129 read-only, exact-source #1031 verifier. Compares disposable pre-0129
 * and post-0129 catalogs using the SAME manifest and comparator as #1127.
 * No normalization, waivers, journal changes or real provider access.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const ROOT="qa-artifacts/independent-0129/";
const sourceUrl="postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const beforeUrl="postgresql://catalog_auditor:synthetic_catalog_only@127.0.0.1:5432/atlas_reconciled_db";
const afterUrl="postgresql://catalog_auditor:synthetic_catalog_only@127.0.0.1:5432/atlas_final_db";
assert.equal(process.env.CI,"true");
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE,"isolated-local-pg16");
assert.equal(process.env.DATABASE_URL,sourceUrl);
assert.equal(process.env.PRODUCTION_DATABASE_URL,undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED,undefined);
for(const url of [beforeUrl,afterUrl])assert.equal(new URL(url).hostname,"127.0.0.1");

const {generateSchemaManifest}=await import("./lib/issue-1031-schema-manifest.ts");
const {fullSchemaCatalogSql}=await import("./check-issue-1031-full-schema-diff.ts");
const {diffSchema}=await import("../src/lib/issue-1031-full-schema-diff.ts");
const manifest=generateSchemaManifest();
assert.ok(manifest.tables.length>=270);

const sql=readFileSync(new URL("../drizzle/0129_non_recovery_fk_names_forward.sql",import.meta.url),"utf8");
const map=[...sql.matchAll(/ALTER TABLE public\."([a-z_]+)" RENAME CONSTRAINT "([a-z0-9_]+)" TO "([a-z0-9_]+)";/g)]
  .map(([,table,oldName,newName])=>({table,oldName,newName}));
assert.equal(map.length,54);

const signature=r=>JSON.stringify([r.table,r.kind,r.object,r.status,r.expected,r.actual]);
async function inspect(url,dbName) {
  const client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000});
  await client.connect();
  let tx=false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    tx=true;
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL search_path=pg_catalog");
    const [{db,role,readonly,pg_version,elevated,can_read,can_write}]=(await client.query(
      "SELECT current_database() AS db, current_user AS role,"+
      "current_setting('transaction_read_only') AS readonly,"+
      "current_setting('server_version_num')::integer AS pg_version,"+
      "(SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls "+
      "FROM pg_catalog.pg_roles WHERE rolname=current_user) AS elevated,"+
      "pg_catalog.has_table_privilege(current_user,'public.payroll_entries','SELECT') AS can_read,"+
      "pg_catalog.has_table_privilege(current_user,'public.payroll_entries','INSERT,UPDATE,DELETE,TRUNCATE') AS can_write"
    )).rows;
    assert.equal(db,dbName);
    assert.equal(role,"catalog_auditor");
    assert.equal(readonly,"on");
    assert.equal(elevated,false);
    assert.equal(can_read,false);
    assert.equal(can_write,false);
    assert.ok(pg_version>=160000&&pg_version<170000);
    const observed=(await client.query(fullSchemaCatalogSql)).rows.map(
      ({table_name,kind,object_name,details})=>({
        table_name,kind,object_name,...details
      })
    );
    const all=diffSchema(manifest,observed);
    const counts=Object.fromEntries(["PASS","MISSING","DRIFT","EXTRA"]
      .map(status=>[status,all.filter(r=>r.status===status).length]));
    return {name:dbName,counts,models:manifest.tables.length,
      nonPassing:all.filter(r=>r.status!=="PASS")};
  } finally {
    if(tx)await client.query("ROLLBACK").catch(()=>{});
    await client.end().catch(()=>{});
  }
}
const before=await inspect(beforeUrl,"atlas_reconciled_db");
const after=await inspect(afterUrl,"atlas_final_db");
const pre=before.nonPassing,post=after.nonPassing;
const removed=new Set();
const proven=[];
for(const m of map) {
  const missing=pre.filter(r=>r.table===m.table && r.kind==="foreign_key" &&
    r.status==="MISSING" && r.object===m.newName);
  const extra=pre.filter(r=>r.table===m.table && r.kind==="foreign_key" &&
    r.status==="EXTRA" && r.object===m.oldName);
  assert.equal(missing.length,1,"#1031 missing the new FK prior to 0129: "+m.newName);
  assert.equal(extra.length,1,"#1031 missing the old FK prior to 0129: "+m.oldName);
  assert.deepEqual(extra[0].actual,missing[0].expected,
    "Do not reconcile unlike FK contracts: "+m.newName);
  assert.equal(post.some(r=>r.table===m.table && r.kind==="foreign_key" &&
    [m.oldName,m.newName].includes(r.object)),false,
    "Post-0129 #1031 must have PASS and no leftover FK mismatch: "+m.newName);
  removed.add(signature(missing[0]));
  removed.add(signature(extra[0]));
  proven.push({...m,contractEqual:true,postCatalogPassing:true});
}
assert.equal(removed.size,108,"54 pairs must remove exactly 108 raw mismatch rows");
const expectedResidual=pre.filter(r=>!removed.has(signature(r))).map(signature).sort();
const realResidual=post.map(signature).sort();
assert.deepEqual(realResidual,expectedResidual,
  "0129 changed or masked an unrelated schema object, including material NOT VALID drift");
assert.equal(after.counts.PASS,before.counts.PASS+54);
assert.equal(after.counts.MISSING,before.counts.MISSING-54);
assert.equal(after.counts.EXTRA,before.counts.EXTRA-54);
assert.equal(after.counts.DRIFT,before.counts.DRIFT);
assert.ok(post.length>0,"Cannot declare production parity from a rename-only patch");
const result={
  status:"SYNTHETIC_54_FK_NAME_PAIRS_CATALOG_RECONCILED_ONLY",
  sourceSha256:readFileSync(ROOT+"0129-transactional-rollback.json","utf8")
    ? JSON.parse(readFileSync(ROOT+"0129-transactional-rollback.json","utf8")).sha256:null,
  before:before.counts,after:after.counts,sourceModelCount:manifest.tables.length,
  nameOnlyFkPairs:proven,paired:proven.length,
  postNonPassing:post.length,postUnresolvedRows:post,
  fullApplicationParity:false,
  historicalJournalVerified:false,prodTargetVerified:false,
  DBAApproval:false,permissionRestricted:true,
  actionsReplay:false,realDataUsed:false,
  prHeadSha:process.env.PR_HEAD_SHA||null,
  workflowSha:process.env.GITHUB_SHA||null,
};
writeFileSync(ROOT+"0129-catalog-results.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({
  status:result.status,paired:result.paired,
  before:result.before,after:result.after,
  remainingNonPassing:result.postNonPassing,
  releaseReady:false,
}));
