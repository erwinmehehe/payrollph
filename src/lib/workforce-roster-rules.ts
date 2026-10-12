import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";

/**
 * Philippine scheduling baseline: 8 ordinary hours/day (Labor Code Arts 83/87).
 * The 12h maximum duty, 11h inter-shift rest and 48h rolling week are
 * configurable *employer scheduling controls*, not statutory absolute caps.
 * The existing payroll engine alone calculates statutory premiums.
 */
export type WfmRosterRulePolicy = {
  active: boolean;
  maxDailyMinutes: number;
  maxRollingSevenDayMinutes: number;
  minRestBetweenShiftsMinutes: number;
  ordinaryDailyMinutes: number;
  approvedOvertimeCapMinutes: number; // zero disables organization-wide cap
  enforcementMode: "block" | "advisory";
};
export const PH_ROSTER_RULE_DEFAULTS: WfmRosterRulePolicy = {
  active: true,
  maxDailyMinutes: 12 * 60,
  maxRollingSevenDayMinutes: 48 * 60,
  minRestBetweenShiftsMinutes: 11 * 60,
  ordinaryDailyMinutes: 8 * 60,
  approvedOvertimeCapMinutes: 0,
  enforcementMode: "block",
};
export type WfmRosterFindingCode =
  | "MAX_DAILY_HOURS" | "MAX_WEEKLY_HOURS" | "MIN_REST_BETWEEN_SHIFTS"
  | "OVERLAPPING_SHIFTS" | "OVERTIME_APPROVED_CAP"
  | "REST_DAY_PREMIUM" | "HOLIDAY_PREMIUM";
export type WfmRosterFinding = {
  code: WfmRosterFindingCode;
  severity: "blocking" | "warning";
  date: string;
  relatedDate?: string;
  message: string;
  actualMinutes?: number;
  thresholdMinutes?: number;
  overrideEligible: boolean;
};
export type ApplicableHoliday = {
  date: string;
  kind: "regular" | "special";
  name: string;
  worksiteId?: number | null;
  orgUnitId?: number | null;
};

