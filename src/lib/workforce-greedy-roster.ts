import {
  evaluateScheduleGuardrails,
  type ScheduleGuardrailIssue,
  type ScheduleGuardrailPolicy,
} from "./workforce-schedule-guardrails";
import type { ResolvedDailySchedule } from "./workforce-scheduling";

/**
 * Read-only deterministic staffing draft. All evidence must be server-scoped
 * and complete; these types are NOT an authorization to publish roster edits.
 */
export type GreedySlot = {
  requirementId: number;
  organizationId: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  requiredHeadcount: number;
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
  breakMinutes: number;
  unpopular: boolean;
  holidayKind?: "regular" | "special" | null;
  /** Already verified, available and scheduled on this exact requirement. */
  preAssignedEmployeeIds: number[];
};
export type WorkerSlotEvidence = {
  skill: "qualified" | "unqualified" | "unknown";
  site: "eligible" | "ineligible" | "unknown";
  availability: "available" | "unavailable" | "unknown";
  leave: "clear" | "blocked" | "unknown";
};
export type GreedyWorker = {
  employeeId: number;
  organizationId: number;
  employeeName: string;
  active: boolean;
  restWeekday: number | null;
  existingDays: ResolvedDailySchedule[];
  /** Calendar-scope eligibility, calculated from server-side HR/leave/skills. */
  evidenceByRequirement: Record<number, WorkerSlotEvidence>;
  /** Approved OT minutes for each work date, not a proposed or pending request. */
  approvedOvertimeByDate: Record<string, number>;
  /** Prior signed-off workload only; this draft never changes the baseline. */
  fairnessPriorMinutes: number;
  fairnessPriorUnpopularShifts: number;
};
export type GreedyRosterRules = {
  schedule: ScheduleGuardrailPolicy;
  /** Configurable employer scheduling safeguards; not universal legal maxima. */
  maxDailyPaidMinutes: number;
  maxRollingSevenDayPaidMinutes: number;
  ordinaryDailyMinutes: number;
  /** Unpopular-rotation weight. Larger values spread nights/weekends. */
  unpopularRotationWeightMinutes: number;
};
export type GreedyRosterInput = {
  organizationId: number;
  slots: readonly GreedySlot[];
  workers: readonly GreedyWorker[];
  rules: GreedyRosterRules;
};
export type GreedyRosterReason =
  | "no_workers" | "already_assigned" | "skill_missing" | "site_ineligible" | "unavailable"
  | "approved_leave" | "source_unknown" | "designated_rest_day"
  | "overlapping_shift" | "minimum_rest" | "rolling_week_cap"
  | "daily_hours_cap" | "overtime_approval" | "other_roster_rule";
