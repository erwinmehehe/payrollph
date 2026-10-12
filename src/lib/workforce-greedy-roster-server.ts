import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeAvailabilityRules, employeeScheduleAssignments, employeeWorksiteAssignments,
  employees, holidays, hcmWorksiteAuthorizations,
  leaveRequestIntervalSets, leaveRequestIntervals, leaveRequests,
  overtimeRequests, positionAssignments, positions, scheduleOverrides,
  schedulePatternDays, schedulePatternSegments, schedulePatterns,
  separationRecords, shiftDefinitions, staffingRequirements, workforceScheduleGuardrailPolicies,
  worksites,
} from "@/db/schema";
import { evaluateEmployeeFromCapabilityData, loadCapabilityEligibilityData } from "@/lib/hcm-workforce-eligibility-server";
import { evaluateSiteEligibility } from "@/lib/hcm-worksite-eligibility";
import { loadSiteEligibilityEvidence } from "@/lib/hcm-worksite-eligibility-server";
import { resolveEmployeeJobProfileAtDate, assertUnambiguousRoleDemand } from "@/lib/workforce-role-demand";
import { resolveDailySchedule, type ResolvedDailySchedule, type WorkforceScheduleOverride, type WorkforceScheduleOverrideSegment } from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { approvedLeaveCoverageImpact } from "@/lib/workforce-absence";
import { planGreedyRoster, type GreedyRosterInput, type GreedySlot, type GreedyWorker, type WorkerSlotEvidence } from "@/lib/workforce-greedy-roster";

