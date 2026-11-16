/**
 * Philippine workplace compliance contracts. These are intentionally NOT
 * determinations of statutory applicability, deadlines, agency acceptance, or
 * Safe Spaces Act / CODI compliance. Human reviewers own those decisions.
 */
export const DOLE_EXTENDED_REPORT_TYPES = {
  wair: "Work Accident / Illness Report",
  telecommuting: "Telecommuting Report",
  flexible_work: "Flexible Work Arrangements Report",
  construction_safety: "Construction Safety and Health Program",
  labor_inspection: "Labor Inspection supporting record",
  other: "Other DOLE reporting evidence",
} as const;
export type DoleExtendedReportType = keyof typeof DOLE_EXTENDED_REPORT_TYPES;

export const OSH_EVENT_KINDS = ["hazard", "near_miss", "injury", "illness", "other"] as const;
export const OSH_SEVERITIES = ["low", "moderate", "high", "critical"] as const;
export const OSH_EVENT_STATUSES = ["open", "mitigating", "resolved"] as const;
export const TRAINING_TOPICS = [
  "osh_orientation", "fire_safety", "first_aid", "harassment_prevention", "other",
] as const;
export const PROTECTED_CASE_KINDS = [
  "gender_based_harassment", "other_harassment", "retaliation", "other",
] as const;
export const PROTECTED_CASE_STATES = [
  "intake", "investigating", "review_pending", "closed",
] as const;

export type ProtectedCaseStatus = typeof PROTECTED_CASE_STATES[number];
export type ProtectedCaseKind = typeof PROTECTED_CASE_KINDS[number];

export const DOLE_STATUSES = [
  "draft", "submitted_recorded", "accepted_recorded",
  "rejected_recorded", "independently_reviewed",
] as const;
export type DoleRecordStatus = typeof DOLE_STATUSES[number];

/** Civil dates, never UTC timestamps or time-zone-dependent coercions. */
export function phCivilDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T12:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}
export function positiveId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && String(n) === String(value) ? n : null;
}
export function limitedText(value: unknown, max: number, required = false): string | null {
  if (value == null || value === "") return required ? null : "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return null;
  return text;
}
export function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}
export function sha256Digest(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function httpsReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 350) return null;
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" && !uri.username && !uri.password ? uri.toString() : null;
  } catch { return null; }
}
export function validDateRange(start: unknown, end: unknown): start is string {
  return phCivilDate(start) !== null && phCivilDate(end) !== null && String(start) <= String(end);
}

/** Claims are distinct from independent evidence review. Never conflate them. */
export function mayAdvanceDoleRecord(current: DoleRecordStatus, next: DoleRecordStatus, input: {
  hasReceipt: boolean;
  independentReviewer: boolean;
}): boolean {
  const transitions: Record<DoleRecordStatus, DoleRecordStatus[]> = {
    draft: ["submitted_recorded"],
    submitted_recorded: ["accepted_recorded", "rejected_recorded"],
    accepted_recorded: ["independently_reviewed", "rejected_recorded"],
    rejected_recorded: [],
    independently_reviewed: [],
  };
  if (!transitions[current].includes(next)) return false;
  if (["submitted_recorded", "accepted_recorded", "independently_reviewed"].includes(next) && !input.hasReceipt) return false;
  if (next === "independently_reviewed" && !input.independentReviewer) return false;
  return true;
}

/** Case data is never available by default to owners, admins or HR. */
export function mayReadProtectedCase(input: {
  viewerId: number;
  creatorId: number;
  investigatorId: number;
  reviewerId: number | null;
}): boolean {
  return input.viewerId === input.creatorId ||
    input.viewerId === input.investigatorId ||
    (input.reviewerId !== null && input.viewerId === input.reviewerId);
}
/** Strict independent case review, with no self-approval. */
export function mayTransitionProtectedCase(input: {
  current: ProtectedCaseStatus;
  next: ProtectedCaseStatus;
  actorId: number;
  creatorId: number;
  investigatorId: number;
  reviewerId: number | null;
}): boolean {
  const { current, next, actorId, creatorId, investigatorId, reviewerId } = input;
  if (current === "intake" && next === "investigating") return actorId === investigatorId;
  if (current === "investigating" && next === "review_pending") return actorId === investigatorId && reviewerId !== null && reviewerId !== investigatorId && reviewerId !== creatorId;
  if (current === "review_pending" && (next === "closed" || next === "investigating")) {
    return actorId === reviewerId && actorId !== creatorId && actorId !== investigatorId;
  }
  return false;
}
