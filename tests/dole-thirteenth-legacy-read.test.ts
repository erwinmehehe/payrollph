import assert from "node:assert/strict";
import test from "node:test";
import { doleThirteenthReadFailure, parseDoleThirteenthRead } from "../src/lib/dole-thirteenth-read";

const empty = {
  organizationId: 71, legalEntityId: null,
  organization: {id:71, name:"Fictional", legalName:"Fictional"}, profile:null,
  report: {reportType:"13th_month_pay",taxYear:2026,dueDate:"2027-01-15",
    establishmentName:"Fictional",establishmentAddress:"",principalBusiness:"",
    totalEmployment:0,workersBenefited:0,totalBenefitsGranted:0,contactName:"",
    contactPosition:"",contactPhone:"",employees:[]},
  reportHash:"a".repeat(64),profileComplete:false,readyToSubmit:false,
  reviewRows:[],incompleteBasicRows:[],sourceNote:"Fictional worksheet",
  submissionCurrent:false,currentSubmission:null,latestSubmission:null,submissionHistory:[],
  officialSource:{label:"DOLE Online Compliance Portal",url:"https://reports.dole.gov.ph/",deadline:"2027-01-15"},
};
test("both DOLE UI paths require OK, employer/year identity and complete verified history", () => {
  assert.equal(parseDoleThirteenthRead(true, empty, 71, 2026), empty);
  assert.equal(parseDoleThirteenthRead(false, empty, 71, 2026), null);
  assert.equal(parseDoleThirteenthRead(true, empty, 71, 2025), null);
  for (const value of [null, {}, [], {...empty, organizationId:72}, {...empty, submissionHistory:undefined},
    {...empty, submissionHistory:[{}]}, {...empty, report:{...empty.report, totalBenefitsGranted:undefined}},
    {...empty, report:{...empty.report, totalBenefitsGranted:1}}, {...empty, readyToSubmit:true},
  ]) assert.equal(parseDoleThirteenthRead(true, value, 71, 2026), null);
});

test("DOLE attribution refusal retains the governed notice without accepting evidence or arbitrary error text", () => {
  const denied = {code:"DOLE_ENTITY_SOURCE_ATTRIBUTION_REQUIRED",error:"UNTRUSTED PRIVATE TEXT"};
  assert.equal(parseDoleThirteenthRead(false, denied, 71, 2026), null);
  assert.match(doleThirteenthReadFailure(503, denied), /until historical payroll/);
  assert.doesNotMatch(doleThirteenthReadFailure(503, denied), /PRIVATE/);
  assert.doesNotMatch(doleThirteenthReadFailure(200, denied), /until historical payroll/);
  assert.doesNotMatch(doleThirteenthReadFailure(503, {error:denied.error}), /PRIVATE/);
});
