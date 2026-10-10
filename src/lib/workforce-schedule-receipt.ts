import { createHash } from "node:crypto";

/** A content receipt, never attendance evidence, contract consent or payroll approval. */
export const SCHEDULE_RECEIPT_BOUNDARY = "Acknowledging confirms that you have seen this schedule snapshot. It does not record attendance, accept a pay change, or waive any rights. Missing acknowledgment does not mean absence.";
export type ReceiptSourceDay = {
  date: string; source: "pattern" | "override" | "unassigned"; isRestDay: boolean;
  assignmentId: number | null; patternId: number | null; overrideId: number | null;
  workLocationOrgUnitId: number | null; worksiteId: number | null;
  segments: Array<{ shiftDefinitionId: number; shiftCode: string; shiftName: string;
    segmentOrder: number; startTime: string; endTime: string;
    breakMinutes: number; spansMidnight: boolean }>;
};
export type ScheduleReceiptSnapshot = {
  version: 1; date: string; source: "pattern" | "override"; isRestDay: boolean;
  assignmentId: number | null; patternId: number | null; overrideId: number | null;
  workLocationOrgUnitId: number | null;
  worksite: { id: number; name: string } | null;
  segments: ReceiptSourceDay["segments"];
};
export type ScheduleReceiptDay = {
  date: string; snapshot: ScheduleReceiptSnapshot | null; snapshotHash: string | null;
  state: "pending" | "acknowledged" | "changed" | "unavailable";
  acknowledgedAt: string | null;
};
export type ScheduleReceiptView = { days: ScheduleReceiptDay[]; boundary: string };

export function validReceiptId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
}
export function receiptPilotAllowed(organizationId: number, enabled: string | undefined, ids: string | undefined): boolean {
  if (enabled !== "true" || !validReceiptId(organizationId) || !ids || ids.length > 240) return false;
  const values = ids.split(",").map(value => value.trim());
  if (values.length > 20 || values.some(value => !/^[1-9][0-9]{0,9}$/.test(value))) return false;
  const numbers = values.map(Number);
  return numbers.every(validReceiptId) && new Set(numbers).size === numbers.length && numbers.includes(organizationId);
}
export function receiptDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid work date.");
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid work date.");
  return value;
}
export function receiptDates(today: string): string[] {
  const start = new Date(receiptDate(today) + "T00:00:00Z");
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start); day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}
function nullableId(value: number | null): boolean { return value === null || validReceiptId(value); }
function clock(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  const [h, m, s = 0] = value.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}
export function snapshotForReceipt(day: ReceiptSourceDay, site: { id: number; name: string } | null): ScheduleReceiptSnapshot | null {
  receiptDate(day.date);
  if (day.source === "unassigned" || !["pattern", "override"].includes(day.source)) return null;
  if (![day.assignmentId, day.patternId, day.overrideId, day.worksiteId, day.workLocationOrgUnitId].every(nullableId)) return null;
  if (day.source === "pattern" && (!validReceiptId(day.assignmentId) || !validReceiptId(day.patternId))) return null;
  if (day.source === "override" && !validReceiptId(day.overrideId)) return null;
  if (day.worksiteId !== null && (!site || site.id !== day.worksiteId || !site.name.trim())) return null;
  if (day.isRestDay ? day.segments.length !== 0 : day.segments.length === 0) return null;
  const orders = new Set<number>();
  const segments: ReceiptSourceDay["segments"] = [];
  for (const segment of [...day.segments].sort((a, b) => a.segmentOrder - b.segmentOrder)) {
    const start = clock(segment.startTime), end = clock(segment.endTime);
    if (start === null || end === null || !validReceiptId(segment.shiftDefinitionId) ||
        !validReceiptId(segment.segmentOrder) || orders.has(segment.segmentOrder) ||
        !segment.shiftCode.trim() || !segment.shiftName.trim() || typeof segment.spansMidnight !== "boolean") return null;
    const seconds = end + (segment.spansMidnight ? 86400 : 0) - start;
    if (seconds <= 0 || seconds > 86400 || !Number.isSafeInteger(segment.breakMinutes) ||
        segment.breakMinutes < 0 || segment.breakMinutes * 60 >= seconds) return null;
    orders.add(segment.segmentOrder);
    segments.push({ shiftDefinitionId: segment.shiftDefinitionId, shiftCode: segment.shiftCode,
      shiftName: segment.shiftName, segmentOrder: segment.segmentOrder,
      startTime: segment.startTime, endTime: segment.endTime,
      breakMinutes: segment.breakMinutes, spansMidnight: segment.spansMidnight });
  }
  return { version: 1, date: day.date, source: day.source, isRestDay: day.isRestDay,
    assignmentId: day.assignmentId, patternId: day.patternId, overrideId: day.overrideId,
    workLocationOrgUnitId: day.workLocationOrgUnitId,
    worksite: day.worksiteId === null ? null : { id: site!.id, name: site!.name }, segments };
}
export function scheduleReceiptHash(organizationId: number, employeeId: number, snapshot: ScheduleReceiptSnapshot): string {
  if (!validReceiptId(organizationId) || !validReceiptId(employeeId)) throw new Error("Invalid receipt scope.");
  return createHash("sha256").update(JSON.stringify(["schedule-receipt/v1", organizationId, employeeId, snapshot])).digest("hex");
}
export function receiptState(hash: string | null, receipts: readonly { snapshotHash: string; acknowledgedAt: Date }[]): Pick<ScheduleReceiptDay, "state" | "acknowledgedAt"> {
  if (hash === null) return { state: "unavailable", acknowledgedAt: null };
  const match = receipts.find(row => row.snapshotHash === hash);
  if (match) return { state: "acknowledged", acknowledgedAt: match.acknowledgedAt.toISOString() };
  return { state: receipts.length ? "changed" : "pending", acknowledgedAt: null };
}
export function parseScheduleReceipt(body: unknown, today: string): { workDate: string; snapshotHash: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid acknowledgment.");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["workDate", "snapshotHash", "acknowledged"].includes(key)) || value.acknowledged !== true) {
    throw new Error("Explicit acknowledgment is required; employee and employer are session-scoped.");
  }
  const workDate = receiptDate(value.workDate);
  if (!receiptDates(today).includes(workDate) || typeof value.snapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(value.snapshotHash)) {
    throw new Error("Refresh your current seven-day schedule before acknowledging.");
  }
  return { workDate, snapshotHash: value.snapshotHash };
}
