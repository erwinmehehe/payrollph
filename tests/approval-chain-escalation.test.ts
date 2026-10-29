import assert from "node:assert/strict";
import test from "node:test";
import { payrollMakerCheckerDecision,shouldEscalateApprovalStep } from "../src/lib/approval-human-separation";
import { resolveApproversFromRows } from "../src/lib/delegation";
import { validateApprovalChainSteps, approvalEscalationSnapshotHeld } from "../src/lib/approval-chains";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { eligibleEscalationRecipient } from "../src/lib/approval-escalation-notifications";

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
test("a named payroll checker requires an exact, valid assigned-user identity",()=>{
 for(const declaredApproverUserId of [undefined,null,0,-1,NaN,Infinity,1.5]){
   assert.deepEqual(payrollMakerCheckerDecision({
     makerUserId:4,checkerUserId:9,declaredApproverUserId,namedApproverUsed:true,
   }),{ok:false,code:"missing_assignee"});
 }
 assert.deepEqual(payrollMakerCheckerDecision({
   makerUserId:4,checkerUserId:9,declaredApproverUserId:8,namedApproverUsed:true,
 }),{ok:false,code:"different_assignee"});
 assert.deepEqual(payrollMakerCheckerDecision({
   makerUserId:4,checkerUserId:9,declaredApproverUserId:9,namedApproverUsed:true,
 }),{ok:true});
 // A delegate still needs separate live routing authorization; this helper
 // only checks two-human separation, not the delegation/tenant membership.
 assert.deepEqual(payrollMakerCheckerDecision({
   makerUserId:4,checkerUserId:9,namedApproverUsed:false,
 }),{ok:true});
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
 assert.equal(approvalEscalationSnapshotHeld(candidate, false), true,
   "A disabled flag must hold an extension already in flight");
 assert.equal(approvalEscalationSnapshotHeld(candidate, true), false);
 assert.equal(approvalEscalationSnapshotHeld([base], false), false);
});
test("disabled extension holds corrupted frozen evidence instead of treating it as legacy", () => {
 const base={label:"Review",approver:"role:hr",minimumAmount:0};
 for (const snapshot of [
   [], null, {}, [{...base,escalationAfterDays:"unknown"}],
   [{...base,escalationAfterDays:31}], [{...base,minimumAmount:-1}],
 ]) {
   assert.equal(approvalEscalationSnapshotHeld(snapshot, false), true,
     "An invalid persisted approval snapshot must not silently bypass rollback");
 }
 assert.equal(approvalEscalationSnapshotHeld([base], false), false,
   "Valid legacy approvals remain decidable when extensions are OFF");
 assert.equal(approvalEscalationSnapshotHeld([base], true), false);
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


test("advisory destination accepts only active tenant-scoped staff identifiers and role tokens", () => {
 const base = {id: 14, email: "synthetic@example.test", name: "Synthetic owner",
   role: "owner", orgUnitId: null};
 assert.equal(eligibleEscalationRecipient(base, "role:owner"), true);
 assert.equal(eligibleEscalationRecipient(base, "role:hr"), true);
 assert.equal(eligibleEscalationRecipient(base, "user:14"), true);
 assert.equal(eligibleEscalationRecipient(base, "user:15"), false);
 assert.equal(eligibleEscalationRecipient({ ...base, orgUnitId: 9 }, "role:owner"), false);
 assert.equal(eligibleEscalationRecipient({ ...base, role: "employee" }, "user:14"), false);
 assert.equal(eligibleEscalationRecipient({ ...base, email: " " }, "user:14"), false);
});
test("advisory destination validation cannot create a delegated checker or bypass disabled policy", () => {
 const base = {label:"Independent approval",approver:"role:finance",minimumAmount:0};
 for (const destination of ["user:0", "user:-1", "role:all", "someone@example.test", "user:1;DELETE", "role:employee"]) {
   assert.equal(validateApprovalChainSteps([{...base,escalationAfterDays:2,escalationRecipient:destination}],true),null);
 }
 assert.equal(validateApprovalChainSteps([{...base,escalationRecipient:"role:hr"}],true),null,
   "A recipient without an escalation window is not a valid approval policy");
 const steps=validateApprovalChainSteps([{...base,escalationAfterDays:2,escalationRecipient:"role:owner"}],true);
 assert.equal(steps?.[0].approver,"role:finance",
   "Advisory delivery must not alter the original checker");
 assert.equal(steps?.[0].escalationRecipient,"role:owner");
 assert.equal(validateApprovalChainSteps([{...base,escalationAfterDays:2,escalationRecipient:"role:owner"}],false),null);
 assert.equal(approvalEscalationSnapshotHeld([{...base,escalationAfterDays:2,escalationRecipient:"role:owner"}],false),true);
});
