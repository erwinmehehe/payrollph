import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reconcileArchitecturalMainStatuses, OWNER_APPROVAL_FILE } from "./helpers/tenant-architectural-classification-delta.mjs";

const specs = [
 ["src/app/api/setup/route.ts","GET"],["src/app/api/setup/route.ts","POST"],
 ["src/app/api/intake-challenge/route.ts","POST"],["src/app/api/signup/route.ts","POST"],
 ["src/app/api/signup/resend/route.ts","POST"],["src/app/api/signup/verify/route.ts","POST"],
 ["src/app/api/auth/saml/start/[providerId]/route.ts","GET"],
 ["src/app/api/auth/saml/acs/[providerId]/route.ts","POST"],
 ["src/app/api/hcm/work-items/escalate/route.ts","POST"],
];
function fixture() {
 const m={allApiRouteFiles:{}}, expected={};
 for(const [path,name] of specs) {
  (m.allApiRouteFiles[path]??={methods:[]}).methods.push({name,status:"GAP",testedBy:null});
  (expected[path]??={})[name]="GAP";
 }
 return {m,expected};
}
const noRead=()=>assert.fail("Historical GAPs must not read a later approval record");
test("historical main is unchanged, with zero classifications",()=>{
 const {m,expected}=fixture(), before=structuredClone({m,expected});
 const result=reconcileArchitecturalMainStatuses(assert,m,expected,noRead);
 assert.deepEqual(result,{statuses:expected,publicByDesign:0,privilegedTokenOnly:0});
 assert.deepEqual({m,expected},before);
});
for(const status of ["COVERED","PUBLIC","PRIVILEGED-OPERATIONS-TOKEN-ONLY"]) {
 test("rejects unapproved public-method status "+status,()=>{
  const {m,expected}=fixture();m.allApiRouteFiles[specs[0][0]].methods[0].status=status;
  assert.throws(()=>reconcileArchitecturalMainStatuses(assert,m,expected,noRead),/Unapproved architecture status/);
 });
}
test("rejects invented tenant proof even on a GAP",()=>{
 const {m,expected}=fixture();m.allApiRouteFiles[specs[0][0]].methods[0].testedBy={file:"fake"};
 assert.throws(()=>reconcileArchitecturalMainStatuses(assert,m,expected,noRead),/cannot invent/);
});
test("rejects missing approved method",()=>{
 const {m,expected}=fixture();m.allApiRouteFiles[specs[0][0]].methods.shift();
 assert.throws(()=>reconcileArchitecturalMainStatuses(assert,m,expected,noRead),/Exactly one/);
});
test("rejects duplicate approved method",()=>{
 const {m,expected}=fixture();const a=m.allApiRouteFiles[specs[0][0]].methods;a.push({...a[0]});
 assert.throws(()=>reconcileArchitecturalMainStatuses(assert,m,expected,noRead),/Exactly one/);
});
test("cannot overwrite an already credited expected method",()=>{
 const {m,expected}=fixture();expected[specs[0][0]].GET="COVERED";
 assert.throws(()=>reconcileArchitecturalMainStatuses(assert,m,expected,noRead),/cannot replace/);
});
test("a claimed public label requires exact owner evidence and leaves inputs intact",()=>{
 const {m,expected}=fixture();m.allApiRouteFiles[specs[0][0]].methods[0].status="PUBLIC-BY-DESIGN";
 const before=structuredClone({m,expected});
 assert.throws(()=>reconcileArchitecturalMainStatuses(assert,m,expected,()=>Buffer.from("{}")),/Owner decision changed/);
 assert.deepEqual({m,expected},before);
});
test("an unrelated tenth method stays unexpected",()=>{
 const {m,expected}=fixture();const path="src/app/api/auth/saml/metadata/[providerId]/route.ts";
 m.allApiRouteFiles[path]={methods:[{name:"GET",status:"PUBLIC-BY-DESIGN",testedBy:null}]};
 expected[path]={GET:"GAP"};
 const result=reconcileArchitecturalMainStatuses(assert,m,expected,noRead);
 assert.equal(result.statuses[path].GET,"GAP");
 const actual=Object.fromEntries(Object.entries(m.allApiRouteFiles).map(([p,r])=>[p,Object.fromEntries(r.methods.map(x=>[x.name,x.status]))]));
 assert.notDeepEqual(actual,result.statuses);
});

const ledgerStatuses = manifest => Object.fromEntries(Object.entries(manifest.allApiRouteFiles)
  .map(([path, route]) => [path, Object.fromEntries(route.methods.map(row => [row.name, row.status]))]));
function sourceFixture() {
 const manifest=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
 const expected=ledgerStatuses(manifest);
 for(const [path,verb] of specs) expected[path][verb]="GAP";
 return {manifest,expected};
}
test("integration: approved labels reconcile with no COVERED credit or input mutation",()=>{
 const {manifest,expected}=sourceFixture(), before=structuredClone({manifest,expected});
 const result=reconcileArchitecturalMainStatuses(assert,manifest,expected);
 assert.deepEqual(result.statuses,ledgerStatuses(manifest));
 assert.equal(result.publicByDesign,8);assert.equal(result.privilegedTokenOnly,1);
 assert.deepEqual({manifest,expected},before);
});
test("integration: the observed single SAML main classification is independently validated",()=>{
 const {manifest,expected}=sourceFixture();
 const saml="src/app/api/auth/saml/acs/[providerId]/route.ts";
 for(const [path,verb] of specs) {
  if(path!==saml) manifest.allApiRouteFiles[path].methods.find(row=>row.name===verb).status="GAP";
 }
 const result=reconcileArchitecturalMainStatuses(assert,manifest,expected);
 assert.equal(result.publicByDesign,1);assert.equal(result.privilegedTokenOnly,0);
 assert.deepEqual(result.statuses,ledgerStatuses(manifest));
});
test("integration: main-ref bytes cannot borrow valid source bytes from the checkout",()=>{
 const {manifest,expected}=sourceFixture();
 for(const changed of [
  OWNER_APPROVAL_FILE,
  ...new Set(specs.map(([path])=>path)),
  "src/lib/saml-disabled-boundary.ts",
  "tests/tenant-saml-disabled-boundary.test.ts",
  "scripts/qa/tenant-prelogin-http.mjs",
  ".github/workflows/tenant-prelogin-http.yml",
  "scripts/qa/tenant-hcm-sla-escalate-http.mjs",
  "tests/tenant-hcm-sla-escalate-contract.test.mjs",
 ]) {
  const read=path=>path===changed?Buffer.concat([readFileSync(path),Buffer.from("\n")]):readFileSync(path);
  assert.throws(()=>reconcileArchitecturalMainStatuses(assert,manifest,expected,read),
   {name:"AssertionError"},changed);
 }
});
test("integration: existing labels still reject forged approval and acceptance claims",()=>{
 const {manifest,expected}=sourceFixture();
 for(const [path,verb] of specs) {
  for(const [field,value] of [
   ["methodCoverageCredits",1],["productionCertified",true],
   ["independentSecurityReview","APPROVED"],["classificationApproval","APPROVED"],
  ]) {
   const forged=structuredClone(manifest);
   const row=forged.allApiRouteFiles[path].methods.find(item=>item.name===verb);
   (row.classificationEvidence??row.privilegedOperation)[field]=value;
   assert.throws(()=>reconcileArchitecturalMainStatuses(assert,forged,expected),
    {name:"AssertionError"},path+" "+field);
  }
 }
});
