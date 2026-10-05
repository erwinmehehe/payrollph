const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export type WorkforceShiftDefinition = {
  id: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight?: boolean;
};

export type WorkforceSchedulePattern = {
  id: number;
  code?: string;
  name?: string;
  cycleDays: number;
};

export type WorkforceSchedulePatternDay = {
  id: number;
  patternId: number;
  dayIndex: number;
  isRestDay: boolean;
  label?: string | null;
};

export type WorkforceSchedulePatternSegment = {
  patternDayId: number;
  shiftDefinitionId: number;
  segmentOrder: number;
};

export type WorkforceScheduleAssignment = {
  id: number;
  patternId: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  anchorDate: string;
  workLocationOrgUnitId?: number | null;
  worksiteId?: number | null;
};

export type WorkforceScheduleOverrideSegment = {
  shiftDefinitionId: number;
  segmentOrder: number;
};

export type WorkforceScheduleOverride = {
  id: number;
  workDate: string;
  kind: "shift" | "split_shift" | "rest_day" | "off" | "location";
  isRestDay: boolean;
  segments?: WorkforceScheduleOverrideSegment[];
  workLocationOrgUnitId?: number | null;
  worksiteId?: number | null;
  status?: "pending" | "approved" | "rejected" | "cancelled";
  reason?: string;
};

export type ResolvedScheduleSegment = {
  shiftDefinitionId: number;
  shiftCode: string;
  shiftName: string;
  segmentOrder: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight: boolean;
};

export type ResolvedDailySchedule = {
  date: string;
  source: "pattern" | "override" | "unassigned";
  isRestDay: boolean;
  assignmentId: number | null;
  patternId: number | null;
  patternDayIndex: number | null;
  overrideId: number | null;
  workLocationOrgUnitId: number | null;
  worksiteId: number | null;
  segments: ResolvedScheduleSegment[];
  audit: string[];
};

function assertIsoDate(value: string, label: string) {
  if (!ISO_DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
}

function dateOrdinal(value: string) {
  assertIsoDate(value, "Schedule date");
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`Invalid schedule date: ${value}.`);
  return Math.floor(ms / 86_400_000);
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

function validateTime(value: string, label: string) {
  if (!TIME_OF_DAY.test(value)) {
    throw new Error(`${label} must use 24-hour HH:MM or HH:MM:SS format.`);
  }
}

export function shiftCrossesMidnight(
  shift: Pick<WorkforceShiftDefinition, "startTime" | "endTime" | "spansMidnight">,
) {
  validateTime(shift.startTime, "Shift start");
  validateTime(shift.endTime, "Shift end");
  return Boolean(shift.spansMidnight) || shift.endTime <= shift.startTime;
}

export function selectEffectiveScheduleAssignment(
  assignments: WorkforceScheduleAssignment[],
  date: string,
) {
  assertIsoDate(date, "Work date");

  const candidates = assignments
    .filter((assignment) => {
      assertIsoDate(assignment.effectiveFrom, "Assignment effectiveFrom");
      assertIsoDate(assignment.anchorDate, "Assignment anchorDate");
      if (assignment.effectiveUntil) {
        assertIsoDate(assignment.effectiveUntil, "Assignment effectiveUntil");
        if (assignment.effectiveUntil < assignment.effectiveFrom) {
          throw new Error(`Schedule assignment #${assignment.id} ends before it starts.`);
        }
      }
      return assignment.effectiveFrom <= date
        && (!assignment.effectiveUntil || assignment.effectiveUntil >= date);
    })
    .sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id
    );

  return candidates[0] ?? null;
}

