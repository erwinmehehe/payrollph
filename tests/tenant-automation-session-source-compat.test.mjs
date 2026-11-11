import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  HISTORICAL_AUTOMATION_SHA, CURRENT_AUTOMATION_SHA,
  verifySessionSourceCompatibility,
} from "../scripts/qa/tenant-automation-session-source-compat.mjs";

test("historical runtime is byte-identical outside the two reviewed separation actions", () => {
  const result = verifySessionSourceCompatibility(HISTORICAL_AUTOMATION_SHA, CURRENT_AUTOMATION_SHA);
  assert.deepEqual({
    credits:result.credits,
    independentlyAccepted:result.independentlyAccepted,
    productionCertified:result.productionCertified,
    sourceSha:result.sourceSha,
    proofStatus:result.proofStatus,
  }, {
    credits:0, independentlyAccepted:false, productionCertified:false,
    sourceSha:CURRENT_AUTOMATION_SHA,
    proofStatus:'COMBINED_HEAD_HTTP_RENEWAL_REQUIRED',
  });
});

test("no silent history repin, unrelated source drift or tampered evidence is permitted", () => {
  const old="src/lib/automation.ts";
  const current=readFileSync(old,"utf8");
  const good=()=>verifySessionSourceCompatibility(HISTORICAL_AUTOMATION_SHA,CURRENT_AUTOMATION_SHA);
  assert.doesNotThrow(good);
  assert.throws(()=>verifySessionSourceCompatibility("not-original",CURRENT_AUTOMATION_SHA));
  assert.throws(()=>verifySessionSourceCompatibility(HISTORICAL_AUTOMATION_SHA,"not-executed"));
  const changed=(path)=>path===old?Buffer.from(current+"\n// altered"):readFileSync(path);
  assert.throws(()=>verifySessionSourceCompatibility(HISTORICAL_AUTOMATION_SHA,CURRENT_AUTOMATION_SHA,changed),
    /current automation engine changed/i);
  for(const path of [
    "src/lib/automation-employee-account-boundary.ts",
    "scripts/qa/tenant-automation-session-ownership-http.mjs",
    ".github/workflows/tenant-automation-session-ownership.yml",
  ]) {
    assert.throws(()=>verifySessionSourceCompatibility(
      HISTORICAL_AUTOMATION_SHA,CURRENT_AUTOMATION_SHA,
      p=>p===path?Buffer.concat([readFileSync(p),Buffer.from(" tampered")]):readFileSync(p)),
    /proof input drift/i,path);
  }
});

test("historical receipts stay immutable and the current job earns zero credits", () => {
  const verifier=readFileSync("scripts/qa/tenant-document-caller-reproof-verify.mjs","utf8");
  assert.match(verifier,/verifyNarrowStudioAutomationSource\(read\)/);
  for(const path of [
    "scripts/qa/tenant-enterprise-admin-credit.mjs",
    "scripts/qa/tenant-security-write-credit.mjs",
    "scripts/qa/tenant-merged-recovery-credit.mjs",
    "scripts/qa/tenant-approvals-credit.mjs",
  ]) assert.match(readFileSync(path,"utf8"),/verifyNarrowStudioAutomationSource\(|verifySessionSourceCompatibility\(/,path);
});
