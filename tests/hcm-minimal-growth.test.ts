import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
 anonymousSurveyResponderHash, aggregateClosedPulse, revealSealedPulseAggregate,
 canIndependentlyReviewGoal, MINIMUM_ANONYMOUS_GROUP_SIZE,
} from "../src/lib/hcm-simple-growth";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
test("anonymous results stay hidden at four, before close and when empty",()=>{
 assert.equal(MINIMUM_ANONYMOUS_GROUP_SIZE,5);
 assert.deepEqual(aggregateClosedPulse({status:"closed",scores:[5,5,4,4]}),{visible:false});
 assert.deepEqual(aggregateClosedPulse({status:"open",scores:[5,5,4,4,3]}),{visible:false});
 assert.deepEqual(aggregateClosedPulse({status:"closed",scores:[]}),{visible:false});
});
test("five response survey becomes one sealed aggregate",()=>{
 assert.deepEqual(aggregateClosedPulse({status:"closed",scores:[1,2,3,4,5]}),{
  visible:true,count:5,average:3,distribution:[1,1,1,1,1],
 });
});
test("per-survey pseudonyms isolate tenants, users and survey IDs",()=>{
 const secret="k".repeat(64),arg={organizationId:1,surveyId:2,userId:3,secret};
 const hash=anonymousSurveyResponderHash(arg);
 assert.equal(hash,anonymousSurveyResponderHash(arg));
 assert.notEqual(hash,anonymousSurveyResponderHash({...arg,organizationId:4}));
 assert.notEqual(hash,anonymousSurveyResponderHash({...arg,userId:4}));
 assert.notEqual(hash,anonymousSurveyResponderHash({...arg,surveyId:4}));
 assert.match(hash,/^[a-f0-9]{64}$/);
});
test("goal writer cannot be reviewer even with same organization admin role",()=>{
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:5,subjectEmployeeId:31,alreadyReviewed:false}),false);
 // Reviewer user ID 9 belongs to employee 31; unequal ID namespaces must not bypass self-review.
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,subjectEmployeeId:31,reviewerEmployeeId:31,alreadyReviewed:false}),false);
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,subjectEmployeeId:31,reviewerEmployeeId:72,alreadyReviewed:false}),true);
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,subjectEmployeeId:31,alreadyReviewed:false}),true);
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,subjectEmployeeId:31,alreadyReviewed:true}),false);
});
test("both modules are off without exact-true flags",()=>{
 assert.equal(criticalReleaseFlagEnabled("hcmEngagementSurvey",{}),false);
 assert.equal(criticalReleaseFlagEnabled("hcmSimpleGoals",{}),false);
 assert.equal(criticalReleaseFlagEnabled("hcmEngagementSurvey",{HCM_ENGAGEMENT_SURVEY_ENABLED:"true"}),true);
 assert.equal(criticalReleaseFlagEnabled("hcmSimpleGoals",{HCM_SIMPLE_GOALS_ENABLED:"true"}),true);
});


test("only valid sealed 5-person pulse cohorts are visible", () => {
 const good={status:"closed" as const,count:5,average:"3.00",distribution:[1,1,1,1,1]};
 assert.deepEqual(revealSealedPulseAggregate(good),{
  visible:true,count:5,average:3,distribution:[1,1,1,1,1],
 });
 assert.deepEqual(revealSealedPulseAggregate({...good,status:"open"}),{visible:false});
 assert.deepEqual(revealSealedPulseAggregate({...good,count:4}),{visible:false});
 assert.deepEqual(revealSealedPulseAggregate({...good,average:"4.00"}),{visible:false});
 assert.deepEqual(revealSealedPulseAggregate({...good,distribution:[5,0,0,0,0]}),{visible:false});
 assert.deepEqual(revealSealedPulseAggregate({...good,distribution:[1,1,1,1]}),{visible:false});
});

test("survey close purges raw response rows in same transaction as summary and audit",()=>{
 const route=readFileSync("src/app/api/engagement/pulse/route.ts","utf8");
 const get=route.slice(route.indexOf("export async function GET"),route.indexOf("export async function POST"));
 assert.ok(!get.includes(".from(hcmPulseSurveyResponses)"),
  "after closure, GET must never read individual scored responses");
 assert.match(route,/await tx\.delete\(hcmPulseSurveyResponses\)/);
 assert.match(route,/await tx\.insert\(auditEvents\)/);
 assert.match(route,/aggregateCount:aggregate\.visible/);
 assert.match(route,/revealSealedPulseAggregate/);
});
