import assert from "node:assert/strict";
import test from "node:test";
import {
 anonymousSurveyResponderHash, aggregateClosedPulse,
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
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:5,alreadyReviewed:false}),false);
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,employeeUserId:9,alreadyReviewed:false}),false);
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,alreadyReviewed:false}),true);
 assert.equal(canIndependentlyReviewGoal({makerUserId:5,reviewerUserId:9,alreadyReviewed:true}),false);
});
test("both modules are off without exact-true flags",()=>{
 assert.equal(criticalReleaseFlagEnabled("hcmEngagementSurvey",{}),false);
 assert.equal(criticalReleaseFlagEnabled("hcmSimpleGoals",{}),false);
 assert.equal(criticalReleaseFlagEnabled("hcmEngagementSurvey",{HCM_ENGAGEMENT_SURVEY_ENABLED:"true"}),true);
 assert.equal(criticalReleaseFlagEnabled("hcmSimpleGoals",{HCM_SIMPLE_GOALS_ENABLED:"true"}),true);
});
