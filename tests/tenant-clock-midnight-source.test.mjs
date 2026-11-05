import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { guard } from "../scripts/qa/tenant-clock-contract.mjs";
test("deterministic midnight proof must use real local HTTP with no extra credits", () => {
 const src=readFileSync("scripts/qa/tenant-clock-midnight-http.mjs","utf8");
 assert.ok(src.indexOf("guard();")<src.indexOf('import("../../src/db/index.ts")'),
   "Fail-closed guard must precede DB import");
 for (const token of [
  'today + "T00:00:00+08:00"', 'assert.notEqual(clockDay, today',
  '"202"', 'staged.push(response.json.id)',
  "assert.equal(response.status, 202", "assert.equal(response.status, 200",
  "oneRowPerEmployee: true", "higherIdVictimUnchanged: true",
  "newMethodCredits: 0", "independentHumanAcceptance: false",
 ]) assert.ok(src.includes(token), "Missing midnight proof anchor "+token);
 const wf=readFileSync(".github/workflows/tenant-clock-midnight-real-http.yml","utf8");
 assert.match(wf,/image: postgres:16/);
 assert.match(wf,/node --test tests\/tenant-clock-midnight-source.test.mjs/);
 assert.match(wf,/node --import tsx scripts\/qa\/tenant-clock-midnight-http.mjs/);
 assert.match(wf,/npm start -- -H 127\.0\.0\.1/);
});
test("pure environment guard refuses hosted DB, providers and workers for the midnight harness",()=>{
 const valid = {
  TENANT_CLOCK_MODE: "fictional-disposable-only",
  NODE_ENV: undefined, SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WFM_PUNCH_EVIDENCE_ENABLED: "true",
  PUNCH_DEVICE_HASH_KEY: "synthetic-key-".repeat(4),
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
 };
 assert.doesNotThrow(()=>guard(valid));
 for (const [k,v] of [["DATABASE_URL","postgresql://external.invalid/app_db"],
  ["WORKER_ENABLED","true"],["XENDIT_SECRET_KEY","fake"],
  ["NODE_ENV","production"],["PUNCH_DEVICE_HASH_KEY",""]])
  assert.throws(()=>guard({...valid,[k]:v}), k);
});
