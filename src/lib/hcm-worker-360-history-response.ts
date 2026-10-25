import type { Worker360Summary } from "./hcm-worker-360-contract";
import { isValidWorker360Response } from "./hcm-worker-360-response";
import { validWorker360EventCursor, worker360EventBeforeCursor,
  type Worker360EventCursor } from "./hcm-worker-360-projection";

/**
 * A page fetched with a history cursor must pass the same full source check
 * as the initial Worker 360 read, then prove its items are strictly before the
 * requested keyset cursor and do not replay previously displayed event IDs.
 *
 * No action on this result authorizes an HR or payroll write. Server-side
 * tenant and role authorization remains authoritative.
 */
export function isVerifiedWorker360OlderPage(
  response: unknown,
  organizationId: number,
  employeeId: number,
  asOfDate: string,
  requestedCursor: Worker360EventCursor,
  displayedIds: readonly number[],
): response is Worker360Summary {
  if (!validWorker360EventCursor(requestedCursor, asOfDate) ||
      !isValidWorker360Response(response, organizationId, employeeId, asOfDate) ||
      !Array.isArray(displayedIds) ||
      displayedIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return false;

  const previous = new Set(displayedIds);
  return response.employmentEvents.preview.items.every(item =>
    !previous.has(item.id) && worker360EventBeforeCursor(item, requestedCursor));
}
