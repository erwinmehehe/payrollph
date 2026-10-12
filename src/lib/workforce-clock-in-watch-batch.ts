import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments, employeeWorksiteAssignments,
  scheduleOverrides, schedulePatternDays, schedulePatternSegments,
  schedulePatterns, shiftDefinitions,
} from "@/db/schema";
import {
  resolveDailySchedule,
  type ResolvedDailySchedule,
  type WorkforceScheduleOverride,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";

/**
 * Reduce 100-worker watch slices from seven schedule queries per employee to
 * seven per tenant slice. Uses the authoritative schedule resolver, not a
 * second interpretation of patterns, split shifts or overnight rotations.
 * Tenant and employee filters are applied to every employee-level relation.
 */
export async function loadClockInWatchScheduleBatch(input: {
  organizationId: number;
  employeeIds: number[];
  startDate: string;
  endDate: string;
}): Promise<Map<number, ResolvedDailySchedule[] | null>> {
  const { organizationId, employeeIds, startDate, endDate } = input;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || employeeIds.length < 1 || employeeIds.length > 100
    || employeeIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || startDate > endDate) throw Error("Invalid clock-in watch schedule batch.");
  const [shifts, patterns, patternDays, patternSegments, assignmentRows, overrideRows, worksiteRows] = await Promise.all([
    db.select().from(shiftDefinitions).where(eq(shiftDefinitions.organizationId, organizationId)),
    db.select().from(schedulePatterns).where(eq(schedulePatterns.organizationId, organizationId)),
    db.select({
      id: schedulePatternDays.id, patternId: schedulePatternDays.patternId,
      dayIndex: schedulePatternDays.dayIndex, isRestDay: schedulePatternDays.isRestDay,
      label: schedulePatternDays.label,
    }).from(schedulePatternDays)
      .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId,schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId,organizationId)),
    db.select({
      patternDayId:schedulePatternSegments.patternDayId,
      shiftDefinitionId:schedulePatternSegments.shiftDefinitionId,
      segmentOrder:schedulePatternSegments.segmentOrder,
    }).from(schedulePatternSegments)
      .innerJoin(schedulePatternDays,eq(schedulePatternSegments.patternDayId,schedulePatternDays.id))
      .innerJoin(schedulePatterns,eq(schedulePatternDays.patternId,schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId,organizationId)),
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId,organizationId),
      inArray(employeeScheduleAssignments.employeeId,employeeIds),
      lte(employeeScheduleAssignments.effectiveFrom,endDate),
      or(isNull(employeeScheduleAssignments.effectiveUntil),
        gte(employeeScheduleAssignments.effectiveUntil,startDate)),
    )),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId,organizationId),
      inArray(scheduleOverrides.employeeId,employeeIds),
      gte(scheduleOverrides.workDate,startDate),lte(scheduleOverrides.workDate,endDate),
    )),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId,organizationId),
      inArray(employeeWorksiteAssignments.employeeId,employeeIds),
      lte(employeeWorksiteAssignments.effectiveFrom,endDate),
      or(isNull(employeeWorksiteAssignments.effectiveUntil),
        gte(employeeWorksiteAssignments.effectiveUntil,startDate)),
    )),
  ]);
  const dates=[startDate,...(startDate===endDate?[]:[endDate])];
  const result=new Map<number,ResolvedDailySchedule[]|null>();
  const normalizedPatterns=patterns.map(p=>({
    id:p.id,code:p.code,name:p.name,cycleDays:p.cycleDays,
  }));
  const normalizedShifts=shifts.map(shift=>({
    id:shift.id,code:shift.code,name:shift.name,startTime:shift.startTime,
    endTime:shift.endTime,breakMinutes:shift.breakMinutes,spansMidnight:shift.spansMidnight,
  }));
  for(const employeeId of employeeIds){
    const assignments=assignmentRows.filter(row=>row.employeeId===employeeId).map(row=>({
      id:row.id,patternId:row.patternId,
      effectiveFrom:String(row.effectiveFrom),effectiveUntil:row.effectiveUntil?String(row.effectiveUntil):null,
      anchorDate:String(row.anchorDate),workLocationOrgUnitId:row.workLocationOrgUnitId,worksiteId:row.worksiteId,
    }));
    const overrides: WorkforceScheduleOverride[] =overrideRows.filter(row=>row.employeeId===employeeId).map(row=>({
      id:row.id,workDate:String(row.workDate),
      kind:row.kind as WorkforceScheduleOverride["kind"],isRestDay:row.isRestDay,
      segments:Array.isArray(row.segments)?row.segments as WorkforceScheduleOverrideSegment[]:[],
      workLocationOrgUnitId:row.workLocationOrgUnitId,worksiteId:row.worksiteId,
      status:row.status as WorkforceScheduleOverride["status"],reason:row.reason,
    }));
    const sites=worksiteRows.filter(row=>row.employeeId===employeeId).map(row=>({
      id:row.id,worksiteId:row.worksiteId,effectiveFrom:String(row.effectiveFrom),
      effectiveUntil:row.effectiveUntil?String(row.effectiveUntil):null,
    }));
    try{
      const days=dates.map(date=>resolveDailySchedule({
        date,assignments,patterns:normalizedPatterns,patternDays,patternSegments,
        shifts:normalizedShifts,overrides,
        defaultWorksiteId:selectEffectiveWorksiteAssignment(sites,date)?.worksiteId??null,
      }));
      result.set(employeeId,days);
    }catch{
      // Contradictory shift data must be reviewed, not marked as a rest day.
      result.set(employeeId,null);
    }
  }
  return result;
}
