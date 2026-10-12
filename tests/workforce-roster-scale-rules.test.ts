import assert from "node:assert/strict";
import test from "node:test";
import { scanActiveRosterAssignments, rosterWindowDates } from "../src/lib/workforce-roster-scale";
import {
  PH_ROSTER_RULE_DEFAULTS, decideRosterRulePublish, evaluateWfmRosterRules,
} from "../src/lib/workforce-roster-rules";
import { rosterRuleOverrideAuditMetadata } from "../src/lib/audit-chain";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";
const day=(date:string,start:string,end:string,breakMinutes=0):ResolvedDailySchedule=>({
  date,source:"pattern",isRestDay:false,assignmentId:1,patternId:1,patternDayIndex:0,overrideId:null,
  workLocationOrgUnitId:null,worksiteId:11,audit:[],
  segments:[{shiftDefinitionId:1,shiftCode:"SHIFT",shiftName:"Shift",segmentOrder:1,
    startTime:start,endTime:end,breakMinutes,spansMidnight:end<=start}],
});
test("WFM-12: every one of 1000 assignments is read once in bounded pages before a complete scan",async()=>{
  const assignments=Array.from({length:1000},(_,i)=>({
    id:i+1,organizationId:i<500?101:202,employeeId:i<500?i+1:i-499,
  }));
  const sizes:number[]=[];
  const result=await scanActiveRosterAssignments({
    fetchPage:async(afterId,limit)=>{
      sizes.push(limit);
      return assignments.filter(item=>item.id>afterId).slice(0,limit);
    },
  });
  assert.equal(result.complete,true);
  if(!result.complete)return;
  assert.equal(result.assignmentsScanned,1000);
  assert.equal(result.workers.length,1000);
  assert.equal(result.pages,6);
  assert.ok(sizes.every(size=>size<=200));
  assert.equal(result.workers.filter(w=>w.organizationId===101).length,500);
  assert.equal(result.workers.filter(w=>w.organizationId===202).length,500);
});
test("cohort cannot be marked complete or emit work when scan cap stops before final page",async()=>{
  const assignments=Array.from({length:1000},(_,i)=>({id:i+1,employeeId:i+1,organizationId:15}));
  const scan=await scanActiveRosterAssignments({maxAssignments:400,
    fetchPage:async(afterId,limit)=>assignments.filter(a=>a.id>afterId).slice(0,limit),
  });
  assert.deepEqual(scan,{complete:false,assignmentsScanned:400,pages:3,reason:"limit-reached"});
  let call=0;
  await assert.rejects(scanActiveRosterAssignments({fetchPage:async()=>{
    if(++call===2)throw Error("database disconnected");
    return assignments.slice(0,200);
  }}),/database disconnected|unordered/);
});
test("duplicates across 200-row boundaries are deduped by tenant plus employee",async()=>{
  const assignments=Array.from({length:1000},(_,i)=>({id:i+1,organizationId:i<500?1:2,employeeId:(i%250)+1}));
  const r=await scanActiveRosterAssignments({fetchPage:async(after,limit)=>assignments.filter(x=>x.id>after).slice(0,limit)});
  assert.equal(r.complete,true);
  if(r.complete)assert.equal(r.workers.length,500);
});
test("explicit roster windows reject invalid dates and overlong requests",()=>{
  assert.deepEqual(rosterWindowDates("2026-10-30","2026-11-02"),["2026-10-30","2026-10-31","2026-11-01","2026-11-02"]);
  assert.throws(()=>rosterWindowDates("2026-02-30","2026-03-01"),/Invalid/);
  assert.throws(()=>rosterWindowDates("2026-10-01","2026-10-15"),/1-14/);
  assert.throws(()=>rosterWindowDates("2026-10-03","2026-10-01"),/1-14/);
});
test("13-hour duty followed by 5-hour rest gives exactly two findings",()=>{
  const findings=evaluateWfmRosterRules({days:[
    day("2026-10-13","08:00","21:00"),
    day("2026-10-14","02:00","10:00"),
  ],policy:PH_ROSTER_RULE_DEFAULTS,targetDates:["2026-10-13","2026-10-14"]});
  assert.equal(findings.length,2);
  assert.deepEqual(findings.map(f=>f.code),["MAX_DAILY_HOURS","MIN_REST_BETWEEN_SHIFTS"]);
  assert.deepEqual(findings.map(f=>f.severity),["blocking","blocking"]);
  assert.equal(findings[0].actualMinutes,780);
  assert.equal(findings[1].actualMinutes,300);
});
test("overlaps remain unwaivable, including nested segments",()=>{
  const a=day("2026-10-13","07:00","15:00");
  a.segments.push({...a.segments[0],segmentOrder:2,shiftDefinitionId:2,startTime:"08:00",endTime:"09:00"});
  a.segments.push({...a.segments[0],segmentOrder:3,shiftDefinitionId:3,startTime:"10:00",endTime:"11:00"});
  const findings=evaluateWfmRosterRules({days:[a],policy:PH_ROSTER_RULE_DEFAULTS});
  assert.equal(findings.filter(f=>f.code==="OVERLAPPING_SHIFTS").length,2);
  assert.equal(decideRosterRulePublish({findings,overrideReason:"urgent operator coverage",managerMayOverride:true}).blocked,true);
});
test("weekly limit and approved overtime cap require independent review",()=>{
  const days=Array.from({length:7},(_,i)=>day(`2026-10-${String(i+12).padStart(2,"0")}`,"08:00","17:00"));
  const weekly=evaluateWfmRosterRules({days,policy:PH_ROSTER_RULE_DEFAULTS,targetDates:["2026-10-18"]});
  assert.ok(weekly.some(f=>f.code==="MAX_WEEKLY_HOURS"&&f.severity==="blocking"));
  const ot=evaluateWfmRosterRules({
    days:[day("2026-10-13","08:00","20:00")],policy:PH_ROSTER_RULE_DEFAULTS,
    approvedOvertimeMinutesByDate:{"2026-10-13":120},
  });
  assert.equal(ot.some(f=>f.code==="OVERTIME_APPROVED_CAP"&&f.severity==="blocking"),true);
  assert.equal(decideRosterRulePublish({findings:ot,overrideReason:"Manager exception required",managerMayOverride:true}).blocked,true);
});
test("employee's designated rest day and tenant holiday show premium implications, not computed wages",()=>{
  const findings=evaluateWfmRosterRules({
    days:[day("2026-10-18","08:00","16:00")],policy:PH_ROSTER_RULE_DEFAULTS,designatedRestDay:"Sunday",
    holidays:[{date:"2026-10-18",name:"Synthetic Regular Holiday",kind:"regular",orgUnitId:7,worksiteId:11}],
    employeeOrgUnitId:7,
  });
  assert.deepEqual(findings.map(f=>f.code),["HOLIDAY_PREMIUM","REST_DAY_PREMIUM"]);
  assert.ok(findings.every(f=>f.severity==="warning"&&!f.overrideEligible));
});
test("a new shift on a scheduled rotation rest day shows premium review without pay calculation",()=>{
  const findings=evaluateWfmRosterRules({
    days:[day("2026-10-17","08:00","16:00")],
    policy:PH_ROSTER_RULE_DEFAULTS,baselineRestDates:["2026-10-17"],
  });
  assert.deepEqual(findings.map(f=>f.code),["REST_DAY_PREMIUM"]);
  assert.equal(findings[0].overrideEligible,false);
});
test("manager override needs a reason and records only waivable policy breaches in hash-chain metadata",()=>{
  const findings=evaluateWfmRosterRules({days:[
    day("2026-10-13","08:00","21:00"),day("2026-10-14","02:00","10:00")],
    policy:PH_ROSTER_RULE_DEFAULTS});
  assert.equal(decideRosterRulePublish({findings,managerMayOverride:true}).blocked,true);
  assert.equal(decideRosterRulePublish({findings,overrideReason:"need staffing",managerMayOverride:true}).blocked,true);
  assert.equal(decideRosterRulePublish({findings,overrideReason:"Coverage is documented for urgent work",managerMayOverride:false}).blocked,true);
  const result=decideRosterRulePublish({findings,overrideReason:"Coverage is documented for urgent work",managerMayOverride:true});
  assert.equal(result.blocked,false);
  assert.deepEqual(result.overriddenCodes,["MAX_DAILY_HOURS","MIN_REST_BETWEEN_SHIFTS"]);
  const audit=rosterRuleOverrideAuditMetadata({
    managerUserId:17,reason:result.reason!,overriddenCodes:result.overriddenCodes,
  });
  assert.equal(audit.managerUserId,17);
  assert.equal(audit.requiresHashChainSeal,true);
  assert.equal(audit.payrollOverrides,false);
  assert.throws(()=>rosterRuleOverrideAuditMetadata({managerUserId:17,reason:"urgent staffing change",overriddenCodes:["OVERLAPPING_SHIFTS"]}));
});
