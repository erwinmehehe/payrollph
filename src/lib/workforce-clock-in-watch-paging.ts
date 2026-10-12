/**
 * Keyset paging for the optional clock-in watch. The full cohort is scanned
 * before any advisory event is emitted, so a bounded/failed scan can never
 * masquerade as complete coverage. No employee attendance decision is made.
 */
export type ClockWatchAssignmentRef = {
  id: number;
  organizationId: number;
  employeeId: number;
};

export const CLOCK_WATCH_PAGE_SIZE = 200;
export const CLOCK_WATCH_SCAN_LIMIT = 10_000;

export async function scanClockWatchAssignments<T extends ClockWatchAssignmentRef>(
  fetchPage: (afterId: number, pageSize: number) => Promise<readonly T[]>,
  options: { pageSize?: number; scanLimit?: number } = {},
): Promise<
  | { complete: true; assignments: T[]; pages: number }
  | { complete: false; assignments: []; pages: number; limit: number }
> {
  const pageSize = options.pageSize ?? CLOCK_WATCH_PAGE_SIZE;
  const scanLimit = options.scanLimit ?? CLOCK_WATCH_SCAN_LIMIT;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500
    || !Number.isSafeInteger(scanLimit) || scanLimit < pageSize || scanLimit > 50_000) {
    throw new Error("Invalid bounded clock-in watch scan configuration.");
  }
  const assignments: T[] = [];
  let afterId = 0;
  let pages = 0;
  while (true) {
    const page = await fetchPage(afterId, pageSize);
    pages += 1;
    if (!Array.isArray(page) || page.length > pageSize) {
      throw new Error("Clock-in watch page is malformed or unbounded.");
    }
    for (const row of page) {
      if (!Number.isSafeInteger(row.id) || row.id <= afterId
        || !Number.isSafeInteger(row.organizationId) || row.organizationId < 1
        || !Number.isSafeInteger(row.employeeId) || row.employeeId < 1) {
        throw new Error("Clock-in watch page must be strictly ordered by assignment ID.");
      }
      afterId = row.id;
      assignments.push(row);
      if (assignments.length > scanLimit) {
        // Do not expose a partially read cohort to the caller.
        return { complete: false, assignments: [], pages, limit: scanLimit };
      }
    }
    if (page.length < pageSize) return { complete: true, assignments, pages };
  }
}
