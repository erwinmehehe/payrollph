import { and, eq, inArray, ne } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
  hcmLifecycleNotificationTasks,
  provisioningTasks,
  employees,
} from "@/db/schema";
import { loadPeopleHomeAssigneePermissions } from "@/lib/delegation";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { canOpenPeopleHome, peopleHomeEnabledForOrganization } from "@/lib/hcm-people-home-scope";
import { peopleEmployeeFocusHref } from "@/lib/hcm-people-employee-focus";
import { recordedPeopleHomeInstant as recordedInstant } from "@/lib/hcm-people-home-instant";

/**
 * Source-minimized, server-only People Home projection. It provides previews,
 * never decisions or complete census counts. No source free text is selected.
 */
export type PeopleHomeItem = {
  key: string;
  source: "hcm_business_process" | "lifecycle_notification" | "provisioning" | "operational_case";
  sourceId: number;
  tenantId: number;
  subjectEmployeeId?: number;
  title: string;
  category: string;
  status: "pending" | "review" | "follow_up" | "source_check" | "open" | "acknowledged";
  dueAt: string | null;
  sourceDate: string | null;
  sourceUrl: string;
  incompleteEvidence: boolean;
  blockedByMakerChecker?: boolean;
};


/**
 * Screen-reader link lists need a record-specific name when the visible
 * action text repeats. Titles here are controlled labels from this minimized
 * read model; the source-specific numeric reference distinguishes siblings
 * without exposing employee names, notes, or other private source details.
 */
const PEOPLE_HOME_SOURCE_REF: Record<PeopleHomeItem["source"], string> = {
  hcm_business_process: "HCM step",
  lifecycle_notification: "Lifecycle notification",
  provisioning: "Provisioning task",
  operational_case: "Operational case",
};

export function peopleHomeSourceLinkAccessibleName(
  item: Pick<PeopleHomeItem, "source" | "sourceId" | "title">,
): string {
  const action = item.source === "provisioning"
    ? "Open worker in People" : "Open source workflow";
  return `${action}: ${item.title} (${PEOPLE_HOME_SOURCE_REF[item.source]} ${item.sourceId})`;
}

export type PeopleHomeSection = {
  state: "ready" | "unavailable";
  items: PeopleHomeItem[];
  hasMore: boolean;
  partial: boolean;
  total: number | null;
  /** One of the independent read sources failed; results are incomplete. */
  sourceUnavailable?: boolean;
};

export type PeopleHomeWorklist = {
  decisions: PeopleHomeSection;
  followUps: PeopleHomeSection;
  ownedCases: PeopleHomeSection;
};

const VISIBLE = 5;
const BP_CANDIDATE_LIMIT = 30;
const FOLLOWUP_SOURCE_LIMIT = 6;

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

function missing(): PeopleHomeSection {
  return { state: "unavailable", items: [], hasMore: false, partial: true, total: null };
}

function recordedSourceDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value : null;
}

async function assignedHcmDecisions(
  organizationId: number,
  user: { id: number; name: string },
): Promise<PeopleHomeSection> {
  // Bounded candidate scan with no names, private evidence, or snapshots.
  const candidates = await db.select({
    id: hcmBusinessProcessInstanceSteps.id,
    stepType: hcmBusinessProcessInstanceSteps.stepType,
    assignee: hcmBusinessProcessInstanceSteps.assignee,
    dueAt: hcmBusinessProcessInstanceSteps.dueAt,
    processType: hcmBusinessProcessInstances.processType,
    initiatedByUserId: hcmBusinessProcessInstances.initiatedByUserId,
  }).from(hcmBusinessProcessInstanceSteps)
    .innerJoin(hcmBusinessProcessInstances,
      eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id))
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
      eq(hcmBusinessProcessInstances.organizationId, organizationId),
      eq(hcmBusinessProcessInstanceSteps.status, "pending"),
      eq(hcmBusinessProcessInstances.status, "in_progress"),
    ))
    .orderBy(hcmBusinessProcessInstanceSteps.dueAt, hcmBusinessProcessInstanceSteps.id)
    .limit(BP_CANDIDATE_LIMIT + 1);

  const scanned = candidates.slice(0, BP_CANDIDATE_LIMIT);
  const permissions = await loadPeopleHomeAssigneePermissions(
    organizationId, Array.from(new Set(scanned.map((item) => item.assignee))), user,
  );
  const items: PeopleHomeItem[] = [];
  for (const item of scanned) {
    if (!permissions.get(item.assignee)) continue;
    const makerBlocked = item.initiatedByUserId === user.id &&
      (item.stepType === "approval" || item.stepType === "review");
    items.push({
      key: "bp:" + item.id,
      source: "hcm_business_process",
      sourceId: item.id,
      tenantId: organizationId,
      title: PROCESS_LABELS[item.processType] ?? "HCM business process",
      category: item.stepType === "approval" ? "Approval" :
        item.stepType === "review" ? "Review" : "To-do",
      status: item.stepType === "review" ? "review" : "pending",
      dueAt: recordedInstant(item.dueAt),
      sourceDate: null,
      sourceUrl: "/app?organizationId=" + organizationId + "&workspacePage=People&hcmPanel=bp",
      incompleteEvidence: false,
      blockedByMakerChecker: makerBlocked,
    });
  }
  const partial = candidates.length > BP_CANDIDATE_LIMIT;
  return {
    state: "ready",
    items: items.slice(0, VISIBLE),
    hasMore: items.length > VISIBLE || partial,
    partial,
    // A bounded assignment-filtered preview is not a complete task count.
    total: null,
  };
}

