#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regressionFiles,selectRegressionShard } from "../run-sharded-tests.mjs";
export function proveCoverage(files,total=4){
  assert.equal(total,4);
  assert.ok(Array.isArray(files)&&files.length>0);
  assert.deepEqual(files,[...new Set(files)].sort());
  const groups=Array.from({length:total},(_,i)=>selectRegressionShard(files,i,total));
  assert.ok(groups.every(x=>x.length>0));
  assert.deepEqual(groups.flat().sort(),files);
  return {files:files.length,counts:groups.map(x=>x.length),
    sha256:createHash("sha256").update(files.join("\n")).digest("hex")};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assert.equal(process.env.CI,"true");
  assert.equal(process.env.GITHUB_ACTIONS,"true");
  assert.equal(process.env.DATABASE_URL,"postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED,"false");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED,"false");
  const shard=Number(process.argv[2]),total=Number(process.argv[3]);
  assert.ok(Number.isSafeInteger(shard)&&shard>=0&&shard<total);
  process.stdout.write(JSON.stringify({event:"audit_0109_complete_coverage",shard,total,
    ...proveCoverage(regressionFiles(),total),isolatedPostgres16:true})+"\n");
 }catch{process.stderr.write("AUDIT_0109_COVERAGE_FAILED\n");process.exitCode=1;}
}
