import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {HISTORIC_AUTOMATION_SHA,CURRENT_AUTOMATION_SHA,verifyNarrowStudioAutomationSource}
  from "../scripts/qa/tenant-studio-automation-source-compat.mjs";

test("exact four-edit stored-recovery hardening preserves old source without rewriting evidence",()=>{
 assert.match(HISTORIC_AUTOMATION_SHA,/^[a-f0-9]{40}$/);
 assert.match(CURRENT_AUTOMATION_SHA,/^[a-f0-9]{40}$/);
 const result=verifyNarrowStudioAutomationSource();
 assert.deepEqual(result,{kind:"exact-narrowing-with-disposable-evidence",newCredits:0,independentAcceptance:false});
});
test("any source, lock helper, verified receipt or proof drift hard-fails; no blind repin",()=>{
 for(const target of [
  "src/lib/automation.ts","src/lib/automation-recovery-scope.ts",
  "scripts/qa/tenant-studio-recovery-scope-local-receipt.json",
  "scripts/qa/tenant-studio-recovery-scope-http.mjs",
  "scripts/qa/tenant-studio-recovery-scope-contract.mjs",
 ]){
  const read=path=>path===target?Buffer.concat([readFileSync(path),Buffer.from("\n// tampered")]):readFileSync(path);
  assert.throws(()=>verifyNarrowStudioAutomationSource(read),undefined,target);
 }
});
