import { and, eq, gte, lte, ne, notInArray } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  approvalDelegations, employees, hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps, performanceReviews,
  provisioningTasks, separationRecords,
} from "@/db/schema";
import { roleApproverMatchesRole } from "@/lib/delegation";
import {
  projectHcmDecisions, projectPeopleFollowUps, projectOperationalCases,
  type HcmHomeFollowUpInput,
} from "@/lib/hcm-people-home-projection";
import {
  boundedPeopleHomeRows, delegatedHcmAssigneeMatches,
  HCM_PEOPLE_HOME_CASE_LIMIT, HCM_PEOPLE_HOME_DECISION_LIMIT,
  HCM_PEOPLE_HOME_DELEGATION_LIMIT, HCM_PEOPLE_HOME_FOLLOWUP_LIMIT,
  unavailablePeopleHomeSlice, type HcmPeopleHomeSlice,
} from "@/lib/hcm-people-home-bounds";

type Viewer = { userId: number; name: string; role: string };

function delegationBusinessDate(now = new Date()) {
  // Match canDecide's date boundary; the owning endpoint rechecks each action.
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function sourceTimestamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Bounded source query and one batched delegation lookup, not N+1 canDecide. */
async function loadDecisions(organizationId: number, viewer: Viewer): Promise<HcmPeopleHomeSlice> {
  const date = delegationBusinessDate();
  const [candidateRows, delegations] = await Promise.all([
    db.select({
      id: hcmBusinessProcessInstanceSteps.id,
      stepType: hcmBusinessProcessInstanceSteps.stepType,
      assignee: hcmBusinessProcessInstanceSteps.assignee,
      dueAt: hcmBusinessProcessInstanceSteps.dueAt,
      processType: hcmBusinessProcessInstances.processType,
      initiatedByUserId: hcmBusinessProcessInstances.initiatedByUserId,
      employeeId: employees.id,
    }).from(hcmBusinessProcessInstanceSteps)
      .innerJoin(hcmBusinessProcessInstances, and(
        eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id),
        eq(hcmBusinessProcessInstances.organizationId, organizationId),
      ))
      .leftJoin(employees, and(
        eq(hcmBusinessProcessInstances.employeeId, employees.id),
        eq(employees.organizationId, organizationId),
      ))
      .where(and(
        eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
        eq(hcmBusinessProcessInstanceSteps.status, "pending"),
        eq(hcmBusinessProcessInstances.status, "in_progress"),
      ))
      .orderBy(hcmBusinessProcessInstanceSteps.dueAt, hcmBusinessProcessInstanceSteps.id)
      .limit(HCM_PEOPLE_HOME_DECISION_LIMIT + 1),
    db.select({
      fromApprover: approvalDelegations.fromApprover,
      toApprover: approvalDelegations.toApprover,
    }).from(approvalDelegations)
      .where(and(
        eq(approvalDelegations.organizationId, organizationId),
        eq(approvalDelegations.active, true),
        lte(approvalDelegations.startsOn, date),
        gte(approvalDelegations.endsOn, date),
      ))
      .orderBy(approvalDelegations.id)
      .limit(HCM_PEOPLE_HOME_DELEGATION_LIMIT + 1),
  ]);

  if (delegations.length > HCM_PEOPLE_HOME_DELEGATION_LIMIT) {
    throw new Error("Delegation preview ceiling reached");
  }
  // If a from-approver has conflicting simultaneous delegations, do not guess
  // which branch the governing source endpoint would authorize.
  const seenApprovers = new Set<string>();
  for (const row of delegations) {
    const key = row.fromApprover.toLowerCase();
    if (seenApprovers.has(key)) throw new Error("Ambiguous active delegation");
    seenApprovers.add(key);
  }

  const candidates = boundedPeopleHomeRows(candidateRows, HCM_PEOPLE_HOME_DECISION_LIMIT);
  const visible = candidates.rows.flatMap((row) => {
    if (row.stepType !== "approval" && row.stepType !== "review" && row.stepType !== "to_do") return [];
    if (!roleApproverMatchesRole(row.assignee, viewer.role)
      && !delegatedHcmAssigneeMatches(row.assignee, viewer.name, delegations)) return [];
    return [{
      id: row.id,
      stepType: row.stepType,
      processType: row.processType,
      dueAt: sourceTimestamp(row.dueAt),
      makerBlocked: (row.stepType === "approval" || row.stepType === "review")
        && row.initiatedByUserId === viewer.userId,
      employee: row.employeeId ? { id: row.employeeId } : null,
    }];
  });
  return {
    status: "ready",
    items: projectHcmDecisions(organizationId, visible),
    partial: candidates.hasMore,
    hasMore: candidates.hasMore,
  };
}

