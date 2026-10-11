import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStaffingPolicyDraft, parseStaffingPolicyTransition,
  policyDatesOverlap, resolveApprovedStaffingPolicy, staffingPolicyPilotAllowed,
  type ApprovedStaffingPolicy,
} from "../src/lib/workforce-demand-staffing-policy";
const proposal = {
  organizationId: 101, worksiteId: 201, jobProfileId: 301,
  metricKind: "transactions" as const, intervalMinutes: 30 as const,
  effectiveFrom: "2099-01-01", effectiveUntil: "2099-01-07",
  productiveUnitsPerWorkerHour: 12.5, serviceTargetCoveragePercent: 90,
  rationale: "Fictional productivity assumption for synthetic QA only",
  idempotencyKey: "synthetic-key-0001",
};
const policy:ApprovedStaffingPolicy = {
  ...proposal,id:1001,version:1,status:"approved",
  contentSha256:"a".repeat(64),approvalReceiptSha256:"b".repeat(64),
  approvedAt:"2098-12-31T00:00:00.000Z",approvalIntegrity:"matches_hash",
};
test("exact, bounded versioned policy accepts precise employer and role scope",()=>{
  assert.equal(parseStaffingPolicyDraft(proposal).productiveUnitsPerWorkerHour,12.5);
  assert.equal(parseStaffingPolicyTransition({
    organizationId:101,policyId:1001,action:"approve",
    decisionNote:"Independently verified fictional service policy",
    acknowledged:true,
  }).action,"approve");
});
test("rejects extra fields, invalid calendars, missing provenance and unrealistic precision",()=>{
  assert.throws(()=>parseStaffingPolicyDraft({...proposal,employeeId:5}),/Exact/);
  assert.throws(()=>parseStaffingPolicyDraft({...proposal,effectiveFrom:"2099-02-30"}),/Exact/);
  assert.throws(()=>parseStaffingPolicyDraft({...proposal,productiveUnitsPerWorkerHour:0}),/Exact/);
  assert.throws(()=>parseStaffingPolicyDraft({...proposal,serviceTargetCoveragePercent:100.001}),/Exact/);
  assert.throws(()=>parseStaffingPolicyDraft({...proposal,effectiveUntil:"2105-01-01"}),/Exact/);
  assert.throws(()=>parseStaffingPolicyTransition({
    organizationId:101,policyId:1001,action:"approve",
    decisionNote:"short",acknowledged:true,
  }),/valid/);
  assert.throws(()=>parseStaffingPolicyTransition({
    organizationId:101,policyId:1001,action:"approve",
    decisionNote:"Reviewed and approved",acknowledged:true,
    actorUserId:1002,
  }),/valid/);
});
test("scope must match exact worksite role and metric; neither default nor cross tenant",()=>{
  const args = {policies:[policy],organizationId:101,worksiteId:201,
    jobProfileId:301,metricKind:"transactions" as const,
    intervalMinutes:30 as const,from:"2099-01-02",until:"2099-01-05"};
  assert.equal(resolveApprovedStaffingPolicy(args).status,"approved");
  assert.equal(resolveApprovedStaffingPolicy({...args,worksiteId:202}).status,"no_approved_policy");
  assert.equal(resolveApprovedStaffingPolicy({...args,jobProfileId:null}).status,"no_approved_policy");
  assert.equal(resolveApprovedStaffingPolicy({...args,organizationId:102}).status,"no_approved_policy");
  assert.equal(resolveApprovedStaffingPolicy({...args,metricKind:"visits"}).status,"no_approved_policy");
  assert.equal(resolveApprovedStaffingPolicy({...args,from:"2098-12-31"}).status,"source_review");
  assert.equal(resolveApprovedStaffingPolicy({...args,policies:[{...policy,approvalIntegrity:"source_review"}]}).status,"source_review");
  assert.equal(resolveApprovedStaffingPolicy({...args,policies:[policy,{...policy,id:1002}]}).status,"source_review");
});
test("effective-date overlap is inclusive; touching boundaries are conflicts",()=>{
  assert.equal(policyDatesOverlap(proposal,{...proposal,effectiveFrom:"2099-01-07",effectiveUntil:"2099-02-01"}),true);
  assert.equal(policyDatesOverlap(proposal,{...proposal,effectiveFrom:"2099-01-08",effectiveUntil:"2099-02-01"}),false);
});
test("policy pilot must be explicitly enabled and exact-employer allowlisted",()=>{
  assert.equal(staffingPolicyPilotAllowed(101,true,"true","101"),true);
  assert.equal(staffingPolicyPilotAllowed(101,false,"true","101"),false);
  assert.equal(staffingPolicyPilotAllowed(101,true,"false","101"),false);
  assert.equal(staffingPolicyPilotAllowed(101,true,"true","102"),false);
  assert.equal(staffingPolicyPilotAllowed(101,true,"true","101,101"),false);
  assert.equal(staffingPolicyPilotAllowed(101,true,"true","101,garbage"),false);
});