const MS_PER_DAY=86_400_000;
const minute=(time:string)=>{const parts=time.slice(0,5).split(":").map(Number);return parts[0]*60+parts[1];};
const ordinal=(date:string)=>Date.parse(date+"T00:00:00Z")/MS_PER_DAY;
const dayOffset=(date:string,days:number)=>new Date(Date.parse(date+"T00:00:00Z")+days*MS_PER_DAY).toISOString().slice(0,10);
const isUnpopular=(date:string,start:string,holiday=false)=>{
  const weekday=new Date(date+"T00:00:00Z").getUTCDay();
  return weekday===0||weekday===6||minute(start)<360||minute(start)>=1080||holiday;
};
function absoluteWindow(date:string,start:string,end:string,overnight:boolean) {
  const from=ordinal(date)*1440+minute(start);
  let to=ordinal(date)*1440+minute(end);
  if(overnight||to<=from)to+=1440;
  return {from,to};
}
const overlap=(a:{from:number;to:number},b:{from:number;to:number})=>a.from<b.to&&b.from<a.to;
function timedAvailabilityBlocks(input:{
  workDate:string; startTime:string;endTime:string;spansMidnight:boolean;
  rules:Array<{weekday:number;startTime:string;endTime:string;availabilityType:string;effectiveFrom:string;effectiveUntil:string|null}>;
}) {
  const shift=absoluteWindow(input.workDate,input.startTime,input.endTime,input.spansMidnight);
  for(const offset of [-1,0,1]){
    const date=dayOffset(input.workDate,offset);
    const weekday=new Date(date+"T00:00:00Z").getUTCDay();
    for(const rule of input.rules){
      if(rule.availabilityType!=="unavailable"||rule.weekday!==weekday||
         rule.effectiveFrom>date||(rule.effectiveUntil!==null&&rule.effectiveUntil<date))continue;
      const unavailable=absoluteWindow(date,rule.startTime,rule.endTime,
        minute(rule.endTime)<=minute(rule.startTime));
      if(overlap(shift,unavailable))return true;
    }
  }
  return false;
}
type LeaveRow = typeof leaveRequests.$inferSelect;
type LeaveIntervalRow = typeof leaveRequestIntervals.$inferSelect;
function leaveBlocks(input:{
  slot:GreedySlot;workerId:number;
  leaves:LeaveRow[]; currentSetByLeaveId:ReadonlyMap<number,number>;
  intervalsBySet:ReadonlyMap<number,LeaveIntervalRow[]>;
}):"clear"|"blocked"|"unknown"{
  const shift=absoluteWindow(input.slot.workDate,input.slot.startTime,input.slot.endTime,input.slot.spansMidnight);
  const relevant=input.leaves.filter(leave=>leave.employeeId===input.workerId&&
    ordinal(String(leave.startDate))<=Math.floor(shift.to/1440)&&
    ordinal(String(leave.endDate))>=Math.floor(shift.from/1440));
  for(const leave of relevant){
    const setId=input.currentSetByLeaveId.get(leave.id);
    if(!setId)return "blocked"; // Ambiguous legacy partial leave cannot mean free.
    const intervals=input.intervalsBySet.get(setId);
    if(!intervals||intervals.length===0)return "unknown";
    const evaluation=approvedLeaveCoverageImpact({
      employeeId:leave.employeeId,startDate:String(leave.startDate),
      endDate:String(leave.endDate),days:Number(leave.days),
    });
    if(evaluation.kind==="invalid")return "unknown";
    const dates=Array.from({length:Math.max(0,Math.round(ordinal(String(leave.endDate))-ordinal(String(leave.startDate)))+1)},
      (_,index)=>dayOffset(String(leave.startDate),index));
    for(const date of dates){
      const parts=intervals.filter(item=>String(item.workDate)===date);
      if(parts.length===0)return "unknown";
      for(const part of parts){
        if(part.timezone!=="Asia/Manila")return "unknown";
        if(part.kind==="full_day"||part.kind==="first_half"||part.kind==="second_half"){
          // Half-day placement relies on an approved precise shift/break.
          // A new draft cannot infer it. Conservatively reject that day.
          if(overlap(shift,{from:ordinal(date)*1440,to:(ordinal(date)+1)*1440}))return "blocked";
          continue;
        }
        if(part.kind!=="timed"||!part.startLocalTime||!part.endLocalTime)return "unknown";
        const leaveWindow=absoluteWindow(date,part.startLocalTime,part.endLocalTime,part.endsNextDay);
        if(overlap(shift,leaveWindow))return "blocked";
      }
    }
  }
  return "clear";
}
function convertRestDay(value:string|null):number|null {
  if(!value)return null;
  const days=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const index=days.indexOf(value.trim().toLowerCase());
  return index>=0?index:null;
}
function paidShift(segment:ResolvedDailySchedule["segments"][number]){
  const from=minute(segment.startTime);let to=minute(segment.endTime);
  if(segment.spansMidnight||to<=from)to+=1440;
  return Math.max(0,to-from-segment.breakMinutes);
}
/** All database reads are scoped to the authenticated tenant and the selected worksite/unit. */
export async function previewEmployerGreedyRoster(input:{
  organizationId:number;worksiteId:number;startDate:string;endDate:string;
  scopeOrgUnitId:number|null;companyWide:boolean;
}) {
  const {organizationId,worksiteId,startDate,endDate}=input;
  const workStart=dayOffset(startDate,-28);
  const guardStart=dayOffset(startDate,-7);
  const guardEnd=dayOffset(endDate,7);
  const [site]=await db.select({
    id:worksites.id,orgUnitId:worksites.orgUnitId,active:worksites.active,
  }).from(worksites).where(and(
    eq(worksites.organizationId,organizationId),eq(worksites.id,worksiteId),
  )).limit(1);
  if(!site||!site.active||(!input.companyWide&&(site.orgUnitId==null||site.orgUnitId!==input.scopeOrgUnitId))){
    throw Error("Worksite is unavailable in the permitted manager scope.");
  }
  const [requirements,allShifts,workerRows,policyRows,holidayRows]=await Promise.all([
    db.select().from(staffingRequirements).where(and(
      eq(staffingRequirements.organizationId,organizationId),
      eq(staffingRequirements.worksiteId,worksiteId),
      gte(staffingRequirements.workDate,startDate),lte(staffingRequirements.workDate,endDate),
    )).orderBy(asc(staffingRequirements.workDate),asc(staffingRequirements.id)).limit(101),
    db.select().from(shiftDefinitions).where(eq(shiftDefinitions.organizationId,organizationId)),
    db.select({id:employees.id,organizationId:employees.organizationId,
      orgUnitId:employees.orgUnitId,firstName:employees.firstName,
      lastName:employees.lastName,status:employees.status,
      startDate:employees.startDate,restDay:employees.restDay,
    }).from(employees).where(and(
      eq(employees.organizationId,organizationId),
      input.companyWide?undefined:eq(employees.orgUnitId,input.scopeOrgUnitId!),
    )).orderBy(asc(employees.id)).limit(1001),
    db.select().from(workforceScheduleGuardrailPolicies)
      .where(eq(workforceScheduleGuardrailPolicies.organizationId,organizationId)).limit(1),
    db.select().from(holidays).where(and(
      or(eq(holidays.organizationId,organizationId),isNull(holidays.organizationId)),
      gte(holidays.holidayDate,startDate),lte(holidays.holidayDate,endDate),
      or(isNull(holidays.worksiteId),eq(holidays.worksiteId,worksiteId)),
      input.companyWide?undefined:or(isNull(holidays.orgUnitId),eq(holidays.orgUnitId,input.scopeOrgUnitId!)),
    )),
  ]);
  if(requirements.length>100||workerRows.length>1000)throw Error("Pilot roster exceeds verified demand or workforce scan cap.");
  if(requirements.length===0)throw Error("No recorded staffing requirements exist for this worksite/date range.");
  assertUnambiguousRoleDemand(requirements.map(row=>({
    worksiteId:row.worksiteId,workDate:String(row.workDate),shiftDefinitionId:row.shiftDefinitionId,jobProfileId:row.jobProfileId,
  })));
  const shiftsById=new Map(allShifts.map(row=>[row.id,row]));
  const totalPositions=requirements.reduce((sum,row)=>sum+row.requiredHeadcount,0);
  if(requirements.some(row=>!Number.isSafeInteger(row.requiredHeadcount)||row.requiredHeadcount<1)||
    totalPositions>200)throw Error("Select no more than 200 staffed positions.");
  const ids=workerRows.map(row=>row.id);
  const profileIds=[...new Set(requirements.map(row=>row.jobProfileId).filter((id):id is number=>id!==null))];
  const [availabilityRows,approvedLeaves,approvedOT,positionRows,roleAssignments,
    patterns,patternDays,patternSegments,assignmentRows,overrideRows,worksiteAssignments,
    separations,siteData,capabilityData,siteAuthorizationRows]=await Promise.all([
    ids.length?db.select().from(employeeAvailabilityRules).where(and(
      eq(employeeAvailabilityRules.organizationId,organizationId),
      inArray(employeeAvailabilityRules.employeeId,ids),
      lte(employeeAvailabilityRules.effectiveFrom,dayOffset(endDate,1)),
      or(isNull(employeeAvailabilityRules.effectiveUntil),
        gte(employeeAvailabilityRules.effectiveUntil,dayOffset(startDate,-1))),
    )):[],
    ids.length?db.select().from(leaveRequests).where(and(
      eq(leaveRequests.organizationId,organizationId),inArray(leaveRequests.employeeId,ids),
      eq(leaveRequests.status,"Approved"),lte(leaveRequests.startDate,dayOffset(endDate,1)),
      gte(leaveRequests.endDate,dayOffset(startDate,-1)),
    )):[],
    ids.length?db.select().from(overtimeRequests).where(and(
      eq(overtimeRequests.organizationId,organizationId),inArray(overtimeRequests.employeeId,ids),
      eq(overtimeRequests.status,"approved"),gte(overtimeRequests.workDate,startDate),
      lte(overtimeRequests.workDate,endDate),
    )):[],
    db.select({id:positions.id,jobProfileId:positions.jobProfileId})
      .from(positions).where(eq(positions.organizationId,organizationId)),
    ids.length?db.select().from(positionAssignments).where(and(
      eq(positionAssignments.organizationId,organizationId),
      inArray(positionAssignments.employeeId,ids),
      lte(positionAssignments.effectiveFrom,endDate),
      or(isNull(positionAssignments.effectiveUntil),gte(positionAssignments.effectiveUntil,startDate)),
    )):[],
    db.select().from(schedulePatterns).where(eq(schedulePatterns.organizationId,organizationId)),
    db.select({id:schedulePatternDays.id,patternId:schedulePatternDays.patternId,
      dayIndex:schedulePatternDays.dayIndex,isRestDay:schedulePatternDays.isRestDay,label:schedulePatternDays.label,
    }).from(schedulePatternDays).innerJoin(schedulePatterns,eq(schedulePatternDays.patternId,schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId,organizationId)),
    db.select({patternDayId:schedulePatternSegments.patternDayId,
      shiftDefinitionId:schedulePatternSegments.shiftDefinitionId,segmentOrder:schedulePatternSegments.segmentOrder,
    }).from(schedulePatternSegments)
      .innerJoin(schedulePatternDays,eq(schedulePatternSegments.patternDayId,schedulePatternDays.id))
      .innerJoin(schedulePatterns,eq(schedulePatternDays.patternId,schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId,organizationId)),
    ids.length?db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId,organizationId),
      inArray(employeeScheduleAssignments.employeeId,ids),
      lte(employeeScheduleAssignments.effectiveFrom,guardEnd),
      or(isNull(employeeScheduleAssignments.effectiveUntil),
        gte(employeeScheduleAssignments.effectiveUntil,workStart)),
    )):[],
    ids.length?db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId,organizationId),inArray(scheduleOverrides.employeeId,ids),
      gte(scheduleOverrides.workDate,workStart),lte(scheduleOverrides.workDate,guardEnd),
    )):[],
    ids.length?db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId,organizationId),
      inArray(employeeWorksiteAssignments.employeeId,ids),
      lte(employeeWorksiteAssignments.effectiveFrom,guardEnd),
      or(isNull(employeeWorksiteAssignments.effectiveUntil),gte(employeeWorksiteAssignments.effectiveUntil,workStart)),
    )):[],
    ids.length?db.select({employeeId:separationRecords.employeeId,status:separationRecords.status,
      lastDay:separationRecords.lastDay}).from(separationRecords).where(and(
      eq(separationRecords.organizationId,organizationId),inArray(separationRecords.employeeId,ids),
      inArray(separationRecords.status,["draft","approved","released"]),
    )):[],
    loadSiteEligibilityEvidence(organizationId,ids),
    loadCapabilityEligibilityData({organizationId,employeeIds:ids,jobProfileIds:profileIds}),
    ids.length?db.select().from(hcmWorksiteAuthorizations).where(and(
      eq(hcmWorksiteAuthorizations.organizationId,organizationId),
      inArray(hcmWorksiteAuthorizations.employeeId,ids),
      lte(hcmWorksiteAuthorizations.effectiveFrom,endDate),
      or(isNull(hcmWorksiteAuthorizations.effectiveUntil),
        gte(hcmWorksiteAuthorizations.effectiveUntil,startDate)),
    )):[],

  ]);
  const currentLeaveSets=approvedLeaves.length
    ?await db.select().from(leaveRequestIntervalSets).where(and(
      eq(leaveRequestIntervalSets.organizationId,organizationId),
      inArray(leaveRequestIntervalSets.leaveRequestId,approvedLeaves.map(row=>row.id)),
      eq(leaveRequestIntervalSets.status,"current"),
    )):[];
  const currentSetByLeaveId=new Map(currentLeaveSets.map(row=>[row.leaveRequestId,row.id]));
  const leaveIntervals=currentLeaveSets.length?await db.select().from(leaveRequestIntervals).where(and(
    eq(leaveRequestIntervals.organizationId,organizationId),
    inArray(leaveRequestIntervals.intervalSetId,currentLeaveSets.map(row=>row.id)),
  )):[];
  const intervalsBySet=new Map<number,typeof leaveIntervals>();
  for(const row of leaveIntervals){
    const list=intervalsBySet.get(row.intervalSetId)??[];
    list.push(row);intervalsBySet.set(row.intervalSetId,list);
  }
  const dates=Array.from({length:Math.round(ordinal(guardEnd)-ordinal(workStart))+1},
    (_,i)=>dayOffset(workStart,i));
  const normalizedShifts=allShifts.map(row=>({id:row.id,code:row.code,name:row.name,startTime:row.startTime,
    endTime:row.endTime,breakMinutes:row.breakMinutes,spansMidnight:row.spansMidnight}));
  const normalizedPatterns=patterns.map(row=>({id:row.id,code:row.code,name:row.name,cycleDays:row.cycleDays}));
  const workerDays=new Map<number,ResolvedDailySchedule[]>();
  for(const worker of workerRows){
    const a=assignmentRows.filter(row=>row.employeeId===worker.id).map(row=>({
      id:row.id,patternId:row.patternId,effectiveFrom:String(row.effectiveFrom),
      effectiveUntil:row.effectiveUntil?String(row.effectiveUntil):null,
      anchorDate:String(row.anchorDate),workLocationOrgUnitId:row.workLocationOrgUnitId,worksiteId:row.worksiteId,
    }));
    const o:WorkforceScheduleOverride[]=overrideRows.filter(row=>row.employeeId===worker.id).map(row=>({
      id:row.id,workDate:String(row.workDate),kind:row.kind as WorkforceScheduleOverride["kind"],
      isRestDay:row.isRestDay,segments:Array.isArray(row.segments)?row.segments as WorkforceScheduleOverrideSegment[]:[],
      workLocationOrgUnitId:row.workLocationOrgUnitId,worksiteId:row.worksiteId,
      status:row.status as WorkforceScheduleOverride["status"],reason:row.reason,
    }));
    const sites=worksiteAssignments.filter(row=>row.employeeId===worker.id).map(row=>({
      id:row.id,worksiteId:row.worksiteId,effectiveFrom:String(row.effectiveFrom),
      effectiveUntil:row.effectiveUntil?String(row.effectiveUntil):null,
    }));
    // Corrupt source evidence aborts the entire preview: never silently skip a
    // worker and claim to have examined the full eligible workforce.
    workerDays.set(worker.id,dates.map(date=>resolveDailySchedule({
      date,assignments:a,patterns:normalizedPatterns,patternDays,patternSegments,shifts:normalizedShifts,
      overrides:o,defaultWorksiteId:selectEffectiveWorksiteAssignment(sites,date)?.worksiteId??null,
    })));
  }
  const slots:GreedySlot[]=requirements.map(row=>{
    const shift=shiftsById.get(row.shiftDefinitionId);
    if(!shift||!shift.active)throw Error("An active employer shift definition is missing for demand.");
    const date=String(row.workDate);
    const holiday=holidayRows.find(h=>String(h.holidayDate)===date&&(h.orgUnitId==null||
      site.orgUnitId===h.orgUnitId));
    return {
      requirementId:row.id,organizationId,worksiteId,workDate:date,
      shiftDefinitionId:shift.id,jobProfileId:row.jobProfileId,
      requiredHeadcount:row.requiredHeadcount,startTime:shift.startTime,endTime:shift.endTime,
      spansMidnight:shift.spansMidnight||shift.endTime<=shift.startTime,
      breakMinutes:shift.breakMinutes,unpopular:isUnpopular(date,shift.startTime,Boolean(holiday)),
      holidayKind:holiday?.kind==="regular"||holiday?.kind==="special"?holiday.kind:null,
      preAssignedEmployeeIds:[],
    };
  });
  const normalizedRoleAssignments=roleAssignments.map(row=>({
    employeeId:row.employeeId,positionId:row.positionId,
    effectiveFrom:String(row.effectiveFrom),
    effectiveUntil:row.effectiveUntil?String(row.effectiveUntil):null,
  }));
  const normalizedSiteAuthorizations=siteAuthorizationRows.map(row=>({
    id:row.id,employeeId:row.employeeId,worksiteId:row.worksiteId,
    decision:row.decision==="deny"?"deny" as const:"allow" as const,
    effectiveFrom:String(row.effectiveFrom),
    effectiveUntil:row.effectiveUntil?String(row.effectiveUntil):null,
  }));
  const acceptedPrimaryAssignments=siteData.primaryAssignments.filter(row=>row.decision==="allow");
  const roleByEmployee=new Map(workerRows.map(worker=>[worker.id,
    normalizedRoleAssignments.filter(row=>row.employeeId===worker.id)]));
  const approvedLeavesByEmployee=new Map(workerRows.map(worker=>[worker.id,
    approvedLeaves.filter(row=>row.employeeId===worker.id)]));
  const availableByEmployee=new Map(workerRows.map(worker=>[worker.id,availabilityRows.filter(a=>a.employeeId===worker.id)
    .map(a=>({weekday:a.weekday,startTime:a.startTime,endTime:a.endTime,availabilityType:a.availabilityType,
      effectiveFrom:String(a.effectiveFrom),effectiveUntil:a.effectiveUntil?String(a.effectiveUntil):null}))]));
  const workers:GreedyWorker[]=workerRows.map(worker=>{
    const days=workerDays.get(worker.id)!;
    const workerSiteEvidence={
      ...siteData,
      primaryAssignments:acceptedPrimaryAssignments.filter(row=>row.employeeId===worker.id),
      arrangements:siteData.arrangements.filter(row=>row.employeeId===worker.id),
      authorizations:normalizedSiteAuthorizations.filter(row=>row.employeeId===worker.id),
    };
    const workerPrimaryDenials=siteData.primaryAssignments.filter(row=>
      row.employeeId===worker.id && row.decision==="deny");
    const workerLeaves=approvedLeavesByEmployee.get(worker.id)??[];
    const workerRoles=roleByEmployee.get(worker.id)??[];
    const restWeekday=convertRestDay(worker.restDay);
    const existingDays=days.filter(day=>day.date>=guardStart&&day.date<=guardEnd);
    const fairness=days.filter(day=>day.date>=workStart&&day.date<=endDate);
    const fairMinutes=fairness.reduce((sum,day)=>sum+day.segments.reduce((s,part)=>s+paidShift(part),0),0);
    const fairUnpopular=fairness.reduce((sum,day)=>sum+day.segments.filter(part=>
      isUnpopular(day.date,part.startTime)).length,0);
    const overtimeByDate:Record<string,number>={};
    for(const item of approvedOT.filter(row=>row.employeeId===worker.id)){
      const date=String(item.workDate);
      overtimeByDate[date]=(overtimeByDate[date]??0)+item.requestedMinutes;
    }
    const alive=(date:string)=>["active"].includes(worker.status.toLowerCase())
      && String(worker.startDate)<=date &&
      !separations.some(s=>s.employeeId===worker.id&&s.status!=="draft"&&
        String(s.lastDay)>=String(worker.startDate)&&date>String(s.lastDay));
    const evidenceByRequirement:Record<number,WorkerSlotEvidence>={};
    for(const slot of slots){
      let skill:WorkerSlotEvidence["skill"]="qualified";
      if(slot.jobProfileId!==null){
        const role=resolveEmployeeJobProfileAtDate({
          employeeId:worker.id,date:slot.workDate,
          assignments:workerRoles,
          positions:positionRows,
        });
        if(role.ambiguous||role.jobProfileId===null)skill="unknown";
        else if(role.jobProfileId!==slot.jobProfileId)skill="unqualified";
        else if(!evaluateEmployeeFromCapabilityData({
          data:capabilityData,employeeId:worker.id,jobProfileId:slot.jobProfileId,
          workDate:slot.workDate,
        }).eligible)skill="unqualified";
      }
      // Preserve explicit deny evidence from the tenant's authorizations.
      const siteEligibility=evaluateSiteEligibility({
        ...workerSiteEvidence,employeeId:worker.id,date:slot.workDate,worksiteId,
      });
      const primaryDenied=workerPrimaryDenials.some(row=>
        row.worksiteId===worksiteId&&row.effectiveFrom<=slot.workDate&&
        (!row.effectiveUntil||row.effectiveUntil>=slot.workDate));
      const siteStatus:WorkerSlotEvidence["site"]=!siteEligibility.eligible||primaryDenied?"ineligible":
        siteEligibility.source==="legacy"?"unknown":"eligible";
      const available=timedAvailabilityBlocks({
        workDate:slot.workDate,startTime:slot.startTime,endTime:slot.endTime,
        spansMidnight:slot.spansMidnight,rules:availableByEmployee.get(worker.id)??[],
      })?"unavailable":"available";
      const leave=leaveBlocks({slot,workerId:worker.id,leaves:workerLeaves,
        currentSetByLeaveId,intervalsBySet});
      evidenceByRequirement[slot.requirementId]={
        skill:alive(slot.workDate)?skill:"unqualified",
        site:siteStatus,availability:available,leave,
      };
    }
    return {employeeId:worker.id,organizationId,employeeName:(worker.firstName+" "+worker.lastName).trim(),
      active:worker.status.toLowerCase()==="active",restWeekday,existingDays,
      evidenceByRequirement,approvedOvertimeByDate:overtimeByDate,
      fairnessPriorMinutes:fairMinutes,fairnessPriorUnpopularShifts:fairUnpopular};
  });
  // Identify verifiably covered demand before asking the solver to fill gaps.
  for(const slot of slots){
    slot.preAssignedEmployeeIds=workers.filter(worker=>{
      const day=worker.existingDays.find(d=>d.date===slot.workDate);
      const facts=worker.evidenceByRequirement[slot.requirementId];
      return worker.active && day?.worksiteId===slot.worksiteId&&
        day.segments.some(s=>s.shiftDefinitionId===slot.shiftDefinitionId)&&
        facts?.skill==="qualified"&&facts.site==="eligible"&&
        facts.availability==="available"&&facts.leave==="clear";
    }).map(worker=>worker.employeeId);
  }
  const selected=policyRows[0];
  const guardrailPolicy=selected?{
    minimumRestMinutes:selected.minimumRestMinutes,maxConsecutiveWorkingDays:selected.maxConsecutiveWorkingDays,
    rollingSevenDayMinutes:selected.rollingSevenDayMinutes,active:selected.active,
    enforcementMode:selected.enforcementMode==="block"?"block" as const:"advisory" as const,
  }:{
    minimumRestMinutes:660,maxConsecutiveWorkingDays:6,rollingSevenDayMinutes:2880,
    enforcementMode:"block" as const,active:true,
  };
  const planInput:GreedyRosterInput={organizationId,slots,workers,rules:{
    schedule:guardrailPolicy,maxDailyPaidMinutes:720,maxRollingSevenDayPaidMinutes:2880,
    ordinaryDailyMinutes:480,unpopularRotationWeightMinutes:240,
  }};
  const result=planGreedyRoster(planInput);
  // Distinguish the statistical fairness heuristic from an approved legal rule.
  return {...result,source:{organizationId,worksiteId,startDate,endDate,
    slotCount:slots.length,candidateCount:workers.length,
    ruleSet:"Existing tenant WFM guardrails + conservative PH employer pilot caps",
    fairness:"Lowest projected paid minutes, weighted to rotate night/weekend/holiday shifts",
    scope:"Authenticated manager worksite and employee organization unit only",
    sourceVersion:"wfm-greedy-roster-v1"},
  };
}
