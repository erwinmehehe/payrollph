import type { Worker360Summary } from "./hcm-worker-360-contract";
import { validWorker360Date } from "./hcm-worker-360-projection";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function businessDate(value: unknown): value is string {
  return typeof value === "string" && validWorker360Date(value);
}

function sourceTimestamp(value: unknown): value is string {
  return typeof value === "string" && businessDate(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/**
 * Worker 360 is an optional, read-only HR source. A successful HTTP response
 * must be internally coherent before the client renders personnel history.
 * This is defense-in-depth: the server remains responsible for access control.
 */
export function isValidWorker360Response(
  value: unknown,
  organizationId: number,
  employeeId: number,
  asOfDate: string,
): value is Worker360Summary {
  const root = object(value);
  const worker = object(root?.worker);
  const primary = object(root?.primaryAssignment);
  const selection = object(primary?.selection);
  const events = object(root?.employmentEvents);
  const preview = object(events?.preview);

  if (!positiveId(organizationId) || !positiveId(employeeId) || !businessDate(asOfDate) ||
      !root || root.tenantId !== organizationId || root.employeeId !== employeeId ||
      root.asOfDate !== asOfDate || !sourceTimestamp(root.observedAt) ||
      !worker || worker.source !== "employees" || worker.id !== employeeId ||
      typeof worker.employeeNo !== "string" || typeof worker.name !== "string" ||
      typeof worker.currentTitle !== "string" || typeof worker.currentStatus !== "string" ||
      !businessDate(worker.startedOn) ||
      !primary || primary.source !== "position_assignments" || !selection ||
      !events || events.source !== "worker_employment_events" || !preview ||
      !Array.isArray(preview.items) || preview.items.length > 25 ||
      typeof preview.hasMore !== "boolean" || preview.partial !== preview.hasMore) return false;

  if (selection.status === "recorded") {
    const assignment = object(selection.assignment);
    if (!assignment || !positiveId(assignment.id) || !positiveId(assignment.positionId) ||
        assignment.assignmentType !== "primary" ||
        !businessDate(assignment.effectiveFrom) || assignment.effectiveFrom > asOfDate ||
        (assignment.effectiveUntil !== null &&
          (!businessDate(assignment.effectiveUntil) || assignment.effectiveUntil < asOfDate))) return false;
  } else if ((selection.status !== "not_recorded" && selection.status !== "ambiguous") ||
             selection.assignment !== null) return false;

  const seen = new Set<number>();
  let prior: { effectiveDate: string; id: number } | null = null;
  for (const entry of preview.items) {
    const item = object(entry);
    if (!item || !positiveId(item.id) || seen.has(item.id) ||
        !businessDate(item.effectiveDate) || item.effectiveDate > asOfDate ||
        typeof item.eventType !== "string" || !/^[A-Za-z0-9_:-]{1,32}$/.test(item.eventType) ||
        (item.positionAssignmentId !== null && !positiveId(item.positionAssignmentId)) ||
        (prior && (prior.effectiveDate < item.effectiveDate ||
          (prior.effectiveDate === item.effectiveDate && prior.id <= item.id)))) return false;
    seen.add(item.id);
    prior = { id: item.id, effectiveDate: item.effectiveDate };
  }

  if (!preview.hasMore) return preview.nextCursor === null;
  const cursor = object(preview.nextCursor);
  return !!cursor && !!prior && positiveId(cursor.id) &&
    businessDate(cursor.effectiveDate) && cursor.effectiveDate === prior.effectiveDate &&
    cursor.id === prior.id;
}
