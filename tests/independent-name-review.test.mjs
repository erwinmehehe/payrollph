import assert from "node:assert/strict";
import test from "node:test";
import {
  checkedSyntheticNamePairs, syntheticRenameStatements, verifySyntheticNamePreview,
} from "../scripts/lib/independent-name-review.mjs";

const sha = "a".repeat(40);
const contract = {columns:["employee_id"],refTable:"employees",
  refColumns:["id"],onDelete:"restrict",onUpdate:"no action",validated:true};
function scenario() {
  const pairs = Array.from({length:54},(_,i)=>({
    table:"tenant_table_"+i, observedName:"legacy_employee_fk_"+i,
    expectedName:"tenant_employee_id_employees_id_fk_"+i,
    foreignKeyDefinitionMatched:true, individuallyApprovedForMigration:false,
  }));
  const rows = pairs.flatMap(pair=>[
    {table:pair.table, object:pair.expectedName,kind:"foreign_key",status:"MISSING",
      expected:contract,actual:null},
    {table:pair.table, object:pair.observedName,kind:"foreign_key",status:"EXTRA",
      expected:null,actual:contract},
  ]);
  const report = {prHeadSha:sha, reconciled:{nonPassing:rows},
    reconciliation:{catalogReconciliationGate:"RECOVERY_0128_NAMES_PAIRED_ONLY",
      verifiedSemanticFkRenames:49,failedRenameChecks:[],
      nameOnlyFkPairsOutside0128:pairs}};
  const before = {rows,counts:{PASS:0,MISSING:54,DRIFT:0,EXTRA:54}};
  const after = {rows:pairs.map(pair=>({
    table:pair.table,object:pair.expectedName,kind:"foreign_key",status:"PASS",
    expected:contract,actual:contract,
  })),counts:{PASS:54,MISSING:0,DRIFT:0,EXTRA:0}};
  return {report,pairs,rows,before,after};
}

test("54 name-only pairs require matching physical FK semantics and exact head",()=>{
  const x=scenario();
  const approved=checkedSyntheticNamePairs(x.report,sha);
  assert.equal(approved.length,54);
  assert.ok(approved.every(r=>r.contract.validated===true));
  const statements=syntheticRenameStatements(approved);
  assert.equal(statements.length,54);
  assert.ok(statements.every(x=>/^ALTER TABLE public\."[a-z0-9_]+"\s+RENAME CONSTRAINT "[a-z0-9_]+" TO "[a-z0-9_]+";$/.test(x)));
  assert.ok(statements.every(x=>!/\b(?:DROP|DELETE|UPDATE|INSERT|CREATE)\b/.test(x)));
  assert.throws(()=>checkedSyntheticNamePairs(x.report,"b".repeat(40)),
    /another PR head/);
});

test("a synthetic rename can resolve 108 name-only rows without touching other defects",()=>{
  const x=scenario();
  const extra={table:"bank_file_validations",object:"legal_entity_id",
    kind:"column",status:"EXTRA",expected:null,actual:{type:"integer"}};
  const before={rows:[...x.before.rows,extra],counts:{...x.before.counts,EXTRA:55}};
  const after={rows:[...x.after.rows,extra],counts:{...x.after.counts,EXTRA:1}};
  const verdict=verifySyntheticNamePreview(before,after,
    checkedSyntheticNamePairs(x.report,sha));
  assert.equal(verdict.exactNameOnlyRenames,54);
  assert.equal(verdict.candidateOnlyCatalogRowsDischargedInSimulation,108);
  assert.equal(verdict.productionParityEstablished,false);
  assert.equal(verdict.dbaApproved,false);
});

test("name-only proof cannot change NOT VALID or any FK contract",()=>{
  const x=scenario();
  x.report.reconciled.nonPassing[0].expected={...contract,validated:false};
  assert.throws(()=>checkedSyntheticNamePairs(x.report,sha),/contract differs/);
  const y=scenario();
  y.report.reconciliation.nameOnlyFkPairsOutside0128[0].individuallyApprovedForMigration=true;
  assert.throws(()=>checkedSyntheticNamePairs(y.report,sha),/true !== false/);
});

test("ambiguous pairing, duplicate names and unsafe identifiers fail closed",()=>{
  const x=scenario();
  x.report.reconciliation.nameOnlyFkPairsOutside0128[1].observedName =
    x.report.reconciliation.nameOnlyFkPairsOutside0128[0].observedName;
  assert.throws(()=>checkedSyntheticNamePairs(x.report,sha),
    /Duplicate|Unrecognized/);
  const y=scenario();
  y.report.reconciliation.nameOnlyFkPairsOutside0128[0].table='employees";DROP TABLE users;--';
  assert.throws(()=>checkedSyntheticNamePairs(y.report,sha),/Unsafe/);
  const z=scenario();
  z.report.reconciliation.nameOnlyFkPairsOutside0128.pop();
  assert.throws(()=>checkedSyntheticNamePairs(z.report,sha),/Unexpected scope/);
});

test("misleading green preview or unrelated row change cannot satisfy proof",()=>{
  const x=scenario(),pairs=checkedSyntheticNamePairs(x.report,sha);
  x.after.rows[0]={...x.after.rows[0],object:"incorrect"};
  assert.throws(()=>verifySyntheticNamePreview(x.before,x.after,pairs),
    /did not become a PASS/);
  const y=scenario();
  y.after.counts.PASS=55;
  assert.throws(()=>verifySyntheticNamePreview(y.before,y.after,pairs),
    /Truncated/);
  const z=scenario();
  const extra={table:"employees",object:"employees_tenant_employer_fk",
    kind:"foreign_key",status:"EXTRA",expected:null,actual:contract};
  z.before.rows.push(extra);z.before.counts.EXTRA++;
  assert.throws(()=>verifySyntheticNamePreview(z.before,z.after,pairs),
    /unrelated drift/);
});
