import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps } from "@/db/schema";
import { canDecide } from "@/lib/delegation";
import { loadPeopleOperationsInbox } from "@/lib/hcm-people-operations-inbox-server";

/**
 * A privacy-minimized read projection. Source modules retain all decisions and
 * writes. No employee identifiers, salaries, notes, bank data or government
 * numbers leave this projection.
 */
export type PeopleHomeItem = {
  key: string;
  title: string;
  category: string;
  dueAt: string | null;
  sourceUrl: string;
  blockedByMakerChecker?: boolean;
};

export type PeopleHomeSection = {
  state: "ready" | "unavailable";
  items: PeopleHomeItem[];
  hasMore: boolean;
  total: number | null;
};

export type PeopleHomeWorklist = {
  decisions: PeopleHomeSection;
  followUps: PeopleHomeSection;
  ownedCases: PeopleHomeSection;
};

const VISIBLE = 5;
const BP_CANDIDATE_LIMIT = 30;

const PROCESS_LABELS: Record<string, string> = {
  change_job: "Change job",
  transfer: "Transfer",
  promotion: "Promotion",
  compensation_change: "Compensation change",
  hire: "Hire",
  termination: "Termination",
  create_position: "Create position",
  close_position: "Close position",
};

const FOLLOWUP_LABELS: Record<string, string> = {
  employment: "Employment terms",
  onboarding: "Onboarding",
  position: "Position assignment",
  performance: "Performance cycle",
  separation: "Separation",
};

function missing(): PeopleHomeSection {
  return { state: "unavailable", items: [], hasMore: false, total: null };
}

function recordedDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function assignedHcmDecisions(
  organizationId: number,
  user: { id: number; name: string },
): Promise<PeopleHomeSection> {
  // Candidate ceiling is deliberate: assignment is checked by the same
  // authoritative canDecide resolver as the existing HCM BP inbox. Never
  // claim this preview is a complete census when that ceiling is hit.
  const candidates = await db.select({
    id: hcmBusinessProcessInstanceSteps.id,
    stepType: hcmBusinessProcessInstanceSteps.stepType,
    assignee: hcmBusinessProcessInstanceSteps.assignee,
    dueAt: hcmBusinessProcessInstanceSteps.dueAt,
    processType: hcmBusinessProcessInstances.processType,
    initiatedByUserId: hcmBusinessProcessInstances.initiatedByUserId,
  }).from(hcmBusinessProcessInstanceSteps)
    .innerJoin(
      hcmBusinessProcessInstances,
      eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id),
    )
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
      eq(hcmBusinessProcessInstances.organizationId, organizationId),
      eq(hcmBusinessProcessInstanceSteps.status, "pending"),
      eq(hcmBusinessProcessInstances.status, "in_progress"),
    ))
    .orderBy(hcmBusinessProcessInstanceSteps.dueAt, hcmBusinessProcessInstanceSteps.id)
    .limit(BP_CANDIDATE_LIMIT + 1);

  const items: PeopleHomeItem[] = [];
  for (const item of candidates.slice(0, BP_CANDIDATE_LIMIT)) {
    const decision = await canDecide(organizationId, item.assignee, user.name, user.id);
    if (!decision.permitted) continue;
    const ownRequest = item.initiatedByUserId === user.id;
    const stepName = item.stepType === "approval" ? "Approval" :
      item.stepType === "review" ? "Review" : "To-do";
    items.push({
      key: "bp:" + item.id,
      title: PROCESS_LABELS[item.processType] ?? "HCM business process",
      category: stepName,
      dueAt: recordedDate(item.dueAt),
      sourceUrl: "/app?organizationId=" + organizationId + "&workspacePage=People",
      blockedByMakerChecker: ownRequest && item.stepType !== "todo",
    });
  }

  return {
    state: "ready",
    items: items.slice(0, VISIBLE),
    hasMore: items.length > VISIBLE || candidates.length > BP_CANDIDATE_LIMIT,
    // A bounded assignment-filtered preview is not a complete task count.
    total: null,
  };
}

async function peopleOpsFollowUps(organizationId: number): Promise<PeopleHomeSection> {
  // Reuse the established People Ops source/evidence interpretation. Never
  // treat a source check as a decision assigned to this user.
  const evidence = await loadPeopleOperationsInbox(organizationId, {
    page: 1,
    pageSize: VISIBLE + 1,
  });
  return {
    state: "ready",
    items: evidence.rows.slice(0, VISIBLE).map((item) => ({
      key: "followup:" + item.id,
      title: FOLLOWUP_LABELS[item.category] ?? "HR source review",
      category: item.priority === "review" ? "Needs source review" :
        item.priority === "follow_up" ? "Follow up" : "Optional source check",
      dueAt: recordedDate(item.dueDate),
      sourceUrl: "/app?organizationId=" + organizationId + "&workspacePage=People",
    })),
    hasMore: evidence.filteredTotal > VISIBLE,
    total: evidence.summary.total,
  };
}

async function myOwnedCases(
  organizationId: number,
  userId: number,
): Promise<PeopleHomeSection> {
  // Only case ownership for the signed-in actor. Titles/details from the
  // operational case source are deliberately not projected to a homepage.
  const result = await pool.query(
    "SELECT id, status, sla_due_at AS \"dueAt\" FROM automation_operational_cases " +
    "WHERE organization_id = $1 AND assigned_owner_user_id = $2 AND status <> 'resolved' " +
    "ORDER BY sla_due_at ASC NULLS LAST, id DESC LIMIT $3",
    [organizationId, userId, VISIBLE + 1],
  );
  return {
    state: "ready",
    items: result.rows.slice(0, VISIBLE).map((item: { id: number; status: string; dueAt: Date | string | null }) => ({
      key: "case:" + item.id,
      title: "Assigned operational case",
      category: item.status === "acknowledged" ? "Acknowledged" : "Open",
      dueAt: recordedDate(item.dueAt),
      sourceUrl: "/hcm/work-items?organizationId=" + organizationId,
    })),
    hasMore: result.rows.length > VISIBLE,
    total: null,
  };
}

export async function loadPeopleHomeWorklist(
  organizationId: number,
  user: { id: number; name: string },
): Promise<PeopleHomeWorklist> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Valid HCM employer is required.");
  }
  const [decisions, followUps, ownedCases] = await Promise.allSettled([
    assignedHcmDecisions(organizationId, user),
    peopleOpsFollowUps(organizationId),
    myOwnedCases(organizationId, user.id),
  ]);

  // A source outage is never an empty or compliant queue.
  return {
    decisions: decisions.status === "fulfilled" ? decisions.value : missing(),
    followUps: followUps.status === "fulfilled" ? followUps.value : missing(),
    ownedCases: ownedCases.status === "fulfilled" ? ownedCases.value : missing(),
  };
}
