import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {regressionFiles} from "../scripts/run-sharded-tests.mjs";
import {proveCoverage} from "../scripts/qa/verify-audit-0109-shard-plan.mjs";
test("audited PG16 shards prove exactly-once coverage of full npm test inventory",()=>{
 const files=regressionFiles(),result=proveCoverage(files,4);
 assert.equal(result.files,files.length);
 assert.equal(result.counts.reduce((a,b)=>a+b,0),files.length);
 assert.match(result.sha256,/^[a-f0-9]{64}$/);
 assert.throws(()=>proveCoverage(files,3));
 assert.throws(()=>proveCoverage([...files,files[0]].sort(),4));
});
test("0109 trigger and existing four golden suites stay mandatory",()=>{
 const yaml=readFileSync(new URL("../.github/workflows/audit-0109-pg16-acceptance.yml",import.meta.url),"utf8");
 for(const term of ["shard: [0, 1, 2, 3]","fail-fast: false","node scripts/qa/apply-audit-0109-isolated.mjs",
 "node scripts/qa/verify-audit-0109-shard-plan.mjs","node scripts/run-sharded-tests.mjs",
 'test "$test_exit" -eq 0','test "$report_exit" -eq 0',"scripts/wfm-pilot-synthetic-evidence.mjs",
 "npm run payroll:golden","npm run payroll:golden:phase2a","npm run payroll:golden:phase2b",
 "npm run payroll:golden:pay-rules"]){assert.ok(yaml.includes(term),term);}
 // The audited 500-row import tests enforce government-ID encryption.
 // Never disable that protection to satisfy the fictional CI fixture.
 for(const marker of [
   "bank_key=$(openssl rand -hex 32)",
   "pii_key=$(openssl rand -hex 32)",
   'echo "::add-mask::$bank_key"',
   'echo "::add-mask::$pii_key"',
   'echo "BANK_DATA_ENCRYPTION_KEY=$bank_key" >> "$GITHUB_ENV"',
   'echo "PII_ENCRYPTION_KEY=$pii_key" >> "$GITHUB_ENV"'
 ]){assert.ok(yaml.includes(marker),marker);}
 assert.ok(!yaml.includes('PII_ENCRYPTION_KEY: "'),"No static government-ID key in workflow");
 assert.doesNotMatch(yaml,/continue-on-error:\s*true/);
});
test("reporter keeps TAP logs private and aborts on failures",()=>{
 const src=readFileSync(new URL("../scripts/qa/report-audit-0109-suite.mjs",import.meta.url),"utf8");
 for(const term of ["inventoryDigest","selectionDigest","selectedRegressionFiles",
 'writeFileSync("qa-artifacts/audit-0109-pg16-shard-"',"if (!passed) process.exitCode = 1"]){
  assert.ok(src.includes(term),term);
 }
 assert.doesNotMatch(src,/console\.log\(log\)|writeFileSync\([^,]+,\s*log\s*\)/);
});
test("required-shard audit installer refuses non-CI, external and payout-enabled contexts before connecting",()=>{
 const base={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
  GITHUB_ACTIONS:"true",CI:"true",
  DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false"};
 for(const change of [{GITHUB_ACTIONS:"false"},{CI:"false"},
  {DATABASE_URL:"postgresql://fictional:unused@example.invalid/unapproved"},
  {PAYMONGO_DISBURSEMENTS_ENABLED:"true"},{XENDIT_PAYOUTS_ENABLED:"true"}]){
  const child=spawnSync(process.execPath,["scripts/qa/apply-audit-0109-isolated.mjs"],{
   env:{...base,...change},encoding:"utf8",timeout:5000,windowsHide:true});
  assert.equal(child.error,undefined);
  assert.equal(child.status,1);
  assert.match(child.stderr,/AssertionError/);
  assert.equal(child.stdout,"");
 }
});
