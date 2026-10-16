#!/usr/bin/env node
/**
 * #1127 separate FOURTH disposable PG16 experiment; NOT a migration file.
 * Renames 54 independently source-vs-candidate verified SAME-CONTRACT FKs
 * only in atlas_name_review_db, and proves rollback + exact object parity.
 * Preserves original three fixtures, 0115-0128, and all red safety gates.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { generateSchemaManifest } from "./lib/issue-1031-schema-manifest.ts";
import { fullSchemaCatalogSql } from "./check-issue-1031-full-schema-diff.ts";
import { diffSchema } from "../src/lib/issue-1031-full-schema-diff.ts";
import {
  checkedSyntheticNamePairs, syntheticRenameStatements,
  verifySyntheticNamePreview,
} from "./lib/independent-name-review.mjs";
import { compare1031Stages, parse0128Renames } from
  "./lib/independent-reconciliation-evidence.mjs";

const WRITER_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const PREVIEW_URL = "postgresql://postgres:postgres@127.0.0.1:5432/atlas_name_review_db";
const DIR = "qa-artifacts/independent-pg16/";
assert.equal(process.env.CI,"true");
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE,"isolated-local-pg16");
assert.equal(process.env.DATABASE_URL,WRITER_URL);
assert.equal(process.env.PRODUCTION_DATABASE_URL,undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED,undefined);
assert.equal(new URL(PREVIEW_URL).hostname,"127.0.0.1");
const sourceReport = JSON.parse(readFileSync(DIR + "issue-1031-side-by-side.json","utf8"));
const pairs = checkedSyntheticNamePairs(sourceReport,process.env.PR_HEAD_SHA);
const statements = syntheticRenameStatements(pairs);
const source0128 = readFileSync("drizzle/0128_recovery_foreign_key_names_forward.sql","utf8");
const sourceManifest = generateSchemaManifest();
assert.ok(sourceManifest.tables.length >= 270);

const CATALOG = String.raw`
SELECT c.oid::text AS oid, tbl.relname AS table_name, c.conname AS name,
 c.contype AS type, c.convalidated AS validated,
 c.condeferrable AS deferrable, c.condeferred AS deferred,
 pg_catalog.pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class tbl ON tbl.oid = c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.oid
`;
const NON_CONSTRAINT = String.raw`
SELECT
 (SELECT md5(coalesce(string_agg(c.relname || ':' || c.relkind::text,
   '|' ORDER BY c.relname,c.relkind::text),''))
   FROM pg_catalog.pg_class c
   WHERE c.relnamespace='public'::regnamespace
   AND c.relkind IN ('r','p','v','m','i','S')) AS relations,
 (SELECT md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' ||
   pg_catalog.format_type(a.atttypid,a.atttypmod), '|'
   ORDER BY c.relname,a.attname),''))
   FROM pg_catalog.pg_attribute a
   JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
   AND a.attnum>0 AND NOT a.attisdropped) AS columns,
 (SELECT md5(coalesce(string_agg(indexname || ':' || indexdef,
   '|' ORDER BY indexname),''))
   FROM pg_catalog.pg_indexes WHERE schemaname='public') AS indexes,
 (SELECT md5(coalesce(string_agg(p.proname || '(' ||
   pg_catalog.pg_get_function_identity_arguments(p.oid) || '):' ||
   pg_catalog.pg_get_functiondef(p.oid),'|'
   ORDER BY p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),''))
   FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace) AS functions
`;

const originalNames = new Map(pairs.map(pair =>
  [pair.table + "." + pair.from, pair.to]));

async function inspect(db) {
  const constraints = (await db.query(CATALOG)).rows;
  const nonConstraints = (await db.query(NON_CONSTRAINT)).rows[0];
  return {constraints,nonConstraints};
}

function assertOnlyNamesChanged(before,after) {
  assert.equal(before.constraints.length,after.constraints.length);
  assert.deepEqual(after.constraints,before.constraints.map(row => ({
    ...row, name:originalNames.get(row.table_name + "." + row.name) ?? row.name,
  })), "FK rename altered OIDs/definitions/validation/other constraints");
  assert.deepEqual(after.nonConstraints,before.nonConstraints,
    "FK name preview changed a nonconstraint schema object");
}

async function compare(db) {
  const observed = (await db.query(fullSchemaCatalogSql)).rows.map(
    ({table_name,kind,object_name,details})=>({
      table_name,kind,object_name,...details,
    }),
  );
  const rows = diffSchema(sourceManifest,observed);
  const counts = Object.fromEntries(["PASS","MISSING","DRIFT","EXTRA"].map(
    status=>[status,rows.filter(row=>row.status===status).length]));
  return {rows,counts};
}

const db = new pg.Client({connectionString:PREVIEW_URL,
  connectionTimeoutMillis:5000,query_timeout:180000});
let transaction=false;
try {
  await db.connect();
  const identity=(await db.query(
    "SELECT current_database() AS name,current_user AS role," +
    "current_setting('server_version_num')::integer AS version," +
    "pg_is_in_recovery() AS standby")).rows[0];
  assert.equal(identity.name,"atlas_name_review_db");
  assert.equal(identity.role,"postgres");
  assert.ok(identity.version>=160000&&identity.version<170000);
  assert.equal(identity.standby,false);

  await db.query("BEGIN");
  transaction=true;
  await db.query("SET LOCAL lock_timeout='5s'");
  await db.query("SET LOCAL statement_timeout='120s'");
  await db.query("SET LOCAL search_path=public");
  const before=await inspect(db);
  const beforeDiff=await compare(db);
  assert.deepEqual(beforeDiff.counts,sourceReport.reconciled.counts,
    "Fourth database must be exact reconciled snapshot");

  // No semantic drift, NOT VALID or duplicate target names may be disguised as
  // a benign FK rename. Compare actual catalog evidence immediately before DDL.
  for (const pair of pairs) {
    assert.equal(before.constraints.filter(r=>r.table_name===pair.table &&
      r.name===pair.from && r.type==="f" && r.validated===true).length,1,
      "Old FK missing or NOT VALID: "+pair.from);
    assert.equal(before.constraints.some(r=>r.table_name===pair.table &&
      r.name===pair.to),false,"Expected FK name already in use");
  }

  await db.query("SAVEPOINT name_only_rehearsal");
  for (const sql of statements) await db.query(sql);
  assertOnlyNamesChanged(before,await inspect(db));
  const proposed=await compare(db);
  const proposedProof=verifySyntheticNamePreview(beforeDiff,proposed,pairs);
  await db.query("ROLLBACK TO SAVEPOINT name_only_rehearsal");
  assert.deepEqual(await inspect(db),before,
    "54-name SAVEPOINT rollback did not restore catalog");
  assert.deepEqual(await compare(db),beforeDiff,
    "54-name SAVEPOINT rollback did not restore #1031 statuses");
  await db.query("RELEASE SAVEPOINT name_only_rehearsal");

  // A second, identical review-only execution is committed so independent
  // metadata-only Atlas and #1031 roles can inspect the fourth throwaway DB.
  for (const sql of statements) await db.query(sql);
  assertOnlyNamesChanged(before,await inspect(db));
  const committedPreview=await compare(db);
  assert.deepEqual(verifySyntheticNamePreview(beforeDiff,committedPreview,pairs),
    proposedProof);
  const afterStage=compare1031Stages({
    source:sourceReport.source,pre0128:sourceReport.candidate,
    post0128:{counts:committedPreview.counts,
      nonPassing:committedPreview.rows.filter(row=>row.status!=="PASS")},
    mappings:parse0128Renames(source0128),
  });
  assert.equal(afterStage.verifiedSemanticFkRenames,49);
  assert.equal(afterStage.afterRecoveryNonPassing,0);
  assert.equal(afterStage.nameOnlyFkPairCountOutside0128,0);
  assert.equal(afterStage.postCandidateOnly,
    sourceReport.reconciliation.postCandidateOnly-108);
  assert.equal(afterStage.fullSchemaParity,"NOT_ESTABLISHED");
  await db.query("COMMIT");
  transaction=false;
  const evidence={
    ...proposedProof,
    fixture:"atlas_name_review_db",
    source:"atlas_reconciled_db",
    originalPost0128Counts:beforeDiff.counts,
    fourthCloneCounts:committedPreview.counts,
    candidateOnlyBefore:sourceReport.reconciliation.postCandidateOnly,
    candidateOnlyAfter:afterStage.postCandidateOnly,
    remainingCategories:afterStage.postCandidateOnlyByCategory,
    originalSourceAndCandidateIntact:true,
    rollbackRehearsed:true,
    onlyFKConstraintNamesChanged:true,
    sourceHistoriesUnmodified:true,
    migrationReceiptCreated:false,
    fullSchemaParity:"NOT_ESTABLISHED",
    productionReadOrWrite:false,
    releaseApproved:false,
    prHeadSha:process.env.PR_HEAD_SHA,
    workflowCommitSha:process.env.GITHUB_SHA,
  };
  writeFileSync(DIR+"issue-1031-name-review-preview.json",
    JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify(evidence));
} catch(error) {
  if(transaction) await db.query("ROLLBACK").catch(()=>{});
  console.error("Independent 54-name-only PG16 preview BLOCKED: "+error.message);
  process.exitCode=1;
} finally {
  await db.end().catch(()=>{});
}
