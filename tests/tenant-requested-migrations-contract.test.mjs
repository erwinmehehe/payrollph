import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {MIGRATION_PROOF_KINDS,migrationProofBody,assertMigrationCommit} from "../scripts/qa/migration-method-proof.mjs";
import {tsImport} from "tsx/esm/api";

// Regression shards intentionally run .mjs tests with plain Node. Load the
// application parser through its TS/alias resolver in that entry point too.
const {parseMigrationCsv}=await tsImport("../src/lib/migration-import.ts",import.meta.url);

const e={org:{id:11},worker:{id:12,employeeNo:"FICTIONAL-11"},marker:"FICT-11"};
test("all four fictional write bodies pass the real migration parser",()=>{
  for(const kind of MIGRATION_PROOF_KINDS){
    const body=migrationProofBody(e,kind);
    const parsed=parseMigrationCsv(body);
    assert.deepEqual(parsed.errors,[],kind+" fixture is valid");
    assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].employeeNo,e.worker.employeeNo);
    assert.equal(body.dryRun,false,"preview is never a commit positive");
  }
});
test("a foreign batch or empty successful response cannot prove an import",()=>{
  const before={batches:[],workers:[],profiles:[],payroll:[],audit:[]};
  assert.throws(()=>assertMigrationCommit(before,before,e,"employees"),/one real committed batch/);
  const foreign={...before,batches:[{id:99,organizationId:99,importKind:"employees",status:"completed"}]};
  assert.throws(()=>assertMigrationCommit(before,foreign,e,"employees"),/accepts another employer's data/);
});
test("migration HTTP runner gates before database imports and retains all action controls",()=>{
  const runner=readFileSync("scripts/qa/tenant-requested-migrations-http.mjs","utf8");
  assert.ok(runner.indexOf("requireDisposableIdentityAccount();")<runner.indexOf('import("../../src/db/index.ts")'));
  for(const fragment of ["GITHUB_ACTIONS","Fresh empty CI database","server_version_num","for(const e of [a,b])","victim.worker.id>6","foreign.status,403","forged.status,422","assertMigrationCommit(before,after,e,kind)","assert.throws(()=>assertMigrationCommit","multipart preview cannot commit","credits:0"]){assert.ok(runner.includes(fragment),fragment);}
});
