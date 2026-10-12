import assert from "node:assert/strict";
import test from "node:test";
import {
  planGreedyRoster,
  type GreedyRosterInput,
  type GreedySlot,
  type GreedyWorker,
  type GreedyRosterReason,
} from "../src/lib/workforce-greedy-roster";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";

const employer=20;
const date="2026-11-02";
const dateAfter=(start:string,diff:number)=>
  new Date(Date.parse(start+"T00:00:00Z")+diff*86_400_000).toISOString().slice(0,10);
const schedule=(day:string,segments:ResolvedDailySchedule["segments"]=[]):ResolvedDailySchedule=>({
  date:day,source:"pattern",isRestDay:segments.length===0,assignmentId:2,patternId:1,
  patternDayIndex:0,overrideId:null,workLocationOrgUnitId:1,worksiteId:1,
  segments,audit:[],
});
const segment=(startTime:string,endTime:string,breakMinutes=0)=>({
  shiftDefinitionId:4,shiftCode:"FIXED",shiftName:"Committed shift",
  segmentOrder:1,startTime,endTime,breakMinutes,spansMidnight:endTime<=startTime,
});
const slot=(id:number,day=date,overrides:Partial<GreedySlot>={}):GreedySlot=>({
  requirementId:id,organizationId:employer,worksiteId:1,workDate:day,
  shiftDefinitionId:id+10,jobProfileId:3,requiredHeadcount:1,
  startTime:"08:00",endTime:"16:00",spansMidnight:false,breakMinutes:0,
  unpopular:false,preAssignedEmployeeIds:[],...overrides,
});
const worker=(id:number,slots:GreedySlot[],overrides:Partial<GreedyWorker>={}):GreedyWorker=>({
  employeeId:id,organizationId:employer,employeeName:"Worker "+id,
  active:true,restWeekday:null,
  existingDays:Array.from({length:30},(_,i)=>schedule(dateAfter(date,i-8))),
  evidenceByRequirement:Object.fromEntries(slots.map(s=>[s.requirementId,{
    skill:"qualified" as const,site:"eligible" as const,
    availability:"available" as const,leave:"clear" as const,
  }])),
  approvedOvertimeByDate:{},fairnessPriorMinutes:0,fairnessPriorUnpopularShifts:0,
  ...overrides,
});
const rules:GreedyRosterInput["rules"]={
  schedule:{minimumRestMinutes:660,maxConsecutiveWorkingDays:6,
    rollingSevenDayMinutes:2880,enforcementMode:"block",active:true},
  maxDailyPaidMinutes:720,maxRollingSevenDayPaidMinutes:2880,
  ordinaryDailyMinutes:480,unpopularRotationWeightMinutes:240,
};
const plan=(slots:GreedySlot[],workers:GreedyWorker[],override?:Partial<GreedyRosterInput["rules"]>)=>
  planGreedyRoster({organizationId:employer,slots,workers,rules:{...rules,...override}});
const singleReason=(s:GreedySlot,workers:GreedyWorker[]):GreedyRosterReason=>{
  const result=plan([s],workers);
  assert.equal(result.unfilled.length,1);
  return result.unfilled[0].reason;
};

test("equal hours are preferred before name/id and distribute four shifts 2/2",()=>{
  const slots=[slot(1,dateAfter(date,0)),slot(2,dateAfter(date,1)),
    slot(3,dateAfter(date,2)),slot(4,dateAfter(date,3))];
  const result=plan(slots,[worker(2,slots),worker(1,slots)]);
  assert.deepEqual(result.roster.map(row=>row.employeeId),[1,2,1,2]);
  assert.deepEqual(result.summary.fairnessProjectedMinutes.map(row=>row.scheduledMinutes),[960,960]);
  assert.equal(result.unfilled.length,0);
  assert.equal(result.summary.suggested,4);
  assert.equal(result.automaticallyPublished,false);
  assert.equal(result.status,"review_required");
});

test("existing workload changes who is selected for the first shift",()=>{
  const s=slot(1);
  const result=plan([s],[worker(1,[s],{fairnessPriorMinutes:960}),worker(2,[s])]);
  assert.equal(result.roster[0].employeeId,2);
});

