/**
 * Manila calendar milestones rather than elapsed 24-hour durations.
 * Return a single most urgent stage; unique SQL constraints suppress repeat
 * notices even across concurrent scheduler workers.
 */
export type DocumentExpiryMilestone = 30 | 14 | 7;
export function manilaDateOnly(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return value("year") + "-" + value("month") + "-" + value("day");
}
export function validExpiryCalendarDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const dt = new Date(raw + "T00:00:00Z");
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === raw;
}
export function expiryDaysRemaining(expiresOn: string, now = new Date()): number | null {
  if (!validExpiryCalendarDate(expiresOn) || !Number.isFinite(now.getTime())) return null;
  const today = manilaDateOnly(now);
  return Math.round((Date.parse(expiresOn + "T00:00:00Z") -
    Date.parse(today + "T00:00:00Z")) / 86_400_000);
}
export function documentExpiryMilestone(expiresOn: string, now = new Date()): {
  daysRemaining: number | null;
  milestoneDays: DocumentExpiryMilestone | null;
} {
  const daysRemaining = expiryDaysRemaining(expiresOn, now);
  if (daysRemaining === null || daysRemaining < 0) return { daysRemaining, milestoneDays: null };
  if (daysRemaining <= 7) return { daysRemaining, milestoneDays: 7 };
  if (daysRemaining <= 14) return { daysRemaining, milestoneDays: 14 };
  if (daysRemaining <= 30) return { daysRemaining, milestoneDays: 30 };
  return { daysRemaining, milestoneDays: null };
}
export function documentObjectIdentityMatches(
  objectKey: string, organizationId: number, employeeId: number | null,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
    (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId <= 0))) return false;
  const parts = objectKey.split("/");
  return parts.length === 4 && parts[0] === "private-documents" &&
    parts[1] === String(organizationId) && parts[2] === String(employeeId ?? "company") &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[3]);
}
/** Fail closed for pending/non-verified documents: upload is not HR verification. */
export function canIssueExpiryNotice(input: {
  status: string; documentId: number | null; verifiedAt: Date | null;
  scannedClean: boolean; expiryRequired: boolean;
}): boolean {
  return Boolean(input.documentId && input.verifiedAt && input.scannedClean &&
    input.expiryRequired && ["current", "expiring", "expired"].includes(input.status));
}

/** Medical, identity and employment files require People administration, not bookkeeping. */
export function canStaffOpenEmployeeVault(role: string): boolean {
  return role === "owner" || role === "admin" || role === "hr";
}

/** Optional paperwork must never raise required-document deficit counters. */
export function isMandatoryDocumentMissing(row: {
  status: string; mandatory: boolean;
}): boolean {
  return row.mandatory && row.status === "missing";
}

/** Never release an unverified private object, even after flag rollback in QA. */
export function documentBytesMayBeReleased(input: {
  scannedClean: boolean;
  isProduction: boolean;
  vaultEnabled: boolean;
  hasPrivateObject: boolean;
}): boolean {
  return input.scannedClean ||
    (!input.isProduction && !input.vaultEnabled && !input.hasPrivateObject);
}
