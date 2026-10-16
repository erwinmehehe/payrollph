import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  RECOVERY_TABLES, DISPOSABLE_MISSING_TABLES, parse0128Renames,
  compare1031Stages, summarizeAtlasPlan,
} from "../scripts/lib/independent-reconciliation-evidence.mjs";

const contract = { columns:["employee_id"], refTable:"employees", refColumns:["id"],
  onDelete:"cascade", onUpdate:"no action", validated:true };
const statusCounts = (missing=0, extra=0) => ({
  PASS:0, MISSING:missing, DRIFT:0, EXTRA:extra,
});
function stages({ wrongContract=false, residual=false }={}) {
  const mappings = Array.from({length:49}, (_,i) => ({
    table:RECOVERY_TABLES[i%RECOVERY_TABLES.length],
    oldName:"old_"+i, newName:"expected_"+i,
  }));
  const pre = mappings.flatMap((m,i) => [
    {table:m.table,object:m.newName,kind:"foreign_key",status:"MISSING",
      expected:contract,actual:null},
    {table:m.table,object:m.oldName,kind:"foreign_key",status:"EXTRA",
      expected:null,actual:wrongContract && i===0 ?
        {...contract,onDelete:"restrict"} : contract},
  ]);
  const source = {counts:statusCounts(),nonPassing:[]};
  const pre0128 = {counts:statusCounts(49,49),nonPassing:pre};
  const post0128 = {counts:statusCounts(0,residual?1:0),
    nonPassing:residual ? [{
      table:"organizations",kind:"column",status:"EXTRA",object:"enabled_modules",
      actual:{type:"text"},expected:null,
    }] : []};
  return {mappings,source,pre0128,post0128};
}

test("reads exact proposed #1121 0128 source and all 49 explicit names",()=>{
  const sql=readFileSync(new URL("../drizzle/0128_recovery_foreign_key_names_forward.sql",
    import.meta.url),"utf8");
  const renames=parse0128Renames(sql);
  assert.equal(renames.length,49);
  assert.ok(renames.every(m=>RECOVERY_TABLES.includes(m.table)));
  assert.ok(renames.some(m=>m.table==="open_shifts"));
});
test("refuses duplicate and out-of-scope 0128 renames",()=>{
  assert.throws(()=>parse0128Renames(""),/missing/);
  const line='ALTER TABLE public."open_shifts" RENAME CONSTRAINT "old" TO "new";';
  assert.throws(()=>parse0128Renames(line+"\n"+line),/duplicate/);
  assert.throws(()=>parse0128Renames(
    'ALTER TABLE public."payroll_entries" RENAME CONSTRAINT "old" TO "new";'),/outside/);
});
test("exact 49 matched semantic FK renames are accounted but never full-app PASS",()=>{
  const result=compare1031Stages(stages());
  assert.equal(result.verifiedSemanticFkRenames,49);
  assert.equal(result.preCandidateOnly,98);
  assert.equal(result.postCandidateOnly,0);
  assert.equal(result.afterRecoveryNonPassing,0);
  assert.equal(result.catalogReconciliationGate,"RECOVERY_0128_NAMES_PAIRED_ONLY");
  assert.equal(result.fullSchemaParity,"NOT_ESTABLISHED");
  assert.equal(result.DBAApproval,false);
});
test("similar names with different FK delete actions stay BLOCKED",()=>{
  const result=compare1031Stages(stages({wrongContract:true}));
  assert.equal(result.verifiedSemanticFkRenames,48);
  assert.equal(result.failedRenameChecks.length,1);
  assert.equal(result.catalogReconciliationGate,"BLOCKED_RECOVERY_RECONCILIATION");
});
test("source-baseline drift and post-reconcile extra columns are not waived",()=>{
  const x=stages({residual:true});
  const baseline={table:"other_table",object:"nonmodeled_column",kind:"column",
    status:"EXTRA",expected:null,actual:{type:"integer"}};
  x.source.nonPassing.push(baseline);
  x.source.counts.EXTRA=1;
  x.pre0128.nonPassing.push(baseline);
  x.pre0128.counts.EXTRA+=1;
  x.post0128.nonPassing.push(baseline);
  x.post0128.counts.EXTRA+=1;
  const result=compare1031Stages(x);
  assert.equal(result.sourceBaselineNonPassing,1);
  assert.equal(result.postCandidateOnly,1);
  assert.equal(result.postCandidateOnlyByCategory.FORWARD_DDL_VS_SOURCE_MODEL_REVIEW,1);
  assert.equal(result.fullSchemaParity,"NOT_ESTABLISHED");
});
test("Atlas plan summarizes destructive proposed DDL but never executes it",()=>{
  const x=summarizeAtlasPlan(
    '-- notes\nALTER TABLE "payroll_entries" DROP COLUMN "legal_entity_id";\n'+
    'DROP INDEX "foo";\nALTER TABLE "open_shifts" DROP CONSTRAINT "old";\n');
  assert.equal(x.atlasSqlStatementCount,3);
  assert.equal(x.destructiveSuggestionCount,3);
  assert.equal(x.generatedDdlWasExecuted,false);
  assert.deepEqual(x.touchedTableHints,["open_shifts","payroll_entries"]);
});

test("the 25-table synthetic omission list includes all ten recovery targets",()=>{
  assert.equal(DISPOSABLE_MISSING_TABLES.length,25);
  assert.ok(RECOVERY_TABLES.every(x=>DISPOSABLE_MISSING_TABLES.includes(x)));
  assert.ok(DISPOSABLE_MISSING_TABLES.includes("entity_transfer_requests"));
});
test("unresolved same-contract FK names stay in the red residual, distinct from NOT VALID drift",()=>{
  const x=stages();
  const expected={columns:["organization_id"],refTable:"organizations",
    refColumns:["id"],onDelete:"cascade",onUpdate:"no action",validated:true};
  x.post0128.nonPassing.push(
    {table:"provider_events",kind:"foreign_key",status:"MISSING",
      object:"provider_events_org_fk",expected,actual:null},
    {table:"provider_events",kind:"foreign_key",status:"EXTRA",
      object:"provider_events_organization_id_fkey",expected:null,actual:expected},
    {table:"entity_transfer_requests",kind:"foreign_key",status:"DRIFT",
      object:"transfer_employee_tenant_fk",expected,
      actual:{...expected,validated:false}},
  );
  x.post0128.counts.MISSING=1;
  x.post0128.counts.EXTRA=1;
  x.post0128.counts.DRIFT=1;
  const result=compare1031Stages(x);
  assert.equal(result.nameOnlyFkPairCountOutside0128,1);
  assert.equal(result.postCandidateOnlyByCategory
    .FK_NAME_ONLY_IDENTICAL_CONTRACT_OUTSIDE_0128_STILL_UNRESOLVED,2);
  assert.equal(result.postCandidateOnlyByCategory.HISTORICAL_NOT_VALID_FK_REVIEW,1);
  assert.equal(result.postCandidateOnly,3);
  assert.equal(result.fullSchemaParity,"NOT_ESTABLISHED");
});