test("rotate unpopular shifts using per-worker history, not random seed",()=>{
  const shifts=[slot(2,dateAfter(date,0),{unpopular:true}),
    slot(3,dateAfter(date,1),{unpopular:true})];
  const result=plan(shifts,[
    worker(1,shifts,{fairnessPriorUnpopularShifts:1}),
    worker(2,shifts,{fairnessPriorUnpopularShifts:0}),
  ]);
  assert.deepEqual(result.roster.map(row=>row.employeeId),[2,1]);
  assert.equal(result.summary.fairnessProjectedMinutes.find(w=>w.employeeId===1)?.unpopularShifts,2);
  assert.equal(result.summary.fairnessProjectedMinutes.find(w=>w.employeeId===2)?.unpopularShifts,1);
});

test("harder qualified shift goes before generic available shift to preserve scarce skill",()=>{
  const easy=slot(1,date,{unpopular:false,startTime:"08:00",endTime:"16:00"});
  const hard=slot(2,date,{unpopular:true,startTime:"08:00",endTime:"16:00"});
  const versatile=worker(1,[easy,hard]);
  const onlyEasy=worker(2,[easy,hard]);
  onlyEasy.evidenceByRequirement[hard.requirementId].skill="unqualified";
  const result=plan([easy,hard],[versatile,onlyEasy]);
  assert.deepEqual(result.roster.map(row=>[row.requirementId,row.employeeId]),[[1,2],[2,1]]);
  assert.equal(result.unfilled.length,0);
});

test("seeded unverified skills, approved leave, unavailable time, and site denial produce categorized gaps",()=>{
  const s=slot(10);
  const skill=worker(1,[s]);skill.evidenceByRequirement[10].skill="unqualified";
  const leave=worker(2,[s]);leave.evidenceByRequirement[10].leave="blocked";
  const unavailable=worker(3,[s]);unavailable.evidenceByRequirement[10].availability="unavailable";
  const site=worker(4,[s]);site.evidenceByRequirement[10].site="ineligible";
  const result=plan([s],[skill,leave,unavailable,site]);
  assert.equal(result.roster.length,0);
  assert.equal(result.unfilled.length,1);
  assert.deepEqual(new Set(result.unfilled[0].evidence.map(x=>x.code)),
    new Set(["skill_missing","approved_leave","unavailable","site_ineligible"]));
  assert.equal(result.unfilled[0].evidence.reduce((sum,row)=>sum+row.candidates,0),4);
});

test("missing evidence never becomes an assumed eligible employee",()=>{
  const s=slot(1);
  assert.equal(singleReason(s,[worker(1,[s],{evidenceByRequirement:{}})]),"source_unknown");
});

test("existing verified workers count toward demand and are not duplicated as suggestions",()=>{
  const s=slot(1,date,{requiredHeadcount:2,preAssignedEmployeeIds:[2]});
  const result=plan([s],[worker(1,[s]),worker(2,[s])]);
  assert.deepEqual(result.roster.map(r=>[r.source,r.employeeId]),[["existing",2],["suggested",1]]);
  assert.equal(result.summary.required,2);
  assert.equal(result.summary.existing,1);
  assert.equal(result.summary.suggested,1);
});

test("fixed shifts reject overlap and five-hour recovery gaps, including overnight boundaries",()=>{
  const s=slot(1,dateAfter(date,1),{startTime:"02:00",endTime:"10:00"});
  const fixed=worker(1,[s],{existingDays:[
    schedule(dateAfter(date,0),[segment("08:00","21:00",0)]),
    schedule(dateAfter(date,1)),schedule(dateAfter(date,2)),
  ]});
  assert.equal(singleReason(s,[fixed]),"minimum_rest");

  const overlapSlot=slot(2,date,{startTime:"10:00",endTime:"18:00"});
  const overlapping=worker(2,[overlapSlot],{existingDays:[
    schedule(date,[segment("09:00","17:00")]),schedule(dateAfter(date,1)),
  ]});
  assert.equal(singleReason(overlapSlot,[overlapping]),"overlapping_shift");
  const overnightSlot=slot(3,dateAfter(date,1),{startTime:"01:00",endTime:"09:00"});
  const overnight=worker(3,[overnightSlot],{existingDays:[
    schedule(date,[segment("22:00","06:00")]),schedule(dateAfter(date,1)),schedule(dateAfter(date,2)),
  ]});
  assert.equal(singleReason(overnightSlot,[overnight]),"overlapping_shift");
});