/**
 * Three source-specific previews, never the unbounded organization-wide
 * lifecycle loader. Other People Ops categories are omitted, so the preview
 * is always explicitly partial and never a complete workload count.
 */
async function loadFollowUps(organizationId: number): Promise<HcmPeopleHomeSlice> {
  const limit = HCM_PEOPLE_HOME_FOLLOWUP_LIMIT;
  const [onboarding, reviews, separations] = await Promise.all([
    db.select({ id: provisioningTasks.id, employeeId: employees.id })
      .from(provisioningTasks)
      .innerJoin(employees, and(
        eq(provisioningTasks.employeeId, employees.id),
        eq(employees.organizationId, organizationId),
      ))
      .where(and(
        eq(provisioningTasks.organizationId, organizationId),
        eq(provisioningTasks.kind, "onboarding"),
        eq(provisioningTasks.done, false),
        notInArray(employees.status, ["Separated", "Terminated", "Inactive"]),
      ))
      .orderBy(provisioningTasks.id).limit(limit + 1),
    db.select({ id: performanceReviews.id, employeeId: employees.id })
      .from(performanceReviews)
      .innerJoin(employees, and(
        eq(performanceReviews.employeeId, employees.id),
        eq(employees.organizationId, organizationId),
      ))
      .where(and(
        eq(performanceReviews.organizationId, organizationId),
        notInArray(performanceReviews.status, ["completed", "cancelled", "canceled", "archived", "rejected"]),
      ))
      .orderBy(performanceReviews.id).limit(limit + 1),
    db.select({
      id: separationRecords.id,
      employeeId: employees.id,
      lastDay: separationRecords.lastDay,
    }).from(separationRecords)
      .innerJoin(employees, and(
        eq(separationRecords.employeeId, employees.id),
        eq(employees.organizationId, organizationId),
      ))
      .where(and(
        eq(separationRecords.organizationId, organizationId),
        ne(separationRecords.status, "released"),
      ))
      .orderBy(separationRecords.id).limit(limit + 1),
  ]);

  const a = boundedPeopleHomeRows(onboarding, limit);
  const b = boundedPeopleHomeRows(reviews, limit);
  const c = boundedPeopleHomeRows(separations, limit);
  const preview: HcmHomeFollowUpInput[] = [
    ...a.rows.map((row) => ({
      id: "onboarding_task:" + row.id,
      employeeId: row.employeeId,
      category: "onboarding" as const,
      priority: "follow_up" as const,
      dueDate: null,
      page: "People" as const,
    })),
    ...b.rows.map((row) => ({
      id: "performance_review:" + row.id,
      employeeId: row.employeeId,
      category: "performance" as const,
      priority: "follow_up" as const,
      dueDate: null,
      page: "Performance" as const,
    })),
    ...c.rows.map((row) => ({
      id: "separation:" + row.id,
      employeeId: row.employeeId,
      category: "separation" as const,
      priority: "review" as const,
      dueDate: String(row.lastDay),
      page: "Separation" as const,
    })),
  ];
  return {
    status: "ready",
    items: projectPeopleFollowUps(organizationId, preview),
    partial: true,
    hasMore: a.hasMore || b.hasMore || c.hasMore,
  };
}

/** Case title/detail/owner PII/history never enter the query or response. */
async function loadCases(organizationId: number): Promise<HcmPeopleHomeSlice> {
  const result = await pool.query<{ id: number; status: string; dueAt: Date | null }>(
    'SELECT id, status, sla_due_at AS "dueAt" FROM automation_operational_cases ' +
    "WHERE organization_id = $1 AND status IN ('open','acknowledged') " +
    "ORDER BY sla_due_at ASC NULLS LAST, id ASC LIMIT $2",
    [organizationId, HCM_PEOPLE_HOME_CASE_LIMIT + 1],
  );
  const preview = boundedPeopleHomeRows(result.rows, HCM_PEOPLE_HOME_CASE_LIMIT);
  return {
    status: "ready",
    items: projectOperationalCases(organizationId, preview.rows.map((row) => ({
      id: row.id,
      status: row.status,
      dueAt: sourceTimestamp(row.dueAt),
    }))),
    partial: preview.hasMore,
    hasMore: preview.hasMore,
  };
}

export async function loadHcmPeopleHomeSources(organizationId: number, viewer: Viewer) {
  const [decisions, followUps, cases] = await Promise.allSettled([
    loadDecisions(organizationId, viewer),
    loadFollowUps(organizationId),
    loadCases(organizationId),
  ]);
  const show = (value: PromiseSettledResult<HcmPeopleHomeSlice>) =>
    value.status === "fulfilled" ? value.value : unavailablePeopleHomeSlice();
  return {
    decisions: show(decisions),
    followUps: show(followUps),
    cases: show(cases),
  };
}
