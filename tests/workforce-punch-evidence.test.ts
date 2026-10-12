import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes} from "node:crypto";
import {criticalReleaseFlagEnabled} from "../src/lib/critical-release-flags";
import {photoCaptureDecision,evaluatePunchTiming,photosDueForPurge,photoExpiry,impossibleTravel} from "../src/lib/workforce-punch-evidence";
import {encryptPunchPhoto,decryptPunchPhoto,stripJpegMetadata} from "../src/lib/workforce-punch-photo-crypto";

test("flag stays OFF unless explicitly enabled",()=>{
  assert.equal(criticalReleaseFlagEnabled("workforcePunchEvidence",{}),false);
  assert.equal(criticalReleaseFlagEnabled("workforcePunchEvidence",{WFM_PUNCH_EVIDENCE_ENABLED:"true"}),true);
});
test("consent declined: no image may be captured; time evidence remains reviewable",()=>{
  assert.deepEqual(photoCaptureDecision("required","declined",true),{capture:false,review:true,flags:["consent-declined"]});
  assert.deepEqual(photoCaptureDecision("optional","declined",false),{capture:false,review:true,flags:["consent-declined"]});
  assert.equal(photoCaptureDecision("off",null,true).capture,false);
  assert.equal(photoCaptureDecision("required","accepted",true).capture,true);
});
test("offline sync clock skew yields review-only flag",()=>{
  const arrived=new Date("2026-10-12T03:00:00.000Z");
  assert.deepEqual(evaluatePunchTiming("2026-10-12T02:35:00.000Z",arrived,"offline"),["offline-synced"]);
  assert.deepEqual(evaluatePunchTiming("2026-10-12T02:55:00.000Z",arrived,"offline"),[]);
  assert.deepEqual(evaluatePunchTiming("2026-10-12T02:35:00.000Z",arrived,"online"),["clock-skew"]);
  assert.deepEqual(evaluatePunchTiming("nonsense",arrived,"offline"),["time-invalid"]);
});
test("automatic retention picks only expired, non-held encrypted bytes",()=>{
  const at=new Date("2026-10-12T00:00:00Z");
  assert.equal(photoExpiry(new Date("2026-07-14T00:00:00Z")).getTime(),at.getTime());
  const rows=[
    {id:"expired",expiresAt:new Date("2026-10-11"),legalHold:false,sealedPhoto:"enc"},
    {id:"held",expiresAt:new Date("2026-10-11"),legalHold:true,sealedPhoto:"enc"},
    {id:"future",expiresAt:new Date("2026-11-11"),legalHold:false,sealedPhoto:"enc"},
    {id:"already-purged",expiresAt:new Date("2026-10-11"),legalHold:false,sealedPhoto:null},
  ];
  assert.deepEqual(photosDueForPurge(rows,at).map(p=>p.id),["expired"]);
});
test("purpose-derived AES-GCM and key separation",()=>{
  const env={PII_ENCRYPTION_KEY:randomBytes(32).toString("hex")};
  const bytes=Buffer.from("synthetic picture data");
  const encrypted=encryptPunchPhoto(bytes,env);
  assert.ok(!encrypted.includes(bytes.toString()));
  assert.deepEqual(decryptPunchPhoto(encrypted,env),bytes);
  assert.throws(()=>decryptPunchPhoto(encrypted,{PII_ENCRYPTION_KEY:randomBytes(32).toString("hex")}));
});
test("JPEG metadata markers are removed before storage",()=>{
  const source=Uint8Array.from([255,216,255,225,0,6,69,88,73,70,255,218,0,2,17,22,255,217]);
  const clean=stripJpegMetadata(source);
  assert.deepEqual(Array.from(clean),[255,216,255,218,0,2,17,22,255,217]);
});
test("JPEG evidence fails closed on a missing scan, early EOI or hidden metadata", () => {
  const source = Uint8Array.from([255,216,255,225,0,6,69,88,73,70,255,218,0,2,17,22,255,217]);
  const noScan = Uint8Array.from([255,216,255,225,0,6,69,88,73,70,255,217,0,0,0,0]);
  assert.throws(() => stripJpegMetadata(noScan), /no image scan/);
  const earlyEoi = Uint8Array.from([...source.slice(0,-2),255,217,42,43,255,217]);
  assert.throws(() => stripJpegMetadata(earlyEoi), /trailing JPEG/);
  const extraApp = Uint8Array.from([...source.slice(0,-2),255,225,0,4,1,2,255,217]);
  assert.throws(() => stripJpegMetadata(extraApp), /metadata/);
  const noHeader = Uint8Array.from([255,216,255,218,0,32,17,22,255,217,0,0,0,0,0,0]);
  assert.throws(() => stripJpegMetadata(noHeader), /scan/);
});

test("travel uses worksite centre distances without device location history",()=>{
  const a={worksiteId:1,latitude:14.5995,longitude:120.9842,at:new Date("2026-10-12T00:00:00Z")};
  assert.equal(impossibleTravel(a,{worksiteId:2,latitude:10.3157,longitude:123.8854,at:new Date("2026-10-12T00:05:00Z")}),true);
  assert.equal(impossibleTravel(a,{...a,at:new Date("2026-10-12T00:05:00Z")}),false);
});

test("newer worksite deny supersedes a past allow and does not select a fallback site", async () => {
  const { resolvedWorksiteDecision } = await import("../src/lib/workforce-punch-evidence");
  assert.equal(resolvedWorksiteDecision([{ worksiteId: 2, decision: "deny" }, { worksiteId: 1, decision: "allow" }]), null);
  assert.equal(resolvedWorksiteDecision([{ worksiteId: 2, decision: "allow" }, { worksiteId: 1, decision: "deny" }]), 2);
  assert.equal(resolvedWorksiteDecision([]), null);
});
