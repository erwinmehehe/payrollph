import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { holidays, workforceRosterPublishPolicies } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  evaluateRosterPublishRules, DEFAULT_PH_ROSTER_PUBLISH_POLICY,
  type RosterPublishPolicy, type RosterPublishHoliday,
} from "@/lib/workforce-schedule-guardrails";
import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";

export async function rosterPublishFindings(input: {
  organizationId: number;
  employeeOrgUnitId: number | null;
  days: ResolvedDailySchedule[];
  executor?: Pick<typeof db, "select">;
}) {
  if (!criticalReleaseFlagEnabled("wfmRosterPublishRules")) return [];
  const executor = input.executor ?? db;
  const [configured] = await executor.select().from(workforceRosterPublishPolicies)
    .where(eq(workforceRosterPublishPolicies.organizationId, input.organizationId)).limit(1);
  const policy: RosterPublishPolicy = configured ? {
    maxDailyMinutes: configured.maxDailyMinutes,
    minimumRestMinutes: configured.minimumRestMinutes,
    maxWeeklyMinutes: configured.maxWeeklyMinutes,
    approvedOvertimeCapMinutes: configured.approvedOvertimeCapMinutes,
    enforcementMode: configured.enforcementMode === "advisory" ? "advisory" : "block",
    active: configured.active,
  } : DEFAULT_PH_ROSTER_PUBLISH_POLICY;
  const ordered = [...input.days].sort((a,b) => a.date.localeCompare(b.date));
  if (!ordered.length) return [];
  const holidayRows = await executor.select({
    date: holidays.holidayDate, worksiteId: holidays.worksiteId,
    orgUnitId: holidays.orgUnitId,
  }).from(holidays).where(and(
    eq(holidays.organizationId, input.organizationId),
    gte(holidays.holidayDate, ordered[0].date),
    lte(holidays.holidayDate, ordered[ordered.length - 1].date),
  ));
  const relevant: RosterPublishHoliday[] = holidayRows
    .filter(row => row.orgUnitId === null || row.orgUnitId === input.employeeOrgUnitId)
    .map(row => ({date:String(row.date), worksiteId:row.worksiteId}));
  return evaluateRosterPublishRules({ days: ordered, policy, holidays: relevant });
}
