import type {
  ManagerDecisionPage, ManagerDecisionItem, DecisionSource, ManagerDecisionScope,
} from "@/lib/hcm-manager-decision-contract";

const sources = ["hcm", "leave", "overtime"];
const steps = ["approval", "review", "to_do"];
const assignments = ["role", "named", "delegated"];
const dueStates = ["overdue", "upcoming", "unscheduled"];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nullablePositive = (value: unknown) => value === null || positive(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

function verifiedItem(value: unknown, source: DecisionSource, cursor: number | null): value is ManagerDecisionItem {
  if (!object(value)) return false;
  if (!positive(value.id) || (cursor !== null && value.id >= cursor)
      || value.source !== source || !positive(value.sourceRecordId)
      || !nullablePositive(value.approvalTaskId)
      || typeof value.processType !== "string" || !steps.includes(String(value.stepType))
      || value.status !== "pending" || typeof value.priority !== "string"
      || !assignments.includes(String(value.assignment))
      || !dueStates.includes(String(value.dueState))
      || (value.dueAt !== null && !timestamp(value.dueAt))) return false;
  if ((value.dueState === "unscheduled") !== (value.dueAt === null)) return false;
  if (value.employee !== null) {
    if (!object(value.employee) || !positive(value.employee.id)
        || typeof value.employee.employeeNo !== "string"
        || typeof value.employee.name !== "string") return false;
  }
  return true;
}

/** Proof for a bounded, pre-authorized preview only; it never authorizes mutation. */
export function readVerifiedManagerDecisionPage(
  ok: boolean, payload: unknown, employer: number, source: DecisionSource,
  beforeId: number | null, expectedScope: ManagerDecisionScope,
): ManagerDecisionPage | null {
  if (!ok || !positive(employer) || (beforeId !== null && !positive(beforeId))
      || !sources.includes(source) || !object(payload)
      || payload.organizationId !== employer || payload.source !== source
      || !object(payload.scope) || !object(payload.page) || !object(payload.totals)
      || !timestamp(payload.observedAt) || typeof payload.notice !== "string") return null;
  const scope = payload.scope;
  if (!((scope.kind === "company" && scope.orgUnitId === null)
      || (scope.kind === "unit" && positive(scope.orgUnitId)))) return null;
  if (!object(expectedScope) ||
      !((expectedScope.kind === "company" && expectedScope.orgUnitId === null)
        || (expectedScope.kind === "unit" && positive(expectedScope.orgUnitId))) ||
      scope.kind !== expectedScope.kind || scope.orgUnitId !== expectedScope.orgUnitId) return null;
  const page = payload.page;
  if (page.size !== 20 || typeof page.hasMore !== "boolean"
      || !Array.isArray(payload.items) || payload.items.length > 20
      || !payload.items.every((item) => verifiedItem(item, source, beforeId))) return null;
  const ids = payload.items.map((item: ManagerDecisionItem) => item.id);
  if (new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && id >= ids[index - 1])) return null;
  // Pagination scans raw candidates before assignment filtering; a page can
  // have zero visible rows and still have older candidates to fetch.
  if (page.hasMore) {
    if (!positive(page.nextCursor) ||
        (beforeId !== null && page.nextCursor >= beforeId) ||
        (ids.length > 0 && page.nextCursor > ids[ids.length - 1])) return null;
  } else if (page.nextCursor !== null) return null;
  if (payload.totals.assignedItemsThisPage !== payload.items.length
      || payload.totals.overdueItemsThisPage !== payload.items.filter(
        (item: ManagerDecisionItem) => item.dueState === "overdue",
      ).length) return null;
  return payload as ManagerDecisionPage;
}