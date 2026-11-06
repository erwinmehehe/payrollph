import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import test from "node:test";
test("authenticator proof refuses non-CI execution before opening a database",()=>{
  const r=spawnSync(process.execPath,["scripts/qa/tenant-totp-setup-http.mjs"],{env:{...process.env,CI:"false"},encoding:"utf8"});
  assert.notEqual(r.status,0); assert.match(r.stderr,/PII_APPROVAL_REFUSED/);
});
test("two own account enrollments include encrypted seeds, hashed backups and unchanged victim state",()=>{
  const s=readFileSync("scripts/qa/tenant-totp-setup-http.mjs","utf8");
  assert.ok(s.indexOf("requireDisposablePiiApprovalEnv();")<s.indexOf('import("../../src/db/index.ts")'));
  for(const token of ["for(const f of [a,b])","victimBefore","crypto.hashPassword","security.decryptTotpSecret","backupCodes.map(crypto.sha256)","f.secondId","coverageCredits:0"])
    assert.ok(s.includes(token),token);
  const workflow=readFileSync(".github/workflows/tenant-totp-setup-http.yml","utf8");
  assert.ok(workflow.includes("postgres:16")); assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-totp-setup-http.mjs"));
  assert.doesNotMatch(workflow,/secrets\./);
});
