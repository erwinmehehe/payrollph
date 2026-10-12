import assert from "node:assert/strict";
import test from "node:test";
import {
  mayUploadPunchPhoto, classifyOfflinePunch, executePunchPhotoPurge,
  worksiteImpossibleTravel, opaqueDeviceTokenHash,
} from "../src/lib/workforce-punch-evidence-policy";
import { encryptPunchPhoto, decryptPunchPhoto } from "../src/lib/workforce-punch-photo-crypto";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("declined or missing consent never permits photo upload",()=>{
 assert.equal(mayUploadPunchPhoto({featureEnabled:true,siteEnabled:true,employeeConsented:false}),false);
 assert.equal(mayUploadPunchPhoto({featureEnabled:true,siteEnabled:true,employeeConsented:null}),false);
 assert.equal(mayUploadPunchPhoto({featureEnabled:true,siteEnabled:true,employeeConsented:true}),true);
});
test("offline sync with 31-minute clock skew remains pending review and flagged",()=>{
 const decision=classifyOfflinePunch({
  deviceTimestamp:"2026-10-12T01:00:00.000Z",
  serverReceivedAt:"2026-10-12T01:31:00.000Z",
  skewThresholdMinutes:5,
 });
 assert.deepEqual(decision.flags,["offline-synced"]);
 assert.equal(decision.status,"pending_review");
});
test("multiple employees on one random device and impossible cross-site travel are advisory flags",()=>{
 const travelled=worksiteImpossibleTravel({
   first:{latitude:14.5995,longitude:120.9842,timestamp:"2026-10-12T01:00:00Z"},
   second:{latitude:10.3157,longitude:123.8854,timestamp:"2026-10-12T01:10:00Z"},
 });
 assert.equal(travelled,true);
 const decision=classifyOfflinePunch({
   deviceTimestamp:"2026-10-12T01:30:00Z",
   serverReceivedAt:"2026-10-12T01:30:00Z",
   sharedDevice:true,impossibleTravel:travelled,
 });
 assert.deepEqual(decision.flags,["same-device-multiple-employees","impossible-travel"]);
 assert.equal(decision.status,"pending_review");
 assert.equal(opaqueDeviceTokenHash("11111111-2222-4333-8444-555555555555","x".repeat(40)).length,64);
});
test("purge worker executes deletion only for enumerated expired ids",async()=>{
 const rows=["a","b","c"];let received:string[]=[];
 const deleted=await executePunchPhotoPurge({
   listExpired:async(_now,limit)=>rows.slice(0,limit),
   deleteExpired:async(ids)=>{received=[...ids];return ids.length;},
 },new Date("2026-10-12T00:00:00Z"),2);
 assert.equal(deleted,2);
 assert.deepEqual(received,["a","b"]);
});
test("AES-GCM evidence uses separate purpose and rejects tampering",()=>{
 const env={PII_ENCRYPTION_KEY:Buffer.alloc(32,12).toString("hex")};
 const clear=new Uint8Array([0xff,0xd8,0xff,0xe0,1,2,3]);
 const sealed=encryptPunchPhoto(clear,env);
 assert.deepEqual([...decryptPunchPhoto(sealed,env)],[...clear]);
 assert.throws(()=>decryptPunchPhoto(sealed+"f",env));
});
test("two WFM feature flags are default-off",()=>{
 assert.equal(criticalReleaseFlagEnabled("wfmPunchEvidence",{}),false);
 assert.equal(criticalReleaseFlagEnabled("wfmOfflinePunchQueue",{}),false);
 assert.equal(criticalReleaseFlagEnabled("wfmPunchEvidence",{WFM_PUNCH_PHOTO_EVIDENCE_ENABLED:"true"}),true);
});

test("offline queue scope isolates employer and worker entries, even on a shared browser", async()=>{
 const { scopedOfflinePunches } = await import("../src/lib/workforce-offline-punch-client");
 const records=[
  {id:"a",organizationId:1,employeeId:5,actionType:"clock_in" as const,
   worksiteId:null,deviceToken:"random",deviceTimestamp:"2026-10-12T01:00:00Z"},
  {id:"b",organizationId:2,employeeId:5,actionType:"clock_in" as const,
   worksiteId:null,deviceToken:"random",deviceTimestamp:"2026-10-12T01:00:00Z"},
  {id:"c",organizationId:1,employeeId:6,actionType:"clock_in" as const,
   worksiteId:null,deviceToken:"random",deviceTimestamp:"2026-10-12T01:00:00Z"},
 ];
 assert.deepEqual(scopedOfflinePunches(records,1,5).map(x=>x.id),["a"]);
});
