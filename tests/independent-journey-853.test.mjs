import assert from "node:assert/strict";
import test from "node:test";
import { STAGES, CHECKS, createTemplate, assess, renderSummary } from "../scripts/qa/independent-journey-853.mjs";
const sha="a".repeat(40), proof="UAT-FICTIONAL001";
const people={HR:"PERSON-HR01",MANAGER:"PERSON-MANAGER01",EMPLOYEE:"PERSON-EMPLOYEE01",PAYROLL:"PERSON-PAYROLL01",CHECKER:"PERSON-CHECKER01",OWNER:"PERSON-OWNER01"};
function sample(){
 const m=createTemplate(sha);
 m.runtime={deployedSha:sha,appBuildEvidence:"UAT-BUILD01",fixtureEvidence:"UAT-FIXTURE01",flagEvidence:"UAT-FLAGS01",deviceEvidence:"UAT-PHONES01",databaseIsolationEvidence:"UAT-DB01"};
 for(const s of STAGES)m.stages[s.id]={status:"PASS",operatorRef:people[s.role],witnessRef:"PERSON-QA01",evidenceRef:"UAT-"+s.id.replace("-","")+"01",defectRef:null,blockerCode:null};
 for(const c of CHECKS)m.checks[c.id]={status:"PASS",operatorRef:c.id.startsWith("OWNER_")?people.OWNER:c.id.startsWith("PAYROLL_")?people.PAYROLL:people.HR,witnessRef:"PERSON-QA01",evidenceRef:"UAT-"+c.id.replaceAll("_","")+"01",defectRef:null,blockerCode:null};
 return m;
}
test("starts all 19 outcomes NOT_RUN; never certifies",()=>{
 const m=createTemplate(sha),a=assess(m);
 assert.equal(STAGES.length,9); assert.equal(CHECKS.length,10);
 assert.equal(a.counts.NOT_RUN,19); assert.equal(a.completeForPrivateReview,false);
 assert.equal(a.independentHumanAccepted,false); assert.equal(a.productionAuthorized,false);
 assert.match(renderSummary(m),/PILOT NO-GO/);
});
test("fully populated fictional proof references only become reviewable, not certified",()=>{
 const a=assess(sample());
 assert.equal(a.completeForPrivateReview,true);assert.equal(a.counts.PASS,19);
 assert.equal(a.independentHumanAccepted,false);assert.equal(a.realEmployerReconciled,false);
 assert.equal(a.agencyAccepted,false);
});
test("direct self-witness and witness also operating another stage are rejected",()=>{
 const m=sample();m.stages["JOURNEY-07"].witnessRef=people.CHECKER;
 assert.throws(()=>assess(m),/cannot witness their own/);
 const n=sample();n.stages["JOURNEY-03"].witnessRef=people.OWNER;
 assert.equal(assess(n).completeForPrivateReview,false);
});
test("checker/owner/payroll separation and mobile role mismatches fail closed",()=>{
 const m=sample();m.stages["JOURNEY-06"].operatorRef=people.CHECKER;
 assert.equal(assess(m).completeForPrivateReview,false);
 const n=sample();n.checks.OWNER_PHYSICAL_MOBILE.operatorRef=people.PAYROLL;
 assert.equal(assess(n).completeForPrivateReview,false);
});
test("missing phone proof, stale SHA, duplicated evidence block completeness",()=>{
 const m=sample();m.runtime.deployedSha="b".repeat(40);
 assert.equal(assess(m).completeForPrivateReview,false);
 m.runtime.deployedSha=sha;m.checks.PAYROLL_PHYSICAL_MOBILE={status:"BLOCKED",operatorRef:null,witnessRef:null,evidenceRef:null,defectRef:null,blockerCode:"DEVICE"};
 assert.equal(assess(m).completeForPrivateReview,false);
 const n=sample();n.stages["JOURNEY-02"].evidenceRef=n.stages["JOURNEY-01"].evidenceRef;
 assert.equal(assess(n).completeForPrivateReview,false);
});
test("defect needs BUG reference; raw PII and unrecognized rows are rejected",()=>{
 const m=sample();m.stages["JOURNEY-04"].status="NEEDS_FIX";
 assert.throws(()=>assess(m),/Defect reference/);
 const n=sample();n.stages["JOURNEY-01"].operatorRef="Jane Worker";
 assert.throws(()=>assess(n),/Opaque operator/);
 const p=sample();p.stages["JOURNEY-02"].salary=99999;
 assert.throws(()=>assess(p),/Unexpected or missing fields/);
});
test("unsafe claims always rejected independently of populated evidence",()=>{
 for(const k of Object.keys(sample().safety)){
  const m=sample();m.safety[k]=true;assert.throws(()=>assess(m),/Unsafe external claim/);
 }
});