import assert from "node:assert/strict";
import test from "node:test";
import {analyzeMigrationChanges,parseDiff} from "../scripts/check-sql-migration-history.mjs";
const base=["drizzle/baseline.sql","drizzle/0021_a.sql","drizzle/0021_b.sql","drizzle/0099_latest.sql"];
test("historic collisions remain visible but accepted without changes",()=>{
  const v=analyzeMigrationChanges(base,[]);
  assert.equal(v.maxNumber,99); assert.deepEqual(v.legacyDuplicatePrefixes,["0021"]);
  assert.deepEqual(v.errors,[]);
});
test("unique numbered additions after baseline are permitted",()=>{
  assert.deepEqual(analyzeMigrationChanges(base,[{status:"A",path:"drizzle/0100_compensation_automation_intents.sql"}]).errors,[]);
});
test("new conflicting prefix, out of order prefix or missing prefix is rejected",()=>{
  for(const path of ["drizzle/0099_new.sql","drizzle/0001_old.sql","drizzle/other.sql"]){
    assert.equal(analyzeMigrationChanges(base,[{status:"A",path}]).errors.length,1);
  }
});
test("two new migrations cannot share one prefix",()=>{
  assert.equal(analyzeMigrationChanges(base,[{status:"A",path:"drizzle/0100_a.sql"},{status:"A",path:"drizzle/0100_b.sql"}]).errors.length,1);
});
test("existing file mutation, deletion and rename always blocked",()=>{
  for(const status of ["M","D","T"]){
    assert.equal(analyzeMigrationChanges(base,[{status,path:"drizzle/0099_latest.sql"}]).errors.length,1);
  }
});
test("NUL-separated git diff name-status decoder rejects unknown formats",()=>{
  assert.deepEqual(parseDiff("A\0drizzle/0100_x.sql\0M\0drizzle/0099_latest.sql\0"),[
    {status:"A",path:"drizzle/0100_x.sql"},{status:"M",path:"drizzle/0099_latest.sql"}
  ]);
  assert.throws(()=>parseDiff("A\0"),/Unexpected git diff encoding/);
});

test("next migration number must be contiguous with main and cannot jump ahead", () => {
  const later = analyzeMigrationChanges(base, [{status:"A",path:"drizzle/0101_reviewed_payroll_underpayments.sql"}]);
  assert.equal(later.errors.length,1);
  assert.match(later.errors[0],/expected drizzle\/0100_/);
  const finalPay = analyzeMigrationChanges(base,[{status:"A",path:"drizzle/0102_final_pay_maker_checker.sql"}]);
  assert.match(finalPay.errors[0],/expected drizzle\/0100_/);
});
test("ordered consecutive migrations in one PR pass even if git diff order varies",()=>{
  for(const changes of [
    [{status:"A",path:"drizzle/0100_salary.sql"},{status:"A",path:"drizzle/0101_correction.sql"}],
    [{status:"A",path:"drizzle/0101_correction.sql"},{status:"A",path:"drizzle/0100_salary.sql"}],
  ])assert.deepEqual(analyzeMigrationChanges(base,changes).errors,[]);
});
test("gaps inside one branch are blocked until all preceding SQL is present",()=>{
  const r=analyzeMigrationChanges(base,[
    {status:"A",path:"drizzle/0100_salary.sql"},
    {status:"A",path:"drizzle/0102_final_pay.sql"},
  ]);
  assert.equal(r.errors.length,1);
  assert.match(r.errors[0],/expected drizzle\/0101_/);
});