function resolveSegments(
  segmentInputs: Array<{ shiftDefinitionId: number; segmentOrder: number }>,
  shifts: WorkforceShiftDefinition[],
) {
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
  const sorted = [...segmentInputs].sort((a, b) => a.segmentOrder - b.segmentOrder);

  const seenOrders = new Set<number>();
  return sorted.map((segment) => {
    if (!Number.isInteger(segment.segmentOrder) || segment.segmentOrder < 1) {
      throw new Error("Schedule segment order must be a positive integer.");
    }
    if (seenOrders.has(segment.segmentOrder)) {
      throw new Error(`Duplicate schedule segment order ${segment.segmentOrder}.`);
    }
    seenOrders.add(segment.segmentOrder);

    const shift = shiftById.get(segment.shiftDefinitionId);
    if (!shift) {
      throw new Error(`Schedule references missing shift definition #${segment.shiftDefinitionId}.`);
    }
    if (shift.breakMinutes < 0) {
      throw new Error(`Shift ${shift.code} has a negative break duration.`);
    }

    return {
      shiftDefinitionId: shift.id,
      shiftCode: shift.code,
      shiftName: shift.name,
      segmentOrder: segment.segmentOrder,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      spansMidnight: shiftCrossesMidnight(shift),
    } satisfies ResolvedScheduleSegment;
  });
}

export function validateSchedulePattern(input: {
  pattern: WorkforceSchedulePattern;
  days: WorkforceSchedulePatternDay[];
  segments: WorkforceSchedulePatternSegment[];
  shifts: WorkforceShiftDefinition[];
}) {
  const { pattern } = input;
  if (!Number.isInteger(pattern.cycleDays) || pattern.cycleDays < 1 || pattern.cycleDays > 56) {
    throw new Error("Schedule pattern cycleDays must be an integer from 1 to 56.");
  }

  const patternDays = input.days.filter((day) => day.patternId === pattern.id);
  const byIndex = new Map<number, WorkforceSchedulePatternDay>();
  for (const day of patternDays) {
    if (!Number.isInteger(day.dayIndex) || day.dayIndex < 0 || day.dayIndex >= pattern.cycleDays) {
      throw new Error(
        `Pattern day index ${day.dayIndex} is outside cycle 0..${pattern.cycleDays - 1}.`,
      );
    }
    if (byIndex.has(day.dayIndex)) {
      throw new Error(`Pattern contains duplicate day index ${day.dayIndex}.`);
    }
    byIndex.set(day.dayIndex, day);
  }

  for (let dayIndex = 0; dayIndex < pattern.cycleDays; dayIndex += 1) {
    const day = byIndex.get(dayIndex);
    if (!day) throw new Error(`Pattern is missing day index ${dayIndex}.`);

    const daySegments = input.segments.filter((segment) => segment.patternDayId === day.id);
    if (day.isRestDay && daySegments.length > 0) {
      throw new Error(`Rest day ${dayIndex} cannot contain work segments.`);
    }
    if (!day.isRestDay && daySegments.length === 0) {
      throw new Error(`Working day ${dayIndex} must contain at least one shift segment.`);
    }
    resolveSegments(daySegments, input.shifts);
  }

  return true;
}