/**
 * Only outstanding lifecycle notifications and unfinished provisioning rows.
 * Other People Ops categories are not queried here; use the authoritative
 * People Operations Inbox for all employment/performance/separation findings.
 * Each source read is independently capped before constructing the preview.
 */
async function peopleOpsFollowUps(organizationId: number): Promise<PeopleHomeSection> {
  const [lifecycle, provisioning] = await Promise.allSettled([
    db.select({
      id: hcmLifecycleNotificationTasks.id,
      dueDate: hcmLifecycleNotificationTasks.dueDate,
      severity: hcmLifecycleNotificationTasks.severity,
    }).from(hcmLifecycleNotificationTasks)
      .where(and(
        eq(hcmLifecycleNotificationTasks.organizationId, organizationId),
        ne(hcmLifecycleNotificationTasks.status, "resolved"),
      ))
      .orderBy(hcmLifecycleNotificationTasks.dueDate, hcmLifecycleNotificationTasks.id)
      .limit(FOLLOWUP_SOURCE_LIMIT + 1),
    db.select({
      id: provisioningTasks.id,
      kind: provisioningTasks.kind,
      employeeId: provisioningTasks.employeeId,
    }).from(provisioningTasks)
      // A task's employee FK by itself is not proof of legal-employer ownership.
      .innerJoin(employees, and(
        eq(provisioningTasks.employeeId, employees.id),
        eq(employees.organizationId, organizationId),
      ))
      .where(and(
        eq(provisioningTasks.organizationId, organizationId),
        eq(provisioningTasks.done, false),
        inArray(provisioningTasks.kind, ["onboarding", "offboarding"]),
      ))
      .orderBy(provisioningTasks.id)
      .limit(FOLLOWUP_SOURCE_LIMIT + 1),
  ]);

  return projectPeopleHomeFollowUpSources(organizationId, lifecycle, provisioning);
}

type LifecycleFollowUpRow = {
  id: number;
  dueDate: string | null;
  severity: string;
};
type ProvisioningFollowUpRow = {
  id: number;
  kind: string;
  employeeId: number;
};

/**
 * A failed lifecycle query must not erase verified provisioning rows (or
 * vice versa). Both failed is unavailable, never a verified empty list.
 * Failed-source errors are deliberately not copied into the response.
 */
