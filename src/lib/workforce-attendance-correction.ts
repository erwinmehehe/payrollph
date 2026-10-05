export type AttendancePunchSnapshot = {
  workDate: string;
  timeIn: string | null;
  timeOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  status: string;
};

function asIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function attendancePunchSnapshot(input: {
  workDate: Date | string;
  timeIn: Date | string | null;
  timeOut: Date | string | null;
  breakStart?: Date | string | null;
  breakEnd?: Date | string | null;
  status?: string | null;
}): AttendancePunchSnapshot {
  return {
    workDate: String(input.workDate).slice(0, 10),
    timeIn: asIso(input.timeIn),
    timeOut: asIso(input.timeOut),
    breakStart: asIso(input.breakStart),
    breakEnd: asIso(input.breakEnd),
    status: String(input.status ?? ""),
  };
}

export function attendancePunchSnapshotsMatch(
  a: AttendancePunchSnapshot,
  b: AttendancePunchSnapshot,
) {
  return a.workDate === b.workDate
    && a.timeIn === b.timeIn
    && a.timeOut === b.timeOut
    && a.breakStart === b.breakStart
    && a.breakEnd === b.breakEnd
    && a.status === b.status;
}

export function normalizeAttendanceCorrection(input: {
  original: AttendancePunchSnapshot;
  proposedTimeIn?: unknown;
  proposedTimeOut?: unknown;
  proposedBreakStart?: unknown;
  proposedBreakEnd?: unknown;
}): AttendancePunchSnapshot {
  const pick = (value: unknown, fallback: string | null) => {
    if (value === undefined) return fallback;
    if (value === null || value === "") return null;
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) {
      throw new Error("Attendance correction timestamps must be valid ISO date-times.");
    }
    return date.toISOString();
  };

  const next: AttendancePunchSnapshot = {
    workDate: input.original.workDate,
    timeIn: pick(input.proposedTimeIn, input.original.timeIn),
    timeOut: pick(input.proposedTimeOut, input.original.timeOut),
    breakStart: pick(input.proposedBreakStart, input.original.breakStart),
    breakEnd: pick(input.proposedBreakEnd, input.original.breakEnd),
    status: input.original.status,
  };

  if (next.timeIn && next.timeOut) {
    if (Date.parse(next.timeOut) <= Date.parse(next.timeIn)) {
      throw new Error("Time out must be later than time in.");
    }
  }

  const hasBreakStart = Boolean(next.breakStart);
  const hasBreakEnd = Boolean(next.breakEnd);
  if (hasBreakStart !== hasBreakEnd) {
    throw new Error("Break correction must include both break start and break end, or neither.");
  }
  if (next.breakStart && next.breakEnd) {
    const breakStart = Date.parse(next.breakStart);
    const breakEnd = Date.parse(next.breakEnd);
    if (breakEnd <= breakStart) {
      throw new Error("Break end must be later than break start.");
    }
    if (next.timeIn && breakStart < Date.parse(next.timeIn)) {
      throw new Error("Break cannot begin before time in.");
    }
    if (next.timeOut && breakEnd > Date.parse(next.timeOut)) {
      throw new Error("Break cannot end after time out.");
    }
  }

  if (attendancePunchSnapshotsMatch(input.original, next)) {
    throw new Error("Attendance correction must change at least one punch timestamp.");
  }

  return next;
}

export function punchStatusAfterCorrection(snapshot: AttendancePunchSnapshot) {
  return snapshot.timeIn && snapshot.timeOut ? "Corrected" : "Incomplete";
}
