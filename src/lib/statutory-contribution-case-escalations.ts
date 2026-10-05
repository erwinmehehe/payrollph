import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  statutoryContributionIssueCases,
} from "@/db/schema";
import { contributionCaseServiceStatus } from "@/lib/statutory-contribution-case-aging";
import { notifyPayrollOfContributionCaseEscalation } from "@/lib/statutory-contribution-case-notifications";

const RUN_EVERY_MS = 60 * 60 * 1000;
let nextRunAt = 0;

export async function runScheduledContributionCaseEscalations(input: {
  actor: string;
  now?: Date;
  force?: boolean;
}) {
  const now = input.now ?? new Date();
  if (!input.force && now.getTime() < nextRunAt) {
    return { checked: 0, escalated: 0, skipped: true as const };
  }
  nextRunAt = now.getTime() + RUN_EVERY_MS;

  const cases = await db.select()
    .from(statutoryContributionIssueCases)
    .where(inArray(statutoryContributionIssueCases.status, ["open", "in_review"]))
    .orderBy(asc(statutoryContributionIssueCases.createdAt), asc(statutoryContributionIssueCases.id))
    .limit(250);

  let escalated = 0;
  for (const issue of cases) {
    const service = contributionCaseServiceStatus(issue, now);
    if (service.state !== "review_overdue" && service.state !== "resolution_overdue") continue;

    const event = service.state;
    await notifyPayrollOfContributionCaseEscalation({
      issue,
      event,
      actor: input.actor,
    });

    await db.update(complianceActionTasks).set({
      severity: "danger",
      dueDate: service.targetDate,
      lastDetectedAt: now,
      updatedAt: now,
    }).where(inArray(complianceActionTasks.sourceKey, [
      `employee-contribution-issue:${issue.id}`,
    ]));

    escalated += 1;
  }

  return {
    checked: cases.length,
    escalated,
    skipped: false as const,
  };
}
