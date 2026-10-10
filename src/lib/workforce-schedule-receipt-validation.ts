import type { ReceiptSourceDay, ScheduleReceiptDay, ScheduleReceiptSnapshot, ScheduleReceiptView } from "./workforce-schedule-receipt";

/** Browser-safe runtime contracts shared by source projection and receipt UI. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function positiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
}
function nullableId(value: unknown): boolean { return value === null || positiveId(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function instant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function clock(value: unknown): number | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  const [hour, minute, second = 0] = value.split(":").map(Number);
  return hour * 3600 + minute * 60 + second;
}

export function validReceiptSegments(value: unknown): value is ReceiptSourceDay["segments"] {
  if (!Array.isArray(value)) return false;
  const orders = new Set<number>();
  const intervals: Array<{ start: number; end: number }> = [];
  for (const segment of value) {
    if (!record(segment) || !positiveId(segment.shiftDefinitionId) || !positiveId(segment.segmentOrder)
      || orders.has(segment.segmentOrder) || !text(segment.shiftCode) || !text(segment.shiftName)
      || typeof segment.spansMidnight !== "boolean") return false;
    const start = clock(segment.startTime), end = clock(segment.endTime);
    if (start === null || end === null) return false;
    const finish = end + (segment.spansMidnight ? 86400 : 0);
    const duration = finish - start;
    if (duration <= 0 || duration > 86400 || !Number.isSafeInteger(segment.breakMinutes)
      || Number(segment.breakMinutes) < 0 || Number(segment.breakMinutes) * 60 >= duration) return false;
    orders.add(segment.segmentOrder);
    intervals.push({ start, end: finish });
  }
  // Compare real time windows, not segment order or break-adjusted duration.
  // Touching endpoints are valid; nested and partial overlaps are not.
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  let furthestEnd = -1;
  for (const interval of intervals) {
    if (interval.start < furthestEnd) return false;
    furthestEnd = Math.max(furthestEnd, interval.end);
  }
  return true;
}

/** Reject conflicts across work dates as well as within one split shift. */
export function receiptOverlappingDates(
  days: readonly Pick<ReceiptSourceDay, "date" | "segments">[],
): Set<string> {
  const intervals: Array<{ date: string; start: number; end: number }> = [];
  for (const day of days) {
    if (!date(day.date) || !validReceiptSegments(day.segments)) {
      throw new Error("Invalid schedule window evidence.");
    }
    const base = Date.parse(day.date + "T00:00:00Z") / 1000;
    for (const segment of day.segments) {
      intervals.push({ date: day.date, start: base + clock(segment.startTime)!,
        end: base + clock(segment.endTime)! + (segment.spansMidnight ? 86400 : 0) });
    }
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const conflicts = new Set<string>();
  let active: typeof intervals = [];
  for (const interval of intervals) {
    active = active.filter(prior => prior.end > interval.start);
    for (const prior of active) {
      conflicts.add(prior.date);
      conflicts.add(interval.date);
    }
    active.push(interval);
  }
  return conflicts;
}

export function validReceiptSource(value: unknown): value is ReceiptSourceDay {
  if (!record(value) || !date(value.date) || (value.source !== "pattern" && value.source !== "override")
    || typeof value.isRestDay !== "boolean" || !validReceiptSegments(value.segments)) return false;
  if (![value.assignmentId, value.patternId, value.overrideId, value.worksiteId, value.workLocationOrgUnitId].every(nullableId)) return false;
  if (value.source === "pattern" && (!positiveId(value.assignmentId) || !positiveId(value.patternId))) return false;
  if (value.source === "override" && !positiveId(value.overrideId)) return false;
  return value.isRestDay ? value.segments.length === 0 : value.segments.length > 0;
}

function validSnapshot(value: unknown, workDate: string): value is ScheduleReceiptSnapshot {
  if (!record(value) || value.version !== 1 || value.date !== workDate) return false;
  if (value.worksite !== null && (!record(value.worksite)
    || !positiveId(value.worksite.id) || !text(value.worksite.name))) return false;
  return validReceiptSource({ ...value, worksiteId: value.worksite === null ? null : (value.worksite as Record<string, unknown>).id });
}

export function validScheduleReceiptView(raw: unknown): raw is ScheduleReceiptView {
  if (!record(raw) || !text(raw.boundary) || !Array.isArray(raw.days) || raw.days.length !== 7) return false;
  let previousDate: number | null = null;
  const windows: Array<Pick<ReceiptSourceDay, "date" | "segments">> = [];
  for (const day of raw.days) {
    if (!record(day) || !date(day.date)) return false;
    const ordinal = Date.parse(day.date + "T00:00:00Z");
    if (previousDate !== null && ordinal !== previousDate + 86400000) return false;
    previousDate = ordinal;
    if (day.state === "unavailable") {
      if (day.snapshot !== null || day.snapshotHash !== null || day.acknowledgedAt !== null) return false;
      continue;
    }
    if ((day.state !== "pending" && day.state !== "changed" && day.state !== "acknowledged")
      || !hash(day.snapshotHash) || !validSnapshot(day.snapshot, day.date)) return false;
    if (day.state === "acknowledged" ? !instant(day.acknowledgedAt) : day.acknowledgedAt !== null) return false;
    windows.push({ date: day.date, segments: day.snapshot.segments });
  }
  return receiptOverlappingDates(windows).size === 0;
}

export type ScheduleReceiptConfirmation = {
  created: boolean; workDate: string; snapshotHash: string; acknowledgedAt: string;
};
export function validScheduleReceiptConfirmation(
  raw: unknown,
  selected: Pick<ScheduleReceiptDay, "date" | "snapshotHash">,
): raw is ScheduleReceiptConfirmation {
  return record(raw) && typeof raw.created === "boolean" && date(raw.workDate)
    && raw.workDate === selected.date && hash(raw.snapshotHash)
    && raw.snapshotHash === selected.snapshotHash && instant(raw.acknowledgedAt);
}
