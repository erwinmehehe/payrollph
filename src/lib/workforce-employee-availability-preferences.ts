/**
 * Employee-entered WFM preferences are source evidence for managers, not a
 * published shift, approved leave, availability guarantee or payroll change.
 * The existing WFM coverage/roster engine consumes these exact source rows.
 */
export type EmployeeAvailabilityType = "preferred" | "unavailable";
export type EmployeeAvailabilityDraft = {
  weekday: number; // JS/coverage convention: Sunday=0, Saturday=6
  startTime: string;
  endTime: string;
  availabilityType: EmployeeAvailabilityType;
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
};

export type EmployeeAvailabilitySource = EmployeeAvailabilityDraft & {
  id: number;
};

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CREATE_KEYS = new Set([
  "action", "weekday", "startTime", "endTime", "availabilityType",
  "effectiveFrom", "effectiveUntil", "notes",
]);
const REMOVE_KEYS = new Set(["action", "ruleId"]);

function objectValue(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : null;
}
export function validAvailabilityDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function addAvailabilityDays(date: string, days: number): string {
  if (!validAvailabilityDate(date) || !Number.isSafeInteger(days) || Math.abs(days) > 1000) {
    throw new Error("Invalid WFM business date");
  }
  const parsed = new Date(date + "T00:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
function timeMinute(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** Reject forged employer/employee and other unknown scope or mutation keys. */
export function parseEmployeeAvailabilityDraft(
  input: unknown,
  today: string,
): { ok: true; value: EmployeeAvailabilityDraft } | { ok: false; error: string } {
  const body = objectValue(input);
  if (!body || body.action !== "create" || Object.keys(body).some(key => !CREATE_KEYS.has(key))) {
    return { ok: false, error: "Only your own availability rule can be created; employer or employee identifiers are not accepted." };
  }
  const {
    weekday, startTime, endTime, availabilityType, effectiveFrom, effectiveUntil, notes,
  } = body;
  if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
      typeof startTime !== "string" || !HH_MM.test(startTime) ||
      typeof endTime !== "string" || !HH_MM.test(endTime) ||
      timeMinute(startTime) >= timeMinute(endTime) ||
      timeMinute(endTime) - timeMinute(startTime) < 30) {
    return { ok: false, error: "Choose a weekday and a same-day time window of at least 30 minutes. Split overnight windows across two days." };
  }
  if (availabilityType !== "preferred" && availabilityType !== "unavailable") {
    return { ok: false, error: "Choose Preferred shift or Unavailable." };
  }
  if (typeof effectiveFrom !== "string" || !validAvailabilityDate(effectiveFrom) ||
      !validAvailabilityDate(today) || effectiveFrom < today ||
      effectiveFrom > addAvailabilityDays(today, 366)) {
    return { ok: false, error: "Start date must be a real Philippine business date within the next 12 months." };
  }
  const end = effectiveUntil === "" || effectiveUntil === null || effectiveUntil === undefined
    ? null : effectiveUntil;
  if (end !== null && (typeof end !== "string" || !validAvailabilityDate(end) ||
      end < effectiveFrom || end > addAvailabilityDays(today, 366))) {
    return { ok: false, error: "End date must be a valid date on or after the start and within the next 12 months." };
  }
  if (notes !== undefined && notes !== null &&
      (typeof notes !== "string" || notes.length > 240)) {
    return { ok: false, error: "Optional notes must be 240 characters or fewer." };
  }
  return { ok: true, value: {
    weekday,
    startTime,
    endTime,
    availabilityType,
    effectiveFrom,
    effectiveUntil: end,
    notes: typeof notes === "string" ? notes.trim() || null : null,
  } };
}

export function parseAvailabilityRemoval(
  input: unknown,
): { ok: true; ruleId: number } | { ok: false; error: string } {
  const body = objectValue(input);
  if (!body || body.action !== "remove" || Object.keys(body).some(key => !REMOVE_KEYS.has(key)) ||
      typeof body.ruleId !== "number" || !Number.isSafeInteger(body.ruleId) || body.ruleId <= 0) {
    return { ok: false, error: "A valid owned availability rule is required. Employer and employee IDs are not accepted." };
  }
  return { ok: true, ruleId: body.ruleId };
}

function effectiveOverlap(a: EmployeeAvailabilityDraft, b: EmployeeAvailabilityDraft) {
  return (a.effectiveUntil ?? "9999-12-31") >= b.effectiveFrom &&
    (b.effectiveUntil ?? "9999-12-31") >= a.effectiveFrom;
}
function clockOverlap(a: EmployeeAvailabilityDraft, b: EmployeeAvailabilityDraft) {
  return timeMinute(a.startTime) < timeMinute(b.endTime) &&
    timeMinute(b.startTime) < timeMinute(a.endTime);
}
export function sameAvailabilityRule(a: EmployeeAvailabilityDraft, b: EmployeeAvailabilityDraft) {
  return a.weekday === b.weekday && a.startTime === b.startTime &&
    a.endTime === b.endTime && a.availabilityType === b.availabilityType &&
    a.effectiveFrom === b.effectiveFrom && a.effectiveUntil === b.effectiveUntil;
}
export function contradictoryAvailability(a: EmployeeAvailabilityDraft, b: EmployeeAvailabilityDraft) {
  return a.weekday === b.weekday && a.availabilityType !== b.availabilityType &&
    effectiveOverlap(a, b) && clockOverlap(a, b);
}

export type AvailabilityRemovalDecision =
  | { action: "delete_future_rule" }
  | { action: "close_current_rule"; effectiveUntil: string }
  | { action: "historical_rule"; error: string };
/** Do not erase past operational availability evidence when a rule is withdrawn. */
export function availabilityRemovalDecision(rule: Pick<EmployeeAvailabilityDraft, "effectiveFrom" | "effectiveUntil">, today: string): AvailabilityRemovalDecision {
  if (!validAvailabilityDate(today)) throw new Error("Invalid current date");
  if (rule.effectiveUntil && rule.effectiveUntil < today) {
    return { action: "historical_rule", error: "Past availability history cannot be removed." };
  }
  if (rule.effectiveFrom >= today) return { action: "delete_future_rule" };
  return { action: "close_current_rule", effectiveUntil: addAvailabilityDays(today, -1) };
}
