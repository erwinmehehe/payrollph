export type AttendanceExceptionSeverity = "info" | "warning" | "blocker";

export type AttendanceExceptionSlaStatus =
  | "resolved"
  | "on_track"
  | "overdue"
  | "untracked";

export function defaultAttendanceExceptionSlaHours(
  severity: AttendanceExceptionSeverity | string,
) {
  if (severity === "blocker") return 4;
  if (severity === "warning") return 24;
  return 72;
}

export function attendanceExceptionSlaDueAt(input: {
  firstDetectedAt: Date | string;
  severity: AttendanceExceptionSeverity | string;
  slaHours?: number | null;
}) {
  const firstDetectedAt = input.firstDetectedAt instanceof Date
    ? input.firstDetectedAt
    : new Date(input.firstDetectedAt);
  if (!Number.isFinite(firstDetectedAt.getTime())) {
    throw new Error("Attendance exception SLA requires a valid first-detected timestamp.");
  }
  const requested = Number(input.slaHours);
  const hours = Number.isFinite(requested) && requested > 0
    ? requested
    : defaultAttendanceExceptionSlaHours(input.severity);
  return new Date(firstDetectedAt.getTime() + hours * 60 * 60_000);
}

export function attendanceExceptionAgeHours(
  firstDetectedAt: Date | string,
  now: Date = new Date(),
) {
  const first = firstDetectedAt instanceof Date
    ? firstDetectedAt
    : new Date(firstDetectedAt);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(now.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - first.getTime()) / 3_600_000));
}

export function attendanceExceptionSlaStatus(input: {
  status: string;
  slaDueAt: Date | string | null | undefined;
  now?: Date;
}): AttendanceExceptionSlaStatus {
  if (input.status === "resolved") return "resolved";
  if (!input.slaDueAt) return "untracked";
  const due = input.slaDueAt instanceof Date ? input.slaDueAt : new Date(input.slaDueAt);
  if (!Number.isFinite(due.getTime())) return "untracked";
  return (input.now ?? new Date()).getTime() > due.getTime() ? "overdue" : "on_track";
}