export type GreedyRosterAssignment = {
  requirementId: number;
  employeeId: number;
  employeeName: string;
  workDate: string;
  worksiteId: number;
  shiftDefinitionId: number;
  paidMinutes: number;
  unpopular: boolean;
  source: "existing" | "suggested";
  warnings: string[];
};
export type GreedyUnfilledSlot = {
  requirementId: number;
  workDate: string;
  position: number;
  reason: GreedyRosterReason;
  evidence: Array<{ code: GreedyRosterReason; candidates: number }>;
};
export type GreedyRosterResult = {
  status: "review_required";
  automaticallyPublished: false;
  roster: GreedyRosterAssignment[];
  unfilled: GreedyUnfilledSlot[];
  summary: {
    required: number;
    existing: number;
    suggested: number;
    unfilled: number;
    fairnessProjectedMinutes: Array<{
      employeeId: number; scheduledMinutes: number; unpopularShifts: number;
    }>;
  };
  boundary: string;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DATE = /^\d{4}-\d\d-\d\d$/;
const REASONS: readonly GreedyRosterReason[] = [
  "no_workers","already_assigned","source_unknown","approved_leave","unavailable","skill_missing",
  "site_ineligible","designated_rest_day","overlapping_shift","minimum_rest",
  "overtime_approval","daily_hours_cap","rolling_week_cap","other_roster_rule",
];
const dayOrdinal = (date: string) => {
  if (!DATE.test(date)) throw Error("Invalid PH roster work date.");
  const parsed = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== date) {
    throw Error("Invalid PH roster work date.");
  }
  return Math.floor(parsed / 86_400_000);
};
const timeMinute = (time: string) => {
  if (!TIME.test(time)) throw Error("Invalid shift wall time.");
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (s ?? 0) / 60;
};
const paidSegmentMinutes = (segment: ResolvedDailySchedule["segments"][number]) => {
  const start = timeMinute(segment.startTime);
  let end = timeMinute(segment.endTime);
  if (segment.spansMidnight || end <= start) end += 1440;
  const gross = end - start;
  if (!Number.isSafeInteger(segment.breakMinutes) || segment.breakMinutes < 0 ||
      segment.breakMinutes >= gross || gross > 1440 || gross <= 0) {
    throw Error("Invalid existing scheduled shift minutes.");
  }
  return gross - segment.breakMinutes;
};
const slotPaidMinutes = (slot: GreedySlot) => {
  const start = timeMinute(slot.startTime);
  let end = timeMinute(slot.endTime);
  if (slot.spansMidnight) end += 1440;
  const gross = end - start;
  if (!Number.isSafeInteger(slot.breakMinutes) || slot.breakMinutes < 0 ||
      gross <= 0 || gross > 1440 || slot.breakMinutes >= gross) {
    throw Error("Invalid staffing shift duration or overnight marker.");
  }
  return gross - slot.breakMinutes;
};
function problemsToReason(issues: ScheduleGuardrailIssue[]): GreedyRosterReason {
  if (issues.some(issue=>issue.code==="segment_overlap")) return "overlapping_shift";
  if (issues.some(issue=>issue.code==="minimum_rest")) return "minimum_rest";
  if (issues.some(issue=>issue.code==="rolling_seven_day_minutes")) return "rolling_week_cap";
  return "other_roster_rule";
}
function checkDraft(
  worker: GreedyWorker,
  slot: GreedySlot,
  existing: ResolvedDailySchedule[],
  rules: GreedyRosterRules,
): GreedyRosterReason | null {
  if (!worker.active) return "source_unknown";
  const evidence=worker.evidenceByRequirement[slot.requirementId];
  if (!evidence || Object.values(evidence).some(value=>value==="unknown")) return "source_unknown";
  if (evidence.skill!=="qualified") return "skill_missing";
  if (evidence.site!=="eligible") return "site_ineligible";
  if (evidence.leave!=="clear") return "approved_leave";
  if (evidence.availability!=="available") return "unavailable";
  const weekday = new Date(slot.workDate+"T00:00:00Z").getUTCDay();
  if (worker.restWeekday === weekday) return "designated_rest_day";

  const before=existing.find(day=>day.date===slot.workDate);
  if (!before) return "source_unknown";
  if(before.segments.length>0&&before.worksiteId!==null&&before.worksiteId!==slot.worksiteId){
    // A same-day second site needs independent travel/location governance.
    return "site_ineligible";
  }
  const nextDay: ResolvedDailySchedule = {
    ...before, source:"override",isRestDay:false,
    segments: [
      ...before.segments,
      {shiftDefinitionId:slot.shiftDefinitionId,shiftCode:"DRAFT-"+slot.shiftDefinitionId,
       shiftName:"Unpublished candidate",segmentOrder:before.segments.length+1,
       startTime:slot.startTime,endTime:slot.endTime,
       spansMidnight:slot.spansMidnight,breakMinutes:slot.breakMinutes},
    ],
  };
  const next=existing.map(day=>day.date===slot.workDate?nextDay:day);
  // The checker compares absolute wall intervals, including overnight shifts.
  // Never tolerate a new overlap, even if the configured policy is advisory.
  const originalIssues=evaluateScheduleGuardrails({days:existing,policy:rules.schedule});
  const originalKeys=new Set(originalIssues.map(issue=>JSON.stringify([
    issue.code,issue.date,issue.relatedDate,issue.actualMinutes,issue.actualDays,
  ])));
  const candidateIssues=evaluateScheduleGuardrails({days:next,policy:{
    ...rules.schedule,active:true,enforcementMode:"block",
  }});
  const fresh=candidateIssues.filter(issue=>!originalKeys.has(JSON.stringify([
    issue.code,issue.date,issue.relatedDate,issue.actualMinutes,issue.actualDays,
  ])));
  if(fresh.length>0) return problemsToReason(fresh);
  const paidByDate=new Map<string,number>();
  for(const day of next) {
    paidByDate.set(day.date,day.segments.reduce((total,part)=>total+paidSegmentMinutes(part),0));
  }
  const current=paidByDate.get(slot.workDate)??0;
  if(current>rules.maxDailyPaidMinutes) return "daily_hours_cap";
  if(Math.max(0,current-rules.ordinaryDailyMinutes)>
    (worker.approvedOvertimeByDate[slot.workDate]??0)) return "overtime_approval";
  // Check every rolling week touched by this shift, including windows ending
  // AFTER the selected date when future shifts were already committed.
  const target=dayOrdinal(slot.workDate);
  for(let ending=target;ending<=target+6;ending++){
    let total=0;
    for(const [date,minutes] of paidByDate){
      const diff=ending-dayOrdinal(date);
      if(diff>=0&&diff<7)total+=minutes;
    }
    if(total>rules.maxRollingSevenDayPaidMinutes)return "rolling_week_cap";
  }
  return null;
}