export function projectPeopleHomeFollowUpSources(
  organizationId: number,
  lifecycleResult: PromiseSettledResult<LifecycleFollowUpRow[]>,
  provisioningResult: PromiseSettledResult<ProvisioningFollowUpRow[]>,
): PeopleHomeSection {
  if (lifecycleResult.status === "rejected" && provisioningResult.status === "rejected") {
    return missing();
  }
  const lifecycle = lifecycleResult.status === "fulfilled" ? lifecycleResult.value : [];
  const provisioning = provisioningResult.status === "fulfilled" ? provisioningResult.value : [];
  const sourceUnavailable = lifecycleResult.status === "rejected"
    || provisioningResult.status === "rejected";

  const rows: PeopleHomeItem[] = [
    ...lifecycle.slice(0, FOLLOWUP_SOURCE_LIMIT).map((item) => ({
      key: "lifecycle:" + item.id,
      source: "lifecycle_notification" as const,
      sourceId: item.id,
      tenantId: organizationId,
      title: "Employment lifecycle follow-up",
      category: item.severity === "critical" ? "Needs source review" : "Follow up",
      status: (item.severity === "critical" ? "review" : "follow_up") as "review" | "follow_up",
      dueAt: null,
      sourceDate: recordedSourceDate(item.dueDate),
      sourceUrl: "/app?organizationId=" + organizationId + "&workspacePage=People",
      incompleteEvidence: true,
    })),
    ...provisioning.slice(0, FOLLOWUP_SOURCE_LIMIT).map((item) => ({
      key: "provisioning:" + item.id,
      source: "provisioning" as const,
      sourceId: item.id,
      tenantId: organizationId,
      subjectEmployeeId: item.employeeId,
      title: item.kind === "offboarding" ? "Offboarding checklist" : "Onboarding checklist",
      category: "Follow up",
      status: "follow_up" as const,
      dueAt: null,
      sourceDate: null,
      sourceUrl: peopleEmployeeFocusHref(organizationId, item.employeeId) ??
        "/app?organizationId=" + organizationId + "&workspacePage=People",
      incompleteEvidence: true,
    })),
  ];
  rows.sort((a, b) =>
    (a.sourceDate ?? "9999-12-31").localeCompare(b.sourceDate ?? "9999-12-31") ||
    a.key.localeCompare(b.key));

  // Always partial: other People Operations Inbox categories are out of scope.
  // The UI must ALSO distinguish a failed sub-source from a true empty preview.
  return {
    state: "ready",
    items: rows.slice(0, VISIBLE),
    hasMore: rows.length > VISIBLE ||
      lifecycle.length > FOLLOWUP_SOURCE_LIMIT || provisioning.length > FOLLOWUP_SOURCE_LIMIT,
    partial: true,
    total: null,
    sourceUnavailable,
  };
}

async function myOwnedCases(
  organizationId: number,
  userId: number,
): Promise<PeopleHomeSection> {
  const result = await pool.query(
    "SELECT id, status, sla_due_at AS \"dueAt\" FROM automation_operational_cases " +
    "WHERE organization_id = $1 AND assigned_owner_user_id = $2 " +
    "AND status IN ('open', 'acknowledged') " +
    "ORDER BY sla_due_at ASC NULLS LAST, id DESC LIMIT $3",
    [organizationId, userId, VISIBLE + 1],
  );
  return {
    state: "ready",
    items: result.rows.slice(0, VISIBLE).map(
      (item: { id: number; status: string; dueAt: Date | string | null }) => ({
        key: "case:" + item.id,
        source: "operational_case" as const,
        sourceId: item.id,
        tenantId: organizationId,
        title: "Assigned operational case",
        category: item.status === "acknowledged" ? "Acknowledged" : "Open",
        status: item.status === "acknowledged" ? "acknowledged" as const : "open" as const,
        dueAt: recordedInstant(item.dueAt),
        sourceDate: null,
        sourceUrl: "/hcm/work-items?organizationId=" + organizationId,
        incompleteEvidence: false,
      }),
    ),
    hasMore: result.rows.length > VISIBLE,
    partial: result.rows.length > VISIBLE,
    total: null,
  };
}

/**
 * Independently settle each authoritative source. A failure must not erase
 * valid results from the other sources or masquerade as an empty inbox.
 * Source exceptions and free text never enter the returned read model.
 */
export async function settlePeopleHomeSourcePreviews(
  decisionsSource: Promise<PeopleHomeSection>,
  followUpsSource: Promise<PeopleHomeSection>,
  ownedCasesSource: Promise<PeopleHomeSection>,
): Promise<PeopleHomeWorklist> {
  const [decisions, followUps, ownedCases] = await Promise.allSettled([
    decisionsSource, followUpsSource, ownedCasesSource,
  ]);
  return {
    decisions: decisions.status === "fulfilled" ? decisions.value : missing(),
    followUps: followUps.status === "fulfilled" ? followUps.value : missing(),
    ownedCases: ownedCases.status === "fulfilled" ? ownedCases.value : missing(),
  };
}

/** Caller must first enforce session, employer, People-admin RBAC and pilot flag. */
export async function loadPeopleHomeWorklist(
  organizationId: number,
  user: { id: number; name: string },
): Promise<PeopleHomeWorklist> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("Valid HCM employer and actor are required.");
  }
  if (!peopleHomeEnabledForOrganization(organizationId)) {
    throw new Error("People Home pilot is disabled for this employer.");
  }
  // Guard again at the projection boundary: a future caller cannot bypass
  // company-wide People administration, custom deny permissions, or SSO.
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !canOpenPeopleHome(access)) {
    throw new Error("People Home access is not authorized.");
  }
  return settlePeopleHomeSourcePreviews(
    assignedHcmDecisions(organizationId, user),
    peopleOpsFollowUps(organizationId),
    myOwnedCases(organizationId, user.id),
  );
}
