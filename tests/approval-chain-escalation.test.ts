import assert from "node:assert/strict";
import test from "node:test";
import { payrollMakerCheckerDecision,shouldEscalateApprovalStep } from "../src/lib/approval-human-separation";
import { resolveApproversFromRows } from "../src/lib/delegation";
import { validateApprovalChainSteps } from "../src/lib/approval-chains";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("maker may not approve as their own delegate: identity beats named routing",()=>{
 const delegates=resolveApproversFromRows("Payroll checker",[
   {fromApprover:"Payroll checker",toApprover:"Maker",reason:"Temporary delegation"},
 ]);
 assert.equal(delegates.allowed.includes("Maker"),false); // lower-cased normalized identities
 assert.equal(delegates.allowed.includes("maker"),true);
 const result=payrollMakerCheckerDecision({
   makerUserId:9,checkerUserId:9,
   declaredApproverUserId:11,namedApproverUsed:false,
 });
 assert.deepEqual(result,{ok:false,code:"same_human"});
});
test("missing maker audit metadata fail-closed only under new gate",()=>{
 assert.deepEqual(payrollMakerCheckerDecision({makerUserId:null,checkerUserId:9}),
   {ok:false,code:"missing_maker"});
 assert.deepEqual(payrollMakerCheckerDecision({makerUserId:4,checkerUserId:9,
   declaredApproverUserId:9,namedApproverUsed:true}),{ok:true});
});
test("maker identity must be authentic numeric audit evidence, not coercible input",()=>{
 for(const makerUserId of [true, false, "1", "9", "", [], {}, NaN, Infinity, -1, 0]) {
   assert.deepEqual(
     payrollMakerCheckerDecision({makerUserId, checkerUserId:11}),
     {ok:false, code:"missing_maker"},
   );
 }
 assert.deepEqual(payrollMakerCheckerDecision({makerUserId:9,checkerUserId:11}),
   {ok:true});
 assert.deepEqual(payrollMakerCheckerDecision({makerUserId:9,checkerUserId:9}),
   {ok:false,code:"same_human"});
});

test("escalation-after-days policy validates finite 1-30 day window",()=>{
 const base={label:"Review",approver:"role:hr",minimumAmount:0};
 assert.equal(validateApprovalChainSteps([{...base,escalationAfterDays:0}]),null);
 assert.equal(validateApprovalChainSteps([{...base,escalationAfterDays:31}]),null);
 const candidate = [{...base, escalationAfterDays:3}];
 assert.equal(validateApprovalChainSteps(candidate, false), null,
   "A default-OFF escalation capability cannot accept new extension policies");
 assert.equal(validateApprovalChainSteps(candidate, true)?.[0].escalationAfterDays, 3);
 assert.deepEqual(validateApprovalChainSteps([base], false)?.[0].approver, "role:hr");
});
test("overdue pending action is escalated once without deciding it",()=>{
 const createdAt=new Date("2026-10-01T00:00:00Z");
 const rule={createdAt,days:3,taskStatus:"Pending",stepStatus:"pending",priority:"Normal"};
 assert.equal(shouldEscalateApprovalStep({...rule,now:new Date("2026-10-02T00:00:00Z")}),false);
 assert.equal(shouldEscalateApprovalStep({...rule,now:new Date("2026-10-04T00:00:00Z")}),true);
 assert.equal(shouldEscalateApprovalStep({...rule,now:new Date("2026-10-04T00:00:00Z"),priority:"High"}),false);
 assert.equal(shouldEscalateApprovalStep({...rule,now:new Date("2026-10-04T00:00:00Z"),stepStatus:"approved"}),false);
});
test("approval escalation is disabled by default",()=>{
 assert.equal(criticalReleaseFlagEnabled("approvalChainEscalations",{}),false);
 assert.equal(criticalReleaseFlagEnabled("approvalChainEscalations",{APPROVAL_CHAIN_ESCALATIONS_ENABLED:"true"}),true);
});
