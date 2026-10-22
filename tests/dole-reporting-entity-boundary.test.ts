import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  unavailableMultiEntityDoleReport, assertSingleEmployerDoleSource,
  DOLE_ENTITY_SOURCE_UNAVAILABLE,
} from "../src/lib/dole-reporting-entity-boundary";
import { isVerifiedDoleThirteenthRead } from "../src/lib/dole-thirteenth-read";

test("DOLE employer-attribution uncertainty is unavailable, never a read/write success", async () => {
  assert.equal(unavailableMultiEntityDoleReport(false), null);
  assert.doesNotThrow(() => assertSingleEmployerDoleSource(false));
  assert.throws(() => assertSingleEmployerDoleSource(true), {message: DOLE_ENTITY_SOURCE_UNAVAILABLE});
  const response = unavailableMultiEntityDoleReport(true);
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.code, DOLE_ENTITY_SOURCE_UNAVAILABLE);
  for (const field of ["profile", "report", "organizationId", "legalEntityId", "submissionHistory", "submissionCurrent"]) {
    assert.equal(Object.hasOwn(body, field), false);
  }
});
test("both API verbs and direct report builder preserve multi-entity denial", () => {
  const source = readFileSync("src/app/api/compliance/dole-13th-month/route.ts", "utf8");
  const build = readFileSync("src/lib/dole-thirteenth-month-report-server.ts", "utf8");
  assert.equal((source.match(/unavailableMultiEntityDoleReport\(criticalReleaseFlagEnabled\("multiEntity"\)\)/g) ?? []).length, 2);
  assert.match(build, /assertSingleEmployerDoleSource\(criticalReleaseFlagEnabled\("multiEntity"\)\)/);
});
test("legacy 200 requires correct employer/year, amounts and real source/submission envelope", () => {
  const sha = "a".repeat(64);
  const valid = {
    organizationId:31, legalEntityId:null,
    organization:{id:31,name:"Fictional",legalName:"Fictional Inc."},
    profile:null,
    report:{
      reportType:"13th_month_pay",taxYear:2026,dueDate:"2027-01-15",
      establishmentName:"Fictional Inc.",establishmentAddress:"",principalBusiness:"",
      totalEmployment:1,workersBenefited:1,totalBenefitsGranted:123.45,
      contactName:"",contactPosition:"",contactPhone:"",
      employees:[{employeeNo:"E101",employeeName:"Fictional Employee",amountGranted:123.45}],
    },
    reportHash:sha,profileComplete:false,readyToSubmit:false,
    reviewRows:[],incompleteBasicRows:[],sourceNote:"Draft source worksheet",
    submissionCurrent:false,currentSubmission:null,latestSubmission:null,submissionHistory:[],
    officialSource:{label:"DOLE Online Compliance Portal",url:"https://reports.dole.gov.ph/",deadline:"2027-01-15"},
  };
  assert.equal(isVerifiedDoleThirteenthRead(valid,31,2026), true);
  for(const bad of [
    {...valid,organizationId:32},{...valid,legalEntityId:999},
    {...valid,report:{...valid.report,taxYear:2025}},
    {...valid,report:{...valid.report,totalBenefitsGranted:0}},
    {...valid,report:{...valid.report,workersBenefited:0}},
    {...valid,report:{...valid.report,employees:undefined}},
    {...valid,submissionCurrent:true},{...valid,submissionHistory:undefined},
  ]) assert.equal(isVerifiedDoleThirteenthRead(bad,31,2026),false);
});

test("DOLE advisory rows reject duplicate or mismatched employee data", () => {
  const sample = {
    organizationId: 31, legalEntityId: null,
    organization: { id: 31, name: "Fictional", legalName: "Fictional" },
    profile: null,
    report: { reportType: "13th_month_pay", taxYear: 2026, dueDate: "2027-01-15",
      establishmentName: "Fictional", establishmentAddress: "", principalBusiness: "",
      totalEmployment: 1, workersBenefited: 1, totalBenefitsGranted: 100,
      contactName: "", contactPosition: "", contactPhone: "",
      employees: [{employeeNo:"E1", employeeName:"Worker", amountGranted:100}] },
    reportHash:"a".repeat(64), profileComplete:false, readyToSubmit:false,
    reviewRows:[], incompleteBasicRows:[], sourceNote:"Fictional",
    submissionCurrent:false, currentSubmission:null, latestSubmission:null, submissionHistory:[],
    officialSource:{label:"DOLE Online Compliance Portal",url:"https://reports.dole.gov.ph/",deadline:"2027-01-15"},
  };
  const review = { employeeNo:"E1", employeeName:"Worker", amountGranted:100,
    screeningEntitlement:120, screeningShortfall:20 };
  assert.equal(isVerifiedDoleThirteenthRead({...sample,reviewRows:[review]},31,2026),true);
  for (const bad of [
    {...sample,reviewRows:[review,review]},
    {...sample,reviewRows:[{...review,employeeName:"Different"}]},
    {...sample,reviewRows:[{...review,amountGranted:99}]},
    {...sample,incompleteBasicRows:[{employeeNo:"E1",employeeName:"Wrong"}]},
    {...sample,incompleteBasicRows:[{employeeNo:"E1",employeeName:"Worker"},{employeeNo:"E1",employeeName:"Worker"}]},
    {...sample,reviewRows:[review],incompleteBasicRows:[{employeeNo:"E1",employeeName:"Worker"}]},
  ]) assert.equal(isVerifiedDoleThirteenthRead(bad,31,2026),false);
});

test("DOLE mutation confirmation requires matching post-write source state", () => {
  const component = readFileSync("src/components/workspace/dole-thirteenth-month-report-panel.tsx","utf8");
  assert.match(component,/const refreshed = await load\(\(fresh\) =>/);
  assert.match(component,/saved\.organizationId === organizationId/);
  assert.match(component,/fresh\.submissionHistory\.some\(row => row\.id === saved\.id/);
  assert.match(component,/row\.portalReference === saved\.portalReference/);
  assert.match(component,/if \(!refreshed\) \{/);
  assert.match(component,/may have been recorded, but its current state could not be verified/);
});
