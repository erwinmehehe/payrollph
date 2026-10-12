import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, holidays, overtimeRequests, workforceRosterRulePolicies } from "@/db/schema";
import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";
import {
  PH_ROSTER_RULE_DEFAULTS, evaluateWfmRosterRules,
  type WfmRosterRulePolicy,
} from "@/lib/workforce-roster-rules";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export function wfmRosterScaleRulesEnabled() {
  return criticalReleaseFlagEnabled("wfmRosterScaleRules");
}
type Reader = Pick<typeof db, "select">;
export async function loadWfmRosterRulePolicy(
  organizationId: number, executor: Reader = db,
): Promise<WfmRosterRulePolicy> {
  if (!wfmRosterScaleRulesEnabled()) return PH_ROSTER_RULE_DEFAULTS;
  const [row] = await executor.select().from(workforceRosterRulePolicies)
    .where(eq(workforceRosterRulePolicies.organizationId, organizationId)).limit(1);
  return row ? {
    active: row.active,
    maxDailyMinutes: row.maxDailyMinutes,
    maxRollingSevenDayMinutes: row.maxRollingSevenDayMinutes,
    minRestBetweenShiftsMinutes: row.minRestBetweenShiftsMinutes,
    ordinaryDailyMinutes: row.ordinaryDailyMinutes,
    approvedOvertimeCapMinutes: row.approvedOvertimeCapMinutes,
    enforcementMode: row.enforcementMode === "advisory" ? "advisory" : "block",
  } : PH_ROSTER_RULE_DEFAULTS;
}

/**
 * Inspect only this employee's employer, employment scope, approved OT caps
 * and applicable official employer holiday rows. Reused for preview AND
 * release-time rechecks within the same employer advisory-lock transaction.
 */
export async function checkWfmRosterPublish(input: {
  organizationId: number;
  employeeId: number;
  days: readonly ResolvedDailySchedule[];
  targetDates: readonly string[];
  baselineRestDates?: readonly string[];
  executor?: Reader;
}) {
  if (!wfmRosterScaleRulesEnabled()) return {
    policy: null, findings: [] as ReturnType<typeof evaluateWfmRosterRules>,
  };
  const executor = input.executor ?? db;
  const start = input.days.at(0)?.date;
  const end = input.days.at(-1)?.date;
  if (!start || !end || input.targetDates.length === 0) throw Error("Empty roster rules window.");
  const [policy, employeeRows, holidayRows, approvedOvertime] = await Promise.all([
    loadWfmRosterRulePolicy(input.organizationId, executor),
    executor.select({ restDay: employees.restDay, orgUnitId: employees.orgUnitId })
      .from(employees).where(and(eq(employees.organizationId, input.organizationId),
        eq(employees.id, input.employeeId))).limit(1),
    executor.select({
      date: holidays.holidayDate, name: holidays.name,
      kind: holidays.kind, orgUnitId: holidays.orgUnitId, worksiteId: holidays.worksiteId,
    }).from(holidays).where(and(
      or(eq(holidays.organizationId, input.organizationId), isNull(holidays.organizationId)),
      gte(holidays.holidayDate, start), lte(holidays.holidayDate, end),
    )),
    executor.select({date:overtimeRequests.workDate,minutes:overtimeRequests.requestedMinutes})
      .from(overtimeRequests).where(and(eq(overtimeRequests.organizationId,input.organizationId),
        eq(overtimeRequests.employeeId,input.employeeId),eq(overtimeRequests.status,"approved"),
        gte(overtimeRequests.workDate,start),lte(overtimeRequests.workDate,end))),
  ]);
  const employee = employeeRows[0];
  if (!employee) throw Error("Worker cannot be verified for this employer.");
  const approvedOvertimeMinutesByDate: Record<string, number> = {};
  for (const row of approvedOvertime) {
    const date = String(row.date);
    approvedOvertimeMinutesByDate[date]=(approvedOvertimeMinutesByDate[date]??0)+row.minutes;
  }
  const findings=evaluateWfmRosterRules({
    days:input.days,policy,targetDates:input.targetDates,
    designatedRestDay:employee.restDay,baselineRestDates:input.baselineRestDates,
    employeeOrgUnitId:employee.orgUnitId,
    holidays:holidayRows.flatMap(row=>row.kind==="regular"||row.kind==="special" ? [{
      date:String(row.date),name:row.name,kind:row.kind,
      orgUnitId:row.orgUnitId,worksiteId:row.worksiteId,
    }] : []),
    approvedOvertimeMinutesByDate,
  });
  return {policy,findings};
}