test("max daily hours and approved OT cap are independent blockers",()=>{
  const s=slot(1,date,{startTime:"08:00",endTime:"21:00",breakMinutes:0});
  const w=worker(1,[s],{approvedOvertimeByDate:{[date]:480}});
  assert.equal(singleReason(s,[w]),"daily_hours_cap");

  const overtime=slot(2,date,{startTime:"08:00",endTime:"18:00",breakMinutes:0});
  assert.equal(singleReason(overtime,[worker(2,[overtime])]),"overtime_approval");
  const approved=worker(2,[overtime],{approvedOvertimeByDate:{[date]:120}});
  const allowed=plan([overtime],[approved]);
  assert.equal(allowed.roster.length,1);
});

test("rolling seven-day threshold blocks a seventh full eight-hour shift",()=>{
  const s=slot(2,dateAfter(date,6));
  const existing=Array.from({length:7},(_,i)=>schedule(dateAfter(date,i),
    i<6?[segment("08:00","16:00")]:[]));
  const w=worker(1,[s],{existingDays:existing,approvedOvertimeByDate:{}});
  assert.equal(singleReason(s,[w]),"rolling_week_cap");
});

test("designated rest day is not silently scheduled",()=>{
  const s=slot(1,date);
  const monday=new Date(date+"T00:00:00Z").getUTCDay();
  assert.equal(singleReason(s,[worker(1,[s],{restWeekday:monday})]),"designated_rest_day");
});

test("permutation invariant: identical roster and reasons after reversing inputs",()=>{
  const slots=[slot(1,date),slot(2,dateAfter(date,1),{unpopular:true}),
    slot(3,dateAfter(date,2),{requiredHeadcount:2})];
  const workers=[worker(3,slots),worker(1,slots),worker(2,slots)];
  const a=plan(slots,workers);
  const b=plan([...slots].reverse(),[...workers].reverse().map(w=>({
    ...w,existingDays:[...w.existingDays].reverse(),
  })));
  assert.deepEqual(a,b);
});

test("tenant-mixed and duplicate workers, invalid dates, or oversized scans fail closed",()=>{
  const s=slot(1);
  assert.throws(()=>plan([s],[worker(1,[s],{organizationId:999})]),/cross-tenant|Invalid worker/);
  assert.throws(()=>plan([s],[worker(1,[s]),worker(1,[s])]),/Invalid worker/);
  assert.throws(()=>plan([{...s,workDate:"2026-02-30"}],[worker(1,[s])]),/Invalid PH roster/);
  const thousand=Array.from({length:1001},(_,index)=>worker(index+1,[s]));
  assert.throws(()=>plan([s],thousand),/bounded roster/);
});

test("1,000 authorized workers considered without top-five ranking truncation",()=>{
  const s=slot(1);
  const workers=Array.from({length:1000},(_,i)=>worker(i+1,[s],{
    fairnessPriorMinutes:i===999?0:480,
  }));
  const result=plan([s],workers);
  assert.equal(result.roster.length,1);
  assert.equal(result.roster[0].employeeId,1000);
  assert.equal(result.unfilled.length,0);
  assert.equal(result.summary.fairnessProjectedMinutes.length,1000);
});

test("zero workers returns explicit slot-level no_workers cause, not invented headcount",()=>{
  const s=slot(1,date,{requiredHeadcount:3});
  const result=plan([s],[]);
  assert.equal(result.unfilled.length,3);
  assert.deepEqual(result.unfilled.map(gap=>gap.reason),["no_workers","no_workers","no_workers"]);
  assert.equal(result.automaticallyPublished,false);
});
