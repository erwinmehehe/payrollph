import type { ManagerDecisionItem, ManagerDecisionScope } from "./hcm-manager-decision-contract";

/**
 * Presentation-only filters. Server authorization and pagination remain authoritative.
 * Never use these counts to infer a tenant-wide approval backlog.
 */
export type ManagerDecisionQuickFilter = "all" | "overdue" | "upcoming" | "unscheduled";
export type ManagerDecisionOrder = "source" | "deadline";

export function managerDecisionPreferenceKey(organizationId: number, scope: ManagerDecisionScope): string {
  const unit = scope.kind === "unit" ? String(scope.orgUnitId) : "company";
  return "linaw.manager-decision-view.v1:" + organizationId + ":" + scope.kind + ":" + unit;
}

export function readManagerDecisionPreferences(value: unknown): {
  filter: ManagerDecisionQuickFilter;
  order: ManagerDecisionOrder;
} {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const filter = record.filter;
  const order = record.order;
  return {
    filter: filter === "overdue" || filter === "upcoming" || filter === "unscheduled"
      ? filter : "all",
    order: order === "deadline" ? order : "source",
  };
}

export function selectManagerDecisionItems(
  items: readonly ManagerDecisionItem[],
  filter: ManagerDecisionQuickFilter,
  order: ManagerDecisionOrder,
): ManagerDecisionItem[] {
  const filtered = items.filter((item) => filter === "all" || item.dueState === filter);
  if (order !== "deadline") return filtered;
  // Stable source order on equal/unknown due dates, never alter the verified payload.
  return filtered.map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aDue = a.item.dueAt ? Date.parse(a.item.dueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.item.dueAt ? Date.parse(b.item.dueAt) : Number.POSITIVE_INFINITY;
      const aTime = Number.isFinite(aDue) ? aDue : Number.POSITIVE_INFINITY;
      const bTime = Number.isFinite(bDue) ? bDue : Number.POSITIVE_INFINITY;
      return aTime - bTime || a.index - b.index;
    })
    .map(({ item }) => item);
}