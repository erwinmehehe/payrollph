import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRosterPublishRules, DEFAULT_PH_ROSTER_PUBLISH_POLICY,
  canWaiveRosterPublishBlock,
} from "../src/lib/workforce-schedule-guardrails";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

function day(date:string,start:string,end:string):ResolvedDailySchedule {
 return {date,source:"pattern",isRestDay:false,assignmentId:1,patternId:1,
 patternDayIndex:1,overrideId:null,workLocationOrgUnitId:null,worksiteId:4,audit:[],
 segments:[{shiftDefinitionId:1,shiftCode:"WORK",shiftName:"Work",segmentOrder:1,
 startTime:start,endTime:end,breakMinutes:0,spansMidnight:end<=start}]};
}
test("13-hour shift followed by five-hour gap produces exactly daily cap and rest findings",()=>{
 const findings=evaluateRosterPublishRules({
  days:[day("2026-10-01","08:00","21:00"),day("2026-10-02","02:00","10:00")],
  policy:DEFAULT_PH_ROSTER_PUBLISH_POLICY,
 });
 assert.deepEqual(findings.map(x=>x.code),["publish_max_daily","publish_minimum_rest"]);
 assert.equal(findings[0].actualMinutes,780);
 assert.equal(findings[1].actualMinutes,300);
 assert.equal(findings.every(f=>f.blocking),true);
});
test("OT above cap cannot be waived with a reason",()=>{
 const issues=evaluateRosterPublishRules({
  days:[day("2026-10-01","08:00","21:00")],
  policy:{...DEFAULT_PH_ROSTER_PUBLISH_POLICY,approvedOvertimeCapMinutes:120},
 });
 assert.ok(issues.some(i=>i.code==="publish_overtime_cap"&&i.blocking));
 assert.equal(canWaiveRosterPublishBlock({
   issues,reason:"Manager accepts exceptional coverage requirements",companyWide:true,
 }),false);
});
test("company-wide HR can override a policy cap only with explicit long reason",()=>{
 const issues=evaluateRosterPublishRules({
  days:[day("2026-10-01","08:00","21:00")],policy:DEFAULT_PH_ROSTER_PUBLISH_POLICY,
 });
 assert.equal(canWaiveRosterPublishBlock({issues,reason:"Too short",companyWide:true}),false);
 assert.equal(canWaiveRosterPublishBlock({issues,reason:"Coverage necessary for critical opening shift",companyWide:false}),false);
 assert.equal(canWaiveRosterPublishBlock({issues,reason:"Coverage necessary for critical opening shift",companyWide:true}),true);
});
test("holiday premium advisory never creates a deduction or auto-reject",()=>{
 const findings=evaluateRosterPublishRules({days:[day("2026-10-01","09:00","17:00")],
  policy:DEFAULT_PH_ROSTER_PUBLISH_POLICY,
  holidays:[{date:"2026-10-01",worksiteId:4}],
 });
 assert.deepEqual(findings.map(x=>x.code),["publish_holiday_premium"]);
 assert.equal(findings[0].blocking,false);
});
test("rule publish feature flag is exact true only",()=>{
 assert.equal(criticalReleaseFlagEnabled("wfmRosterPublishRules",{}),false);
 assert.equal(criticalReleaseFlagEnabled("wfmRosterPublishRules",{WFM_ROSTER_PUBLISH_RULES_ENABLED:"true"}),true);
});
