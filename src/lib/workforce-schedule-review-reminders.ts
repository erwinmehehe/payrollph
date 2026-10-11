import type { ScheduleReceiptView } from "./workforce-schedule-receipt";
import { receiptDates, validReceiptId } from "./workforce-schedule-receipt";

/** A schedule-review prompt, not notice delivery, presence, consent, or pay evidence. */
export type ScheduleReviewSignal = {
  organizationId: number;
  employeeId: number;
  userId: number;
  workDate: string;
  reason: "published_change" | "upcoming_unacknowledged";
  eventKey: string;
  snapshotHash: string;
};

const HASH = /^[a-f0-9]{64}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function startInstant(day: string, start: string): number | null {
  if (!TIME.test(start)) return null;
  const stamp = Date.parse(day + "T" + (start.length === 5 ? start + ":00" : start) + "+08:00");
  return Number.isFinite(stamp) ? stamp : null;
}

/**
 * One event per active employee login + work date + exact current version +
 * reason. Automation Studio already deduplicates per rule/event key.
 * Pending notifications are only for upcoming shifts within 24h; changes to
 * previously seen schedules are suggested for review within the seven-day view.
 * An unavailable/invalid schedule never becomes an employee allegation.
 */
export function scheduleReviewSignals(input: {
  organizationId: number;
  employeeId: number;
  userId: number;
  view: ScheduleReceiptView;
  now: Date;
}): ScheduleReviewSignal[] {
  const { organizationId, employeeId, userId, view, now } = input;
  if (![organizationId, employeeId, userId].every(validReceiptId)
    || !Number.isFinite(now.getTime()) || view.days.length !== 7) return [];
  let expected: string[];
  try { expected = receiptDates(view.days[0].date); } catch { return []; }
  if (view.days.some((d, i) => d.date !== expected[i])) return [];

  const events: ScheduleReviewSignal[] = [];
  for (const day of view.days) {
    if ((day.state !== "changed" && day.state !== "pending")
      || !day.snapshot || !day.snapshotHash || !HASH.test(day.snapshotHash)
      || day.snapshot.date !== day.date) continue;
    if (day.state === "pending") {
      // A recorded rest day is not a pending shift; no reminder is due.
      if (day.snapshot.isRestDay || day.snapshot.segments.length === 0) continue;
      const starts = day.snapshot.segments.map(segment =>
        startInstant(day.date, segment.startTime));
      if (starts.some(t => t === null)) continue;
      const soonest = Math.min(...starts as number[]);
      const minutesUntilStart = (soonest - now.getTime()) / 60_000;
      if (minutesUntilStart < 0 || minutesUntilStart > 1_440) continue;
    }
    const reason = day.state === "changed" ? "published_change" : "upcoming_unacknowledged";
    events.push({
      organizationId, employeeId, userId, workDate: day.date, reason,
      snapshotHash: day.snapshotHash,
      eventKey: [
        "wfm-schedule-review-v1", organizationId, employeeId, userId,
        day.date, reason, day.snapshotHash,
      ].join(":"),
    });
  }
  return events;
}
