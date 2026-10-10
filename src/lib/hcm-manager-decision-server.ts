import {
  and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  approvalDelegations, approvalTasks, employees, hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps, leaveRequests, orgUnits, overtimeRequests,
  userOrganizations, users,
} from "@/db/schema";
import { canDecide, roleApproverMatchesRole } from "@/lib/delegation";
import {
  projectDueState, summarizeDecisionPage,
  type AssignmentKind, type DecisionSource, type ManagerDecisionItem,
  type ManagerDecisionPage, type ManagerDecisionScope,
} from "@/lib/hcm-manager-decision-contract";

const PAGE_SIZE = 20;
const MAX_DELEGATIONS = 150;
const SAFE_HCM_PROCESS_TYPES = [
  "change_job", "transfer", "promotion", "hire", "create_position", "close_position",
] as const;

type EmployeePreview = { id: number; employeeNo: string; name: string };
type Candidate = {
  id: number;
  source: DecisionSource;
  sourceRecordId: number;
  approvalTaskId: number | null;
  processType: string;
  stepType: "approval" | "review" | "to_do";
  assignee: string;
  priority: string;
  dueAt: Date | null;
  employee: EmployeePreview | null;
  makerId: number | null;
};

export class DecisionInboxScopeError extends Error {
  constructor() { super("The assigned unit is not active in this employer."); }
}
export class DecisionInboxSourceLimitError extends Error {
  constructor() { super("Delegation evidence exceeds the bounded source limit."); }
}
function dateInManila(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const p = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return [p("year"), p("month"), p("day")].join("-");
}
function person(id: number, employeeNo: string, first: string, last: string): EmployeePreview {
  return { id, employeeNo, name: [first, last].filter(Boolean).join(" ") };
}

/** Unit scope is an actual active same-tenant unit, never just a browser ID. */
async function requireActiveUnit(organizationId: number, scope: ManagerDecisionScope, now: Date) {
  if (scope.kind !== "unit") return;
  const today = dateInManila(now);
  const [match] = await db.select({ id: orgUnits.id }).from(orgUnits)
    .where(and(
      eq(orgUnits.id, scope.orgUnitId),
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.active, true),
      or(isNull(orgUnits.effectiveFrom), lte(orgUnits.effectiveFrom, today)),
      or(isNull(orgUnits.effectiveUntil), gte(orgUnits.effectiveUntil, today)),
    )).limit(1);
  if (!match) throw new DecisionInboxScopeError();
}

/**
 * Candidate labels are a safe SUPERSET of valid role/name/delegated grants.
 * Every distinct assignee is still rechecked against canDecide. No unbounded
 * delegation scan, and duplicate active display names cannot grant personal
 * approval visibility.
 */
async function candidateApprovers(organizationId: number, userId: number, name: string, role: string, now: Date) {
  const normalizedName = name.trim().toLowerCase();
  // Superset around Manila/UTC boundaries; canDecide checks actual dates.
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const [grants, names] = await Promise.all([
    db.select({ fromApprover: approvalDelegations.fromApprover })
      .from(approvalDelegations).where(and(
        eq(approvalDelegations.organizationId, organizationId),
        eq(approvalDelegations.active, true),
        lte(approvalDelegations.startsOn, tomorrow),
        gte(approvalDelegations.endsOn, yesterday),
      )).orderBy(approvalDelegations.id).limit(MAX_DELEGATIONS + 1),
    db.select({ userId: users.id }).from(userOrganizations)
      .innerJoin(users, and(
        eq(users.id, userOrganizations.userId),
        eq(users.active, true),
      ))
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
        sql`lower(trim(${users.name})) = ${normalizedName}`,
      )).limit(2),
  ]);
  if (grants.length > MAX_DELEGATIONS) throw new DecisionInboxSourceLimitError();
  const nameUnique = names.length === 1 && names[0].userId === userId;
  const roles = ["role:hr", "role:finance", "role:owner", "role:manager"]
    .filter((label) => roleApproverMatchesRole(label, role));
  const candidates = new Set<string>([
    ...(nameUnique && normalizedName ? [normalizedName] : []),
    ...roles,
    ...grants.map((grant) => grant.fromApprover.trim().toLowerCase()),
  ]);
  return { nameUnique, candidates: [...candidates].filter(Boolean) };
}

