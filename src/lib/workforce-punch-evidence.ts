import { criticalReleaseFlagEnabled } from "./critical-release-flags";

export const PUNCH_CONSENT_VERSION = "selfie-attendance-v1";
export const PUNCH_PHOTO_RETENTION_DAYS = 90;
export const PUNCH_MAX_SKEW_MINUTES = 10;
export const PUNCH_MAX_IMAGE_BYTES = 512 * 1024;
export const PUNCH_ACTIONS = ["clock_in", "break_start", "break_end", "clock_out"] as const;
/** Strict RFC 4122 UUID shape used by browser crypto.randomUUID and future v7 clients. */
export function validPunchUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export type PunchAction = typeof PUNCH_ACTIONS[number];
export type PhotoMode = "off" | "optional" | "required";
export type PunchFlag = "offline-synced" | "clock-skew" | "shared-device" | "impossible-travel" | "photo-missing" | "consent-declined" | "geofence-unverified" | "geofence-verified" | "photo-policy-changed" | "time-invalid";

export function enhancedPunchEnabled(): boolean {
  return criticalReleaseFlagEnabled("workforcePunchEvidence");
}
export function photoConsentAllowsCapture(choice: "accepted" | "declined" | null): boolean {
  return choice === "accepted";
}
export function photoCaptureDecision(mode: PhotoMode, choice: "accepted" | "declined" | null, hasPhoto: boolean) {
  if (mode === "off") return { capture: false, review: false, flags: [] as PunchFlag[] };
  if (choice !== "accepted") return {
    capture: false, review: true,
    flags: [choice === "declined" ? "consent-declined" : "photo-missing"] as PunchFlag[],
  };
  if (mode === "required" && !hasPhoto) return { capture: false, review: true, flags: ["photo-missing"] as PunchFlag[] };
  return { capture: hasPhoto, review: false, flags: [] as PunchFlag[] };
}
/** Device timestamps are browser-created UTC instants, never local strings.
 * Canonical input avoids server timezone inference or normalized invalid dates.
 */
export function validDevicePunchTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
export function evaluatePunchTiming(deviceOccurredAt: string, serverReceivedAt: Date, source: "online" | "offline", skewMinutes = PUNCH_MAX_SKEW_MINUTES): PunchFlag[] {
  if (!validDevicePunchTimestamp(deviceOccurredAt)) return ["time-invalid"];
  const time = Date.parse(deviceOccurredAt);
  const delta = Math.abs(time - serverReceivedAt.getTime());
  const flags: PunchFlag[] = [];
  if (delta > skewMinutes * 60_000) flags.push(source === "offline" ? "offline-synced" : "clock-skew");
  if (time > serverReceivedAt.getTime() + 5 * 60_000 || time < serverReceivedAt.getTime() - 31 * 86_400_000) flags.push("time-invalid");
  return flags;
}
export type LocationSample = { worksiteId: number; latitude: number; longitude: number; at: Date };
export function impossibleTravel(previous: LocationSample | null, next: LocationSample, maxKph = 180): boolean {
  if (!previous || previous.worksiteId === next.worksiteId) return false;
  const hours = Math.abs(next.at.getTime() - previous.at.getTime()) / 3_600_000;
  if (hours > 24) return false;
  const r = Math.PI / 180;
  const dLat = (next.latitude - previous.latitude) * r;
  const dLon = (next.longitude - previous.longitude) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(previous.latitude * r) * Math.cos(next.latitude * r) * Math.sin(dLon / 2) ** 2;
  const km = 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return km > 10 && (hours <= 0 || km / hours > maxKph);
}
/** Drain a bounded number of photo batches under the scheduler lease.
 * If the limit is exhausted, fail the scheduled run so operations can retry
 * and alert instead of recording a false 90-day purge success.
 */
export async function drainExpiredPunchPhotoBatches(
  nextBatch: () => Promise<{ purged: number; remainingPossiblyDue: boolean }>,
  assertLease: () => Promise<void>,
  maxBatches = 20,
): Promise<{ purged: number; batches: number }> {
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 20) {
    throw Error("Invalid photo retention batch bound.");
  }
  let purged = 0;
  for (let batch = 1; batch <= maxBatches; batch++) {
    await assertLease();
    const result = await nextBatch();
    if (!Number.isSafeInteger(result.purged) || result.purged < 0 ||
      typeof result.remainingPossiblyDue !== "boolean") {
      throw Error("Invalid photo retention batch result.");
    }
    purged += result.purged;
    if (!result.remainingPossiblyDue) return { purged, batches: batch };
  }
  throw Error("WFM punch photo retention backlog exceeded bounded purge; operator review required.");
}

export function photoExpiry(receivedAt: Date, days = PUNCH_PHOTO_RETENTION_DAYS) {
  return new Date(receivedAt.getTime() + days * 86_400_000);
}
export type ExpirablePhoto = { id: string; expiresAt: Date; legalHold: boolean; sealedPhoto: string | null };
export function photosDueForPurge<T extends ExpirablePhoto>(rows: T[], now: Date): T[] {
  return rows.filter(row => !row.legalHold && row.sealedPhoto != null && row.expiresAt.getTime() <= now.getTime());
}

/** A newer effective deny must supersede an older allow; never search past a deny. */
export function resolvedWorksiteDecision(
  rows: readonly { worksiteId: number; decision: string }[],
): number | null {
  const newest = rows[0];
  return newest?.decision === "allow" ? newest.worksiteId : null;
}
