/**
 * Bounded, keyset-paged workforce scanner. No page may trigger an alert: the
 * caller only receives a complete cohort after the final page was read.
 */
export type ActiveRosterAssignment = { id: number; organizationId: number; employeeId: number };
export type RosterScanResult =
  | { complete: true; assignmentsScanned: number; pages: number; workers: Array<{ organizationId: number; employeeId: number }> }
  | { complete: false; assignmentsScanned: number; pages: number; reason: "limit-reached" };

export const ROSTER_SCAN_PAGE_SIZE = 200;
export const ROSTER_SCAN_MAX_ASSIGNMENTS = 20_000;

export async function scanActiveRosterAssignments(input: {
  fetchPage: (afterId: number, limit: number) => Promise<ActiveRosterAssignment[]>;
  pageSize?: number;
  maxAssignments?: number;
}): Promise<RosterScanResult> {
  const pageSize = input.pageSize ?? ROSTER_SCAN_PAGE_SIZE;
  const maxAssignments = input.maxAssignments ?? ROSTER_SCAN_MAX_ASSIGNMENTS;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > ROSTER_SCAN_PAGE_SIZE
    || !Number.isSafeInteger(maxAssignments) || maxAssignments < 1) {
    throw new Error("Invalid roster scan bounds.");
  }
  let cursor = 0;
  let count = 0;
  let pages = 0;
  const seen = new Set<string>();
  const workers: Array<{ organizationId: number; employeeId: number }> = [];
  while (true) {
    // Ask for one additional record at the hard cap, so a skipped remainder is
    // reported as incomplete rather than as a falsely complete scan.
    const limit = Math.min(pageSize, maxAssignments - count + 1);
    const batch = await input.fetchPage(cursor, limit);
    pages += 1;
    if (batch.length > limit) throw new Error("Roster scan page exceeded its bound.");
    if (batch.length === 0) return { complete: true, assignmentsScanned: count, pages, workers };
    for (const row of batch) {
      if (!Number.isSafeInteger(row.id) || row.id <= cursor
        || !Number.isSafeInteger(row.organizationId) || row.organizationId <= 0
        || !Number.isSafeInteger(row.employeeId) || row.employeeId <= 0) {
        throw new Error("Roster scan page was unordered or malformed.");
      }
      cursor = row.id;
      count += 1;
      if (count > maxAssignments) {
        return { complete: false, assignmentsScanned: count - 1, pages, reason: "limit-reached" };
      }
      const key = `${row.organizationId}:${row.employeeId}`;
      if (!seen.has(key)) {
        seen.add(key);
        workers.push({ organizationId: row.organizationId, employeeId: row.employeeId });
      }
    }
    if (batch.length < limit) return { complete: true, assignmentsScanned: count, pages, workers };
  }
}

/** Open, bounded windows for callers that need 1-14 roster dates.
 * Legacy week consumers keep using their existing seven-day contract.
 */
export function rosterWindowDates(startDate: string, endDate: string, maxDays = 14): string[] {
  const canonical = (value: string): number => {
    if (!/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error("Roster dates must use YYYY-MM-DD.");
    const stamp = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) {
      throw new Error("Invalid roster calendar date.");
    }
    return stamp;
  };
  const start = canonical(startDate);
  const end = canonical(endDate);
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (!Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > 31 || days < 1 || days > maxDays) {
    throw new Error(`Roster window must be 1-${maxDays} consecutive days.`);
  }
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}