export function validateRosterRulePolicy(policy: WfmRosterRulePolicy): boolean {
  return typeof policy.active === "boolean"
    && ["block", "advisory"].includes(policy.enforcementMode)
    && Number.isSafeInteger(policy.maxDailyMinutes) && policy.maxDailyMinutes >= 480 && policy.maxDailyMinutes <= 1440
    && Number.isSafeInteger(policy.maxRollingSevenDayMinutes) && policy.maxRollingSevenDayMinutes >= 480 && policy.maxRollingSevenDayMinutes <= 10080
    && Number.isSafeInteger(policy.minRestBetweenShiftsMinutes) && policy.minRestBetweenShiftsMinutes >= 0 && policy.minRestBetweenShiftsMinutes <= 1440
    && Number.isSafeInteger(policy.ordinaryDailyMinutes) && policy.ordinaryDailyMinutes >= 480 && policy.ordinaryDailyMinutes <= 720
    && Number.isSafeInteger(policy.approvedOvertimeCapMinutes) && policy.approvedOvertimeCapMinutes >= 0 && policy.approvedOvertimeCapMinutes <= 10080;
}
function dateOrdinal(value: string): number {
  const ms = Date.parse(value + "T00:00:00Z");
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(ms)
    || new Date(ms).toISOString().slice(0, 10) !== value) throw Error("Invalid roster date.");
  return ms / 86_400_000;
}
function minute(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw Error("Invalid scheduled clock.");
  const [h,m,s] = value.split(":").map(Number);
  return 60*h + m + (s??0)/60;
}
type Interval={date:string;start:number;end:number;paid:number;code:string;worksiteId:number|null};
export function evaluateWfmRosterRules(input: {
  days: readonly ResolvedDailySchedule[];
  policy: WfmRosterRulePolicy;
  targetDates?: readonly string[];
  designatedRestDay?: string | null;
  baselineRestDates?: readonly string[];
  holidays?: readonly ApplicableHoliday[];
  /** Explicitly approved overtime minutes per workday, if an approved cap exists. */
  approvedOvertimeMinutesByDate?: Readonly<Record<string,number>>;
  employeeOrgUnitId?: number | null;
}): WfmRosterFinding[] {
  const {policy}=input;
  if(!validateRosterRulePolicy(policy))throw Error("Invalid organization roster rules.");
  const days=[...input.days].sort((a,b)=>a.date.localeCompare(b.date));
  const target=new Set(input.targetDates??days.map(d=>d.date));
  const intervals:Interval[]=[];
  const paidByDay=new Map<string,number>();
  const worksitesByDate=new Map(days.map(day=>[day.date,day.worksiteId]));
  const result:WfmRosterFinding[]=[];
  const mode:WfmRosterFinding["severity"]=policy.enforcementMode==="block"?"blocking":"warning";
  for(const day of days){
    const ordinal=dateOrdinal(day.date);
    for(const segment of day.segments){
      const start=ordinal*1440+minute(segment.startTime);
      let end=ordinal*1440+minute(segment.endTime);
      if(segment.spansMidnight||end<=start)end+=1440;
      const gross=end-start;
      if(gross<=0||gross>1440 || segment.breakMinutes<0 || segment.breakMinutes>=gross)
        throw Error("Invalid shift duration; review scheduling evidence.");
      const paid=gross-segment.breakMinutes;
      intervals.push({date:day.date,start,end,paid,code:segment.shiftCode,worksiteId:day.worksiteId});
      paidByDay.set(day.date,(paidByDay.get(day.date)??0)+paid);
    }
  }
  intervals.sort((a,b)=>a.start-b.start||a.end-b.end);
  let latest:Interval|null=null;
  for(const current of intervals){
    // A published shift can also conflict with the following, unchanged shift.
    // Inspect both sides of a target date, not only the newly edited date.
    if(latest&&(target.has(current.date)||target.has(latest.date))){
      if(current.start<latest.end)result.push({
        code:"OVERLAPPING_SHIFTS",severity:"blocking",date:current.date,relatedDate:latest.date,
        message:`Shift ${current.code} starting at minute ${Math.round(current.start % 1440)} overlaps ${latest.code}; overlap cannot be overridden.`,overrideEligible:false,
      });
      else {
        const gap=current.start-latest.end;
        if(policy.active && gap<policy.minRestBetweenShiftsMinutes)result.push({
          code:"MIN_REST_BETWEEN_SHIFTS",severity:mode,date:current.date,relatedDate:latest.date,
          message:`Only ${Math.round(gap)} minutes between shifts; employer minimum is ${policy.minRestBetweenShiftsMinutes} minutes.`,
          actualMinutes:Math.round(gap),thresholdMinutes:policy.minRestBetweenShiftsMinutes,overrideEligible:true,
        });
      }
    }
    if(!latest||current.end>latest.end)latest=current;
  }
  for(const day of days){
    if(!policy.active)continue;
    const paid=paidByDay.get(day.date)??0;
    const isTarget=target.has(day.date);
    // A change on Tuesday may create a weekly cap breach on Wednesday through
    // the following Monday; checking Tuesday alone misses that future window.
    const currentOrdinal=dateOrdinal(day.date);
    const affectsRollingWeek=[...target].some(date=>{
      const offset=currentOrdinal-dateOrdinal(date);
      return offset>=0&&offset<7;
    });
    const weekly=affectsRollingWeek?[...paidByDay].filter(([date])=>
      currentOrdinal-dateOrdinal(date)>=0&&currentOrdinal-dateOrdinal(date)<7
    ).reduce((sum,[,value])=>sum+value,0):0;
    if(affectsRollingWeek&&weekly>policy.maxRollingSevenDayMinutes)result.push({
      code:"MAX_WEEKLY_HOURS",severity:mode,date:day.date,
      message:`Rolling seven-day scheduled paid time ${weekly} minutes exceeds employer cap of ${policy.maxRollingSevenDayMinutes} minutes.`,
      actualMinutes:weekly,thresholdMinutes:policy.maxRollingSevenDayMinutes,overrideEligible:true,
    });
    // Daily time, approved OT and premium implications apply to changed days.
    if(!isTarget)continue;
    if(paid>policy.maxDailyMinutes)result.push({
      code:"MAX_DAILY_HOURS",severity:mode,date:day.date,
      message:`Scheduled paid time ${paid} minutes exceeds employer daily cap of ${policy.maxDailyMinutes} minutes.`,
      actualMinutes:paid,thresholdMinutes:policy.maxDailyMinutes,overrideEligible:true,
    });
    const scheduledOvertime=Math.max(0,paid-policy.ordinaryDailyMinutes);
    const approvedDaily=input.approvedOvertimeMinutesByDate?.[day.date];
    const caps = [approvedDaily, policy.approvedOvertimeCapMinutes > 0 ? policy.approvedOvertimeCapMinutes : undefined]
      .filter((value): value is number => value !== undefined);
    const cap = caps.length > 0 ? Math.min(...caps) : null;
    if(cap!==null&&scheduledOvertime>cap)result.push({
      code:"OVERTIME_APPROVED_CAP",severity:"blocking",date:day.date,
      message:`Proposed overtime ${scheduledOvertime} minutes exceeds approved cap of ${cap} minutes; seek separate overtime approval.`,
      actualMinutes:scheduledOvertime,thresholdMinutes:cap,overrideEligible:false,
    });
    if(paid<=0)continue;
    const normalizedRest=input.designatedRestDay?.toLowerCase();
    const weekday=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][new Date(day.date+"T00:00:00Z").getUTCDay()];
    const rest=normalizedRest===weekday || (input.baselineRestDates?.includes(day.date)??false);
    if(rest)result.push({
      code:"REST_DAY_PREMIUM",severity:"warning",date:day.date,
      message:"Scheduled work is on the employee's designated rest day. Review applicable rest-day and overtime premiums before publishing; payroll calculates actual pay.",
      overrideEligible:false,
    });
    const holiday=input.holidays?.find(item=>item.date===day.date
      && (item.worksiteId==null||item.worksiteId===worksitesByDate.get(day.date))
      && (item.orgUnitId==null||item.orgUnitId===input.employeeOrgUnitId));
    if(holiday)result.push({
      code:"HOLIDAY_PREMIUM",severity:"warning",date:day.date,
      message:`${holiday.name} (${holiday.kind} holiday): confirm applicable holiday${rest?"/rest-day":""} premiums before publishing. No pay amount is inferred here.`,
      overrideEligible:false,
    });
  }
  // Comparisons traverse each related date once; duplicate sources cannot
  // produce multiple identical findings for a single employee/date/code.
  const seen=new Set<string>();
  return result.filter(item=>{
    const key=[item.date,item.code,item.relatedDate??"",item.actualMinutes??"",item.message].join(":");
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code));
}
export function decideRosterRulePublish(input:{
  findings:readonly WfmRosterFinding[];
  overrideReason?:string|null;
  managerMayOverride:boolean;
}) {
  const blocking=input.findings.filter(f=>f.severity==="blocking");
  const unwaivable=blocking.filter(f=>!f.overrideEligible);
  const reason=(input.overrideReason??"").trim();
  const mayOverride=Boolean(input.managerMayOverride&&reason.length>=20&&reason.length<=240);
  const overriddenCodes=mayOverride&&unwaivable.length===0
    ? [...new Set(blocking.filter(f=>f.overrideEligible).map(f=>f.code))] : [];
  return {blocked:unwaivable.length>0||(blocking.length>0&&!mayOverride),
    overriddenCodes, reason:overriddenCodes.length>0?reason:null};
}