function validateInput(input: GreedyRosterInput) {
  if(!Number.isSafeInteger(input.organizationId)||input.organizationId<1||
     input.slots.length===0||input.slots.length>100||
     input.workers.length>1000)throw Error("Invalid bounded roster solver scope.");
  const r=input.rules;
  if(!r||!r.schedule||!Number.isSafeInteger(r.maxDailyPaidMinutes)||
     r.maxDailyPaidMinutes<480||r.maxDailyPaidMinutes>1440||
     !Number.isSafeInteger(r.maxRollingSevenDayPaidMinutes)||
     r.maxRollingSevenDayPaidMinutes<480||r.maxRollingSevenDayPaidMinutes>10080||
     !Number.isSafeInteger(r.ordinaryDailyMinutes)||r.ordinaryDailyMinutes<1||
     r.ordinaryDailyMinutes>r.maxDailyPaidMinutes||
     !Number.isSafeInteger(r.unpopularRotationWeightMinutes)||
     r.unpopularRotationWeightMinutes<0||r.unpopularRotationWeightMinutes>1440||
     !Number.isSafeInteger(r.schedule.minimumRestMinutes)||
     r.schedule.minimumRestMinutes<0||r.schedule.minimumRestMinutes>1440||
     !Number.isSafeInteger(r.schedule.maxConsecutiveWorkingDays)||
     r.schedule.maxConsecutiveWorkingDays<0||r.schedule.maxConsecutiveWorkingDays>31||
     !Number.isSafeInteger(r.schedule.rollingSevenDayMinutes)||
     r.schedule.rollingSevenDayMinutes<0||r.schedule.rollingSevenDayMinutes>10080) {
    throw Error("Roster rule policy evidence invalid.");
  }
  const ids=new Set<number>(),workerIds=new Set<number>();
  let total=0,min=Infinity,max=-Infinity;
  for(const s of input.slots){
    if(!Number.isSafeInteger(s.requirementId)||s.requirementId<1||
       ids.has(s.requirementId)||s.organizationId!==input.organizationId||
       !Number.isSafeInteger(s.worksiteId)||s.worksiteId<1||
       !Number.isSafeInteger(s.shiftDefinitionId)||s.shiftDefinitionId<1||
       (s.jobProfileId!==null&&(!Number.isSafeInteger(s.jobProfileId)||s.jobProfileId<1))||
       !Number.isSafeInteger(s.requiredHeadcount)||s.requiredHeadcount<1||
       s.requiredHeadcount>100||typeof s.unpopular!=="boolean"||
       !Array.isArray(s.preAssignedEmployeeIds)||
       new Set(s.preAssignedEmployeeIds).size!==s.preAssignedEmployeeIds.length) {
      throw Error("Ambiguous or cross-tenant staffing requirement.");
    }
    ids.add(s.requirementId);
    const day=dayOrdinal(s.workDate);min=Math.min(day,min);max=Math.max(day,max);
    slotPaidMinutes(s);total+=s.requiredHeadcount;
  }
  if(max-min>13||total>200)throw Error("Roster request exceeds 14 days or 200 position slots.");
  for(const w of input.workers){
    if(!Number.isSafeInteger(w.employeeId)||w.employeeId<1||
       workerIds.has(w.employeeId)||w.organizationId!==input.organizationId||
       typeof w.active!=="boolean"||typeof w.employeeName!=="string"||
       (w.restWeekday!==null&&(!Number.isInteger(w.restWeekday)||w.restWeekday<0||w.restWeekday>6))||
       !Number.isSafeInteger(w.fairnessPriorMinutes)||w.fairnessPriorMinutes<0||
       !Number.isSafeInteger(w.fairnessPriorUnpopularShifts)||w.fairnessPriorUnpopularShifts<0||
       !Array.isArray(w.existingDays)||w.existingDays.length>56||
       new Set(w.existingDays.map(day=>day.date)).size!==w.existingDays.length) {
      throw Error("Invalid worker scope, identity or scheduling evidence.");
    }
    workerIds.add(w.employeeId);
    for(const day of w.existingDays){dayOrdinal(day.date);}
    for(const [date,minutes] of Object.entries(w.approvedOvertimeByDate)){
      dayOrdinal(date);
      if(!Number.isSafeInteger(minutes)||minutes<0||minutes>1440)throw Error("Invalid approved OT cap evidence.");
    }
  }
  for(const s of input.slots){
    if(s.preAssignedEmployeeIds.some(id=>!workerIds.has(id)))throw Error("Preassigned employee missing from authorized worker scope.");
  }
}