async function loadHcmCandidates(
  organizationId: number, scope: ManagerDecisionScope, before: number | null, assignees: string[],
): Promise<Candidate[]> {
  const step = hcmBusinessProcessInstanceSteps;
  const instance = hcmBusinessProcessInstances;
  const worker = employees;
  const task = approvalTasks;
  const conditions = [
    eq(step.organizationId, organizationId),
    eq(step.status, "pending"),
    eq(instance.status, "in_progress"),
    eq(step.stepIndex, instance.currentStepIndex),
    inArray(instance.processType, [...SAFE_HCM_PROCESS_TYPES]),
    inArray(sql<string>`lower(trim(${step.assignee}))`, assignees),
    or(isNull(instance.employeeId), isNotNull(worker.id))!,
    or(
      ne(step.stepType, "approval"),
      and(
        isNotNull(task.id), eq(task.status, "Pending"),
        isNull(task.payrollRunId),
        sql`lower(trim(${task.approver})) = lower(trim(${step.assignee}))`,
      ),
    )!,
  ];
  if (before !== null) conditions.push(lt(step.id, before));
  // Scoped managers see only verified workers assigned to their exact unit;
  // position-only business processes are not implicitly manager-owned.
  if (scope.kind === "unit") conditions.push(eq(worker.orgUnitId, scope.orgUnitId));
  const rows = await db.select({
    id: step.id, stepType: step.stepType,
    approver: step.assignee, priority: step.priority, dueAt: step.dueAt,
    approvalTaskId: step.approvalTaskId, instanceId: instance.id,
    processType: instance.processType, makerId: instance.initiatedByUserId,
    workerId: worker.id, employeeNo: worker.employeeNo,
    first: worker.firstName, last: worker.lastName,
  }).from(step)
    .innerJoin(instance, and(eq(instance.id, step.instanceId), eq(instance.organizationId, organizationId)))
    .leftJoin(worker, and(eq(worker.id, instance.employeeId), eq(worker.organizationId, organizationId)))
    .leftJoin(task, and(eq(task.id, step.approvalTaskId), eq(task.organizationId, organizationId)))
    .where(and(...conditions))
    .orderBy(desc(step.id)).limit(PAGE_SIZE + 1);

  return rows.map((row) => ({
    id: row.id, source: "hcm" as const, sourceRecordId: row.instanceId,
    approvalTaskId: row.approvalTaskId, processType: row.processType,
    stepType: row.stepType as Candidate["stepType"], assignee: row.approver,
    priority: row.priority, dueAt: row.dueAt,
    employee: row.workerId === null ? null :
      person(row.workerId, row.employeeNo!, row.first!, row.last!),
    makerId: row.makerId,
  }));
}

async function loadLeaveCandidates(
  organizationId: number, scope: ManagerDecisionScope, before: number | null, assignees: string[],
): Promise<Candidate[]> {
  const request = leaveRequests, task = approvalTasks, worker = employees;
  const conditions = [
    eq(request.organizationId, organizationId),
    eq(request.status, "Pending"), eq(task.status, "Pending"),
    isNull(task.payrollRunId),
    inArray(sql<string>`lower(trim(${task.approver}))`, assignees),
  ];
  if (before !== null) conditions.push(lt(request.id, before));
  if (scope.kind === "unit") conditions.push(eq(worker.orgUnitId, scope.orgUnitId));
  const rows = await db.select({
    id: request.id, taskId: task.id,
    approver: task.approver, priority: task.priority,
    employeeId: worker.id, employeeNo: worker.employeeNo,
    first: worker.firstName, last: worker.lastName,
  }).from(request)
    .innerJoin(task, and(eq(task.id, request.approvalTaskId), eq(task.organizationId, organizationId)))
    .innerJoin(worker, and(eq(worker.id, request.employeeId), eq(worker.organizationId, organizationId)))
    .where(and(...conditions)).orderBy(desc(request.id)).limit(PAGE_SIZE + 1);
  return rows.map((row) => ({
    id: row.id, source: "leave" as const, sourceRecordId: row.id,
    approvalTaskId: row.taskId, processType: "Leave request",
    stepType: "approval" as const, assignee: row.approver,
    priority: row.priority, dueAt: null,
    employee: person(row.employeeId, row.employeeNo, row.first, row.last),
    makerId: null,
  }));
}

