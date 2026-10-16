import assert from "node:assert/strict";
import test from "node:test";
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
test("required CI regression shards apply guarded 0109 before the test inventory",()=>{
 const yaml=readFileSync(new URL("../.github/workflows/ci.yml",import.meta.url),"utf8")
  .replace(/\r\n?/g,"\n");
 const start=yaml.indexOf("\n  test-shard:\n");
 const end=yaml.indexOf("\n  check:\n",start);
 assert.ok(start>=0 && end>start,"CI regression shard job is missing");
 const shard=yaml.slice(start,end);
 const bootstrap=shard.indexOf("- name: Apply disposable PostgreSQL schema");
 const protect=shard.indexOf("- name: Apply 0109 audit protection in disposable regression shard");
 const execute=shard.indexOf("- name: Execute complete regression inventory shard");
 assert.ok(bootstrap>=0 && bootstrap<protect && protect<execute,
  "0109 must run after disposable db:push and before the complete test inventory");
 const step=shard.slice(protect,execute);
 assert.match(step,/run:\s*node scripts\/qa\/apply-audit-0109-isolated\.mjs/);
 assert.match(step,/PAYMONGO_DISBURSEMENTS_ENABLED:\s*"false"/);
 assert.match(step,/XENDIT_PAYOUTS_ENABLED:\s*"false"/);
 assert.doesNotMatch(step,/continue-on-error:\s*true/);
});