export function resolveDailySchedule(input: {
  date: string;
  assignments: WorkforceScheduleAssignment[];
  patterns: WorkforceSchedulePattern[];
  patternDays: WorkforceSchedulePatternDay[];
  patternSegments: WorkforceSchedulePatternSegment[];
  shifts: WorkforceShiftDefinition[];
  overrides?: WorkforceScheduleOverride[];
  defaultWorksiteId?: number | null;
}): ResolvedDailySchedule {
  assertIsoDate(input.date, "Work date");

  const assignment = selectEffectiveScheduleAssignment(input.assignments, input.date);
  let base: ResolvedDailySchedule;

  if (!assignment) {
    base = {
      date: input.date,
      source: "unassigned",
      isRestDay: false,
      assignmentId: null,
      patternId: null,
      patternDayIndex: null,
      overrideId: null,
      workLocationOrgUnitId: null,
      worksiteId: input.defaultWorksiteId ?? null,
      segments: [],
      audit: ["No effective schedule assignment; schedule was not guessed."],
    };
  } else {
    const pattern = input.patterns.find((row) => row.id === assignment.patternId);
    if (!pattern) {
      throw new Error(
        `Schedule assignment #${assignment.id} references missing pattern #${assignment.patternId}.`,
      );
    }
    validateSchedulePattern({
      pattern,
      days: input.patternDays,
      segments: input.patternSegments,
      shifts: input.shifts,
    });

    const elapsedDays = dateOrdinal(input.date) - dateOrdinal(assignment.anchorDate);
    const patternDayIndex = positiveModulo(elapsedDays, pattern.cycleDays);
    const patternDay = input.patternDays.find(
      (day) => day.patternId === pattern.id && day.dayIndex === patternDayIndex,
    );
    if (!patternDay) {
      throw new Error(
        `Pattern #${pattern.id} has no day ${patternDayIndex} for ${input.date}.`,
      );
    }

    const segments = patternDay.isRestDay
      ? []
      : resolveSegments(
          input.patternSegments.filter(
            (segment) => segment.patternDayId === patternDay.id,
          ),
          input.shifts,
        );

    base = {
      date: input.date,
      source: "pattern",
      isRestDay: patternDay.isRestDay,
      assignmentId: assignment.id,
      patternId: pattern.id,
      patternDayIndex,
      overrideId: null,
      workLocationOrgUnitId: assignment.workLocationOrgUnitId ?? null,
      worksiteId: assignment.worksiteId ?? input.defaultWorksiteId ?? null,
      segments,
      audit: [
        `assignmentId=${assignment.id}`,
        `patternId=${pattern.id}`,
        `patternDayIndex=${patternDayIndex}`,
        `anchorDate=${assignment.anchorDate}`,
        `isRestDay=${patternDay.isRestDay}`,
      ],
    };
  }

  const approvedOverrides = (input.overrides ?? []).filter(
    (override) =>
      override.workDate === input.date
      && (override.status ?? "approved") === "approved",
  );
  if (approvedOverrides.length > 1) {
    throw new Error(`More than one approved schedule override exists for ${input.date}.`);
  }

  const override = approvedOverrides[0];
  if (!override) return base;

  const rest =
    override.isRestDay
    || override.kind === "rest_day"
    || override.kind === "off";

  if (rest) {
    return {
      ...base,
      source: "override",
      isRestDay: true,
      overrideId: override.id,
      workLocationOrgUnitId:
        override.workLocationOrgUnitId ?? base.workLocationOrgUnitId,
      worksiteId: override.worksiteId ?? base.worksiteId,
      segments: [],
      audit: [
        ...base.audit,
        `overrideId=${override.id}`,
        `overrideKind=${override.kind}`,
        "isRestDay=true",
      ],
    };
  }

  if (override.kind === "location") {
    if (base.source === "unassigned") {
      throw new Error(
        `Location override #${override.id} cannot supply a missing work schedule.`,
      );
    }
    return {
      ...base,
      source: "override",
      overrideId: override.id,
      workLocationOrgUnitId:
        override.workLocationOrgUnitId ?? base.workLocationOrgUnitId,
      worksiteId: override.worksiteId ?? base.worksiteId,
      audit: [
        ...base.audit,
        `overrideId=${override.id}`,
        "overrideKind=location",
      ],
    };
  }

  const overrideSegments = resolveSegments(override.segments ?? [], input.shifts);
  if (overrideSegments.length === 0) {
    throw new Error(
      `Approved ${override.kind} override #${override.id} has no shift segments.`,
    );
  }

  return {
    ...base,
    source: "override",
    isRestDay: false,
    overrideId: override.id,
    workLocationOrgUnitId:
      override.workLocationOrgUnitId ?? base.workLocationOrgUnitId,
    worksiteId: override.worksiteId ?? base.worksiteId,
    segments: overrideSegments,
    audit: [
      ...base.audit,
      `overrideId=${override.id}`,
      `overrideKind=${override.kind}`,
      "isRestDay=false",
    ],
  };
}
