import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {criticalReleaseFlagEnabled} from "../src/lib/critical-release-flags";
import {photoCaptureDecision,evaluatePunchTiming,photosDueForPurge,photoExpiry,impossibleTravel,validPunchUuid,validDevicePunchTimestamp} from "../src/lib/workforce-punch-evidence";
import {encryptPunchPhoto,decryptPunchPhoto,stripJpegMetadata} from "../src/lib/workforce-punch-photo-crypto";
import {resolveWebBundyPunchAnchor} from "../src/lib/web-bundy-overnight-anchor";

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

test("staging and approval source guards preserve transaction-level safety",()=>{
  const stage=readFileSync("src/app/api/web-bundy/evidence/route.ts","utf8");
  const review=readFileSync("src/app/api/web-bundy/review/route.ts","utf8");
  assert.match(stage,/await tx\.insert\(auditEvents\)/);
  assert.doesNotMatch(stage,/await recordAuditEvent\(/);
  assert.match(stage,/pg_advisory_xact_lock\(6108/);
  assert.match(stage,/latestConsent\?\.choice!=="accepted"/);
  assert.match(stage,/duplicate\.status/);
  assert.match(review,/pg_advisory_xact_lock\(/);
  assert.match(review,/attendanceRows\.length>1/);
  assert.match(review,/target<=current\.breakEnd/);
  assert.match(review,/action:"wfm-photo-access"/);
  assert.match(review,/requireSensitiveActionMfa\(context\.user!\)/);
  assert.match(review,/Cross-Origin-Resource-Policy/);
});

test("UUID inputs are exact length and shape before touching varchar(36) columns",()=>{
  assert.equal(validPunchUuid("00000000-0000-4000-8000-000000000001"),true);
  assert.equal(validPunchUuid("01234567-89ab-7cde-8fab-0123456789ab"),true);
  for(const bad of [
    "", "-".repeat(36), "f".repeat(36), "00000000-0000-4000-8000-000000000001x",
    "00000000-0000-4000-8000-000000000001".repeat(2),
    "00000000-0000-0000-0000-000000000001",
  ])assert.equal(validPunchUuid(bad),false,bad.slice(0,40));
});

test("browser punch timestamp is an exact canonical UTC instant, never server-local time",()=>{
  assert.equal(validDevicePunchTimestamp("2026-10-12T02:35:00.000Z"),true);
  for(const invalid of [
    "2026-10-12T02:35:00",
    "2026-10-12T02:35:00Z",
    "2026-10-12T02:35:00.000+08:00",
    "2026-02-30T02:35:00.000Z",
    "2026-13-12T02:35:00.000Z",
    "2026-10-12T25:00:00.000Z",
  ]){
    assert.equal(validDevicePunchTimestamp(invalid),false,invalid);
    assert.deepEqual(evaluatePunchTiming(invalid,new Date("2026-10-12T03:00:00.000Z"),"offline"),["time-invalid"]);
  }
});

test("reviewed midnight clock-out closes the eligible prior Manila shift, not today's row",()=>{
  const previous={
    workDate:"2026-10-12",
    timeIn:new Date("2026-10-12T15:30:00.000Z"), // 23:30 Manila
    timeOut:null,
    source:"web_bundy",
  };
  const target=new Date("2026-10-12T18:15:00.000Z"); // 02:15 Manila next day
  const input={
    today:"2026-10-13",now:target,todayPunch:null,
    previousPunch:previous,action:"clock_out" as const,
  };
  assert.deepEqual(resolveWebBundyPunchAnchor(input),{
    workDate:"2026-10-12",usePrevious:true,
    previousOpenRequiresClose:false,previousShiftNeedsReview:false,
  });
  // An unresolved prior-day shift disallows a new clock-in or competing
  // today's record, preventing duplicate payable attendance.
  const clockIn=resolveWebBundyPunchAnchor({...input,action:"clock_in"});
  assert.equal(clockIn.previousOpenRequiresClose,true);
  assert.equal(clockIn.usePrevious,false);
  const today={workDate:"2026-10-13",timeIn:new Date("2026-10-12T17:50:00Z"),timeOut:null,source:"web_bundy"};
  assert.equal(resolveWebBundyPunchAnchor({...input,todayPunch:today}).previousShiftNeedsReview,true);
  assert.equal(resolveWebBundyPunchAnchor({...input,previousPunch:{...previous,source:"manual"}}).previousShiftNeedsReview,true);
  assert.equal(resolveWebBundyPunchAnchor({...input,now:new Date("2026-10-13T14:45:00Z")}).previousShiftNeedsReview,true);
});

test("review approval holds multiple days under payroll cutoff and uses atomic audit",()=>{
  const review=readFileSync("src/app/api/web-bundy/review/route.ts","utf8");
  const stage=readFileSync("src/app/api/web-bundy/evidence/route.ts","utf8");
  const policy=readFileSync("src/app/api/workforce/worksites/route.ts","utf8");
  const offline=readFileSync("src/lib/workforce-punch-offline-queue.ts","utf8");
  assert.match(review,/resolveWebBundyPunchAnchor/);
  assert.match(review,/previousManilaWorkDate/);
  assert.match(review,/workforceAttendancePeriodLocks/);
  assert.match(review,/for\\(const date of new Set\\(\\[String\\(fresh\\.workDate\\),chosenDate,effectiveDate\\]\\)\\)/);
  assert.match(review,/attendanceMutationLock\\(locks,date,"capture"\\)/);
  assert.match(review,/sourceWorkDate:String\\(fresh\\.workDate\\),approvedWorkDate/);
  assert.match(review,/await tx\\.insert\\(auditEvents\\)/);
  assert.match(stage,/liveSitePolicy/);
  assert.match(stage,/geofence-unverified/);
  assert.match(stage,/geofence-verified/);
  assert.match(policy,/pg_advisory_xact_lock\\(6108/);
  assert.match(policy,/await tx\\.insert\\(auditEvents\\)/);
  assert.match(offline,/indexedDB\\.open\\(DB_NAME,2\\)/);
  assert.match(offline,/installationPunchDeviceId/);
  assert.match(offline,/transaction\\.oncomplete/);
});