export function planGreedyRoster(input:GreedyRosterInput):GreedyRosterResult {
  validateInput(input);
  const workers=[...input.workers].sort((a,b)=>a.employeeId-b.employeeId);
  const byId=new Map(workers.map(worker=>[worker.employeeId,worker]));
  const projected=new Map(workers.map(w=>[w.employeeId,[...w.existingDays].sort((a,b)=>a.date.localeCompare(b.date))]));
  const addedMinutes=new Map(workers.map(w=>[w.employeeId,0]));
  const addedUnpopular=new Map(workers.map(w=>[w.employeeId,0]));
  // Staff scarce qualifications first. Within equally constrained requirements,
  // unpopular shifts go first, then PH calendar and stable requirement id.
  const ordered=[...input.slots].sort((a,b)=>{
    const feasible=(slot:GreedySlot)=>workers.filter(worker=>{
      const e=worker.evidenceByRequirement[slot.requirementId];
      return worker.active && !!e && e.skill==="qualified"&&e.site==="eligible"&&
        e.availability==="available"&&e.leave==="clear";
    }).length;
    return feasible(a)-feasible(b)||Number(b.unpopular)-Number(a.unpopular)||
      a.workDate.localeCompare(b.workDate)||timeMinute(a.startTime)-timeMinute(b.startTime)||
      a.requirementId-b.requirementId;
  });
  const roster:GreedyRosterAssignment[]=[];
  const unfilled:GreedyUnfilledSlot[]=[];
  let originalCount=0;
  for(const slot of ordered){
    const paid=slotPaidMinutes(slot);
    const originals=[...slot.preAssignedEmployeeIds].sort((a,b)=>a-b);
    for(const id of originals){
      const worker=byId.get(id)!;
      roster.push({requirementId:slot.requirementId,employeeId:id,employeeName:worker.employeeName,
        workDate:slot.workDate,worksiteId:slot.worksiteId,shiftDefinitionId:slot.shiftDefinitionId,
        paidMinutes:paid,unpopular:slot.unpopular,source:"existing",warnings:premiumWarnings(worker,slot)});
      originalCount++;
    }
    const remaining=Math.max(0,slot.requiredHeadcount-originals.length);
    const chosen=new Set(originals);
    for(let position=1;position<=remaining;position++){
      const reasons=new Map<GreedyRosterReason,number>();
      const eligible:Array<{worker:GreedyWorker;score:number;minutes:number;unpopular:number}>=[];
      for(const worker of workers){
        if(chosen.has(worker.employeeId)){
          reasons.set("already_assigned",(reasons.get("already_assigned")??0)+1);
          continue;
        }
        const reason=checkDraft(worker,slot,projected.get(worker.employeeId)!,input.rules);
        if(reason){reasons.set(reason,(reasons.get(reason)??0)+1);continue;}
        const minutes=worker.fairnessPriorMinutes+(addedMinutes.get(worker.employeeId)??0);
        const unpopular=worker.fairnessPriorUnpopularShifts+(addedUnpopular.get(worker.employeeId)??0);
        const score=minutes+(slot.unpopular?unpopular*input.rules.unpopularRotationWeightMinutes:0);
        eligible.push({worker,score,minutes,unpopular});
      }
      eligible.sort((a,b)=>a.score-b.score||a.unpopular-b.unpopular||
        a.minutes-b.minutes||a.worker.employeeId-b.worker.employeeId);
      const selected=eligible[0]?.worker;
      if(!selected){
        const evidence=[...reasons].map(([code,candidates])=>({code,candidates}))
          .sort((a,b)=>b.candidates-a.candidates||
            REASONS.indexOf(a.code)-REASONS.indexOf(b.code));
        unfilled.push({requirementId:slot.requirementId,workDate:slot.workDate,
          position:originals.length+position,
          reason:workers.length===0?"no_workers":evidence[0]?.code??"no_workers",
          evidence});
        continue;
      }
      chosen.add(selected.employeeId);
      const current=projected.get(selected.employeeId)!;
      projected.set(selected.employeeId,current.map(day=>day.date===slot.workDate
        ? {...day,source:"override" as const,isRestDay:false,segments:[...day.segments,{
          shiftDefinitionId:slot.shiftDefinitionId,shiftCode:"DRAFT-"+slot.shiftDefinitionId,
          shiftName:"Unpublished candidate",segmentOrder:day.segments.length+1,
          startTime:slot.startTime,endTime:slot.endTime,spansMidnight:slot.spansMidnight,
          breakMinutes:slot.breakMinutes,
        }]}:day));
      addedMinutes.set(selected.employeeId,(addedMinutes.get(selected.employeeId)??0)+paid);
      if(slot.unpopular)addedUnpopular.set(selected.employeeId,(addedUnpopular.get(selected.employeeId)??0)+1);
      roster.push({requirementId:slot.requirementId,employeeId:selected.employeeId,
        employeeName:selected.employeeName,workDate:slot.workDate,
        worksiteId:slot.worksiteId,shiftDefinitionId:slot.shiftDefinitionId,
        paidMinutes:paid,unpopular:slot.unpopular,source:"suggested",
        warnings:premiumWarnings(selected,slot)});
    }
  }
  roster.sort((a,b)=>a.workDate.localeCompare(b.workDate)||
    a.requirementId-b.requirementId||
    (Number(a.source==="suggested")-Number(b.source==="suggested"))||
    a.employeeId-b.employeeId);
  unfilled.sort((a,b)=>a.workDate.localeCompare(b.workDate)||
    a.requirementId-b.requirementId||a.position-b.position);
  return {
    status:"review_required",automaticallyPublished:false,roster,unfilled,
    summary:{
      required:input.slots.reduce((sum,slot)=>sum+slot.requiredHeadcount,0),
      existing:originalCount,
      suggested:roster.length-originalCount,unfilled:unfilled.length,
      fairnessProjectedMinutes:workers.map(worker=>({
        employeeId:worker.employeeId,
        scheduledMinutes:worker.fairnessPriorMinutes+(addedMinutes.get(worker.employeeId)??0),
        unpopularShifts:worker.fairnessPriorUnpopularShifts+(addedUnpopular.get(worker.employeeId)??0),
      })),
    },
    boundary:"Suggestion only. Requires independent eligibility, statutory pay/premium and maker-checker approval at publication. No roster, payroll or funds were changed.",
  };
}
function premiumWarnings(worker:GreedyWorker,slot:GreedySlot) {
  const warnings:string[]=[];
  if(worker.restWeekday===new Date(slot.workDate+"T00:00:00Z").getUTCDay())warnings.push("Rest-day premium review required.");
  if(slot.holidayKind)warnings.push(slot.holidayKind+" holiday premium review required.");
  const start=timeMinute(slot.startTime);
  const end=timeMinute(slot.endTime)+(slot.spansMidnight?1440:0);
  if(start>=1320||end>1320||slot.spansMidnight)warnings.push("Night differential review may be required.");
  return warnings;
}
