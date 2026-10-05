import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  schedulerState,
  statutoryContributionIssueCases,
} from "@/db/schema";
import {
  contributionCaseEscalationStage,
  contributionCaseServiceStatus,
} from "@/lib/statutory-contribution-case-aging";
import { notifyPayrollOfContributionCaseEscalation } from "@/lib/statutory-contribution-case-notifications";

const RUN_EVERY_MS = 60 * 60 * 1000;
const LOCAL_CHECK_INTERVAL_MS = 60 * 1000;
const SCHEDULE_JOB = "employee-contribution-case-escalations";
let lastLocalCheck = 0;

export async function runScheduledContributionCaseEscalations(input: {
  actor: string;
  now?: Date;
  force?: boolean;
}) {
  const now = input.now ?? new Date();
  const force = input.force === true;

  if (!force && now.getTime() - lastLocalCheck < LOCAL_CHECK_INTERVAL_MS) {
    return {
      checked: 0,
      escalated: 0,
      failures: 0,
      stageCounts: { stage1: 0, stage2: 0, stage3: 0 },
      skipped: true as const,
      reason: "local-interval" as const,
    };
  }
  lastLocalCheck = now.getTime();

  const [schedule] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, SCHEDULE_JOB))
    .limit(1);

  if (
    !force
    && schedule?.lastRunAt
    && now.getTime() - schedule.lastRunAt.getTime() < RUN_EVERY_MS
  ) {
    return {
      checked: 0,
      escalated: 0,
      failures: 0,
      stageCounts: { stage1: 0, stage2: 0, stage3: 0 },
      skipped: true as const,
      reason: "scheduler-interval" as const,
      lastRunAt: schedule.lastRunAt,
    };
  }

  const cases = await db.select()
    .from(statutoryContributionIssueCases)
    .where(inArray(statutoryContributionIssueCases.status, ["open", "in_review"]))
    .orderBy(asc(statutoryContributionIssueCases.createdAt), asc(statutoryContributionIssueCases.id))
    .limit(250);

  const sourceKeys = cases.map((issue) => `employee-contribution-issue:${issue.id}`);
  const actionRows = sourceKeys.length
    ? await db.select({
        id: complianceActionTasks.id,
        organizationId: complianceActionTasks.organizationId,
        sourceKey: complianceActionTasks.sourceKey,
        severity: complianceActionTasks.severity,
        severityChangedAt: complianceActionTasks.severityChangedAt,
      }).from(complianceActionTasks).where(and(
        eq(complianceActionTasks.sourceType, "employee_contribution_issue"),
        inArray(complianceActionTasks.sourceKey, sourceKeys),
      ))
    : [];
  const actionByKey = new Map(
    actionRows.map((row) => [`${row.organizationId}|${row.sourceKey}`, row]),
  );

  let escalated = 0;
  let failures = 0;
  const errors: Array<{ caseId: number; error: string }> = [];
  const stageCounts = { stage1: 0, stage2: 0, stage3: 0 };

  for (const issue of cases) {
    try {
      const service = contributionCaseServiceStatus(issue, now);
      if (service.state !== "review_overdue" && service.state !== "resolution_overdue") continue;

      const event = service.state;
      const stage = contributionCaseEscalationStage(issue, now);
      if (stage === 0) continue;
      await notifyPayrollOfContributionCaseEscalation({
        issue,
        event,
        stage,
        actor: input.actor,
      });

      const sourceKey = `employee-contribution-issue:${issue.id}`;
      const action = actionByKey.get(`${issue.organizationId}|${sourceKey}`);
      await db.update(complianceActionTasks).set({
        severity: "danger",
        severityChangedAt:
          action && action.severity === "danger"
            ? action.severityChangedAt
            : now,
        dueDate: service.targetDate,
        lastDetectedAt: now,
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.organizationId, issue.organizationId),
        eq(complianceActionTasks.sourceType, "employee_contribution_issue"),
        eq(complianceActionTasks.sourceKey, sourceKey),
      ));

      escalated += 1;
      if (stage === 1) stageCounts.stage1 += 1;
      else if (stage === 2) stageCounts.stage2 += 1;
      else if (stage === 3) stageCounts.stage3 += 1;
    } catch (error) {
      failures += 1;
      errors.push({
        caseId: issue.id,
        error: error instanceof Error ? error.message : "Unknown contribution-case escalation error",
      });
    }
  }

  const payload = {
    at: now.toISOString(),
    checked: cases.length,
    escalated,
    failures,
    stageCounts,
    errors: errors.slice(0, 25),
  };

  await db.insert(schedulerState).values({
    jobName: SCHEDULE_JOB,
    lastRunAt: now,
    lastResult: payload,
  }).onConflictDoUpdate({
    target: schedulerState.jobName,
    set: {
      lastRunAt: now,
      lastResult: payload,
    },
  });

  return {
    ...payload,
    skipped: false as const,
  };
}