async function loadOvertimeCandidates(
  organizationId: number, scope: ManagerDecisionScope, before: number | null, assignees: string[],
): Promise<Candidate[]> {
  const request = overtimeRequests, task = approvalTasks, worker = employees;
  const conditions = [
    eq(request.organizationId, organizationId),
    eq(request.status, "pending"), eq(task.status, "Pending"),
    isNull(task.payrollRunId),
    inArray(sql<string>`lower(trim(${task.approver}))`, assignees),
  ];
  if (before !== null) conditions.push(lt(request.id, before));
  if (scope.kind === "unit") conditions.push(eq(worker.orgUnitId, scope.orgUnitId));
  const rows = await db.select({
    id: request.id, taskId: task.id, approver: task.approver,
    priority: task.priority, requestedByUserId: request.requestedByUserId,
    employeeId: worker.id, employeeNo: worker.employeeNo,
    first: worker.firstName, last: worker.lastName,
  }).from(request)
    .innerJoin(task, and(eq(task.id, request.approvalTaskId), eq(task.organizationId, organizationId)))
    .innerJoin(worker, and(eq(worker.id, request.employeeId), eq(worker.organizationId, organizationId)))
    .where(and(...conditions)).orderBy(desc(request.id)).limit(PAGE_SIZE + 1);
  return rows.map((row) => ({
    id: row.id, source: "overtime" as const, sourceRecordId: row.id,
    approvalTaskId: row.taskId, processType: "Overtime request",
    stepType: "approval" as const, assignee: row.approver,
    priority: row.priority, dueAt: null,
    employee: person(row.employeeId, row.employeeNo, row.first, row.last),
    makerId: row.requestedByUserId,
  }));
}

/** Source/tenant filters, delegation and maker controls are server-only.
 * A pending team request is not automatically this user's decision.
 */
export async function loadManagerDecisionPage(input: {
  organizationId: number; userId: number; userName: string; viewerRole: string;
  scope: ManagerDecisionScope; source: DecisionSource; before: number | null;
}): Promise<ManagerDecisionPage> {
  const { organizationId, userId, userName, viewerRole, scope, source, before } = input;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(userId) || userId <= 0 ||
      (before !== null && (!Number.isSafeInteger(before) || before <= 0))) {
    throw new DecisionInboxScopeError();
  }
  const now = new Date();
  await requireActiveUnit(organizationId, scope, now);
  const { nameUnique, candidates } = await candidateApprovers(
    organizationId, userId, userName, viewerRole, now,
  );
  const observedAt = now.toISOString();
  if (candidates.length === 0) {
    return {
      organizationId, source, scope, observedAt, items: [],
      page: { size: PAGE_SIZE, hasMore: false, nextCursor: null },
      totals: { assignedItemsThisPage: 0, overdueItemsThisPage: 0 },
      notice: "No unique actor or role assignment evidence. This is not a tenant-wide approval census.",
    };
  }

  const rows = source === "hcm"
    ? await loadHcmCandidates(organizationId, scope, before, candidates)
    : source === "leave"
      ? await loadLeaveCandidates(organizationId, scope, before, candidates)
      : await loadOvertimeCandidates(organizationId, scope, before, candidates);

  const page = rows.slice(0, PAGE_SIZE);
  const evaluations = new Map<string, Promise<AssignmentKind | null>>();
  const currentName = userName.trim().toLowerCase();
  const evaluate = (assignee: string): Promise<AssignmentKind | null> => {
    const key = assignee.trim().toLowerCase();
    if (!evaluations.has(key)) {
      evaluations.set(key, (async (): Promise<AssignmentKind | null> => {
        const permission = await canDecide(organizationId, assignee, userName, userId);
        if (!permission.permitted) return null;
        if (permission.roleMatched) return "role";
        // Identical active display names are not individual identity proof.
        if (!nameUnique) return null;
        if (key === currentName) return "named";
        return permission.delegated && permission.allowed.includes(currentName)
          ? "delegated" : null;
      })());
    }
    return evaluations.get(key)!;
  };
  const authorized = await Promise.all(page.map(async (row) => {
    if (row.makerId === userId && row.stepType !== "to_do") return null;
    const assignment = await evaluate(row.assignee);
    if (!assignment) return null;
    const due = projectDueState(row.dueAt, now);
    return {
      id: row.id, source: row.source, sourceRecordId: row.sourceRecordId,
      approvalTaskId: row.approvalTaskId, processType: row.processType,
      stepType: row.stepType, status: "pending" as const,
      priority: row.priority, assignment,
      dueAt: due.dueAt, dueState: due.dueState,
      employee: row.employee,
    } satisfies ManagerDecisionItem;
  }));
  const items = authorized.filter((item): item is ManagerDecisionItem => item !== null);
  const hasMore = rows.length > PAGE_SIZE;
  return {
    organizationId, source, scope, observedAt, items,
    page: { size: PAGE_SIZE, hasMore, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null },
    totals: summarizeDecisionPage(items),
    notice: "This is one bounded source-candidate page, not every outstanding decision. Only revalidated assignees are displayed. Final approval/delegation authorization remains with the owning workflow.",
  };
}
