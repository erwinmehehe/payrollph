/**
 * A privacy-minimal upcoming-week view over the authenticated ESS schedule.
 * It never evaluates attendance, wage entitlement, leave or compliance.
 */

export type EmployeeUpcomingSegment = {
  shiftCode: string;
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
};

export type EmployeeUpcomingSourceDay = {
  date: string;
  source: "pattern" | "override" | "unassigned";
  isRestDay: boolean;
  segments: readonly EmployeeUpcomingSegment[];
};

export type EmployeeUpcomingDay = {
  date: string;
  state: "shift" | "rest" | "unassigned" | "review";
  changed: boolean;
  label: string;
  segments: string[];
};

function parseIsoDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("A valid ISO work date is required.");
  }
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("A valid ISO work date is required.");
  }
  return date;
}

export function manilaWorkDate(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid current instant.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function clock(text: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

/**
 * Missing source evidence means unscheduled/needs review, NOT a rest day,
 * lateness determination, or permission to dock payroll.
 */
export function upcomingSevenDays(
  days: readonly EmployeeUpcomingSourceDay[],
  today: string,
): EmployeeUpcomingDay[] {
  const anchor = parseIsoDay(today);
  const found = new Map<string, EmployeeUpcomingSourceDay>();
  const duplicates = new Set<string>();
  for (const day of days) {
    try { parseIsoDay(day.date); } catch { continue; }
    if (found.has(day.date)) duplicates.add(day.date);
    else found.set(day.date, day);
  }
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() + offset);
    const key = date.toISOString().slice(0, 10);
    const day = found.get(key);
    if (!day) return {
      date: key, state: "unassigned" as const, changed: false,
      label: "No published shift", segments: [],
    };
    if (duplicates.has(key)) return {
      date: key, state: "review" as const, changed: false,
      label: "Schedule needs review", segments: [],
    };
    // An unassigned day cannot become an authoritative rest day merely
    // because the source resolver returned a default rest-day flag.
    if (day.source === "unassigned") return {
      date: key, state: "unassigned" as const, changed: false,
      label: "No published shift", segments: [],
    };
    if (day.isRestDay) return {
      date: key, state: "rest" as const, changed: day.source === "override",
      label: "Recorded rest day", segments: [],
    };
    if (day.segments.length === 0) return {
      date: key, state: "review" as const, changed: day.source === "override",
      label: "Schedule needs review", segments: [],
    };
    const segments = day.segments.map(item => {
      const start = clock(item.startTime);
      const end = clock(item.endTime);
      return start && end && item.shiftCode.trim()
        ? `${item.shiftCode} · ${start}–${end}${item.spansMidnight ? " (+1 day)" : ""}`
        : null;
    });
    if (segments.some(item => item === null)) return {
      date: key, state: "review" as const, changed: day.source === "override",
      label: "Schedule needs review", segments: [],
    };
    return {
      date: key, state: "shift" as const,
      changed: day.source === "override",
      label: day.source === "override" ? "Approved change" : "Scheduled shift",
      segments: segments.filter((item): item is string => item !== null),
    };
  });
}

export function summarizeUpcomingWeek(days: readonly EmployeeUpcomingDay[]) {
  return {
    scheduled: days.filter(day => day.state === "shift").length,
    changes: days.filter(day => day.changed).length,
    restDays: days.filter(day => day.state === "rest").length,
    needsReview: days.filter(day =>
      day.state === "unassigned" || day.state === "review").length,
  };
}
