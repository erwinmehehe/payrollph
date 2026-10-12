import { criticalReleaseFlagEnabled } from "./critical-release-flags";

export const PUNCH_CONSENT_VERSION = "selfie-attendance-v1";
export const PUNCH_PHOTO_RETENTION_DAYS = 90;
export const PUNCH_MAX_SKEW_MINUTES = 10;
export const PUNCH_MAX_IMAGE_BYTES = 512 * 1024;
export const PUNCH_ACTIONS = ["clock_in", "break_start", "break_end", "clock_out"] as const;
export type PunchAction = typeof PUNCH_ACTIONS[number];
export type PhotoMode = "off" | "optional" | "required";
export type PunchFlag = "offline-synced" | "clock-skew" | "shared-device" | "impossible-travel" | "photo-missing" | "consent-declined" | "time-invalid";

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
export function evaluatePunchTiming(deviceOccurredAt: string, serverReceivedAt: Date, source: "online" | "offline", skewMinutes = PUNCH_MAX_SKEW_MINUTES): PunchFlag[] {
  const time = Date.parse(deviceOccurredAt);
  if (!Number.isFinite(time) || !/^\d{4}-\d\d-\d\dT/.test(deviceOccurredAt)) return ["time-invalid"];
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
export function photoExpiry(receivedAt: Date, days = PUNCH_PHOTO_RETENTION_DAYS) {
  return new Date(receivedAt.getTime() + days * 86_400_000);
}
export type ExpirablePhoto = { id: string; expiresAt: Date; legalHold: boolean; sealedPhoto: string | null };
export function photosDueForPurge<T extends ExpirablePhoto>(rows: T[], now: Date): T[] {
  return rows.filter(row => !row.legalHold && row.sealedPhoto != null && row.expiresAt.getTime() <= now.getTime());
}
