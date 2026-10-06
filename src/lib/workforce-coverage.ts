export type AvailabilityType = "unavailable" | "preferred";

export type AvailabilityRule = {
  id: number;
  employeeId: number;
  weekday: number;
  startTime: string;
  endTime: string;
  availabilityType: AvailabilityType;
  effectiveFrom: string;
  effectiveUntil?: string | null;
};

export type ShiftWindow = {
  id: number;
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
};

export type StaffingRequirementInput = {
  id: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId?: number | null;
  requiredHeadcount: number;
};

export type ScheduledCoverageInput = {
  employeeId: number;
  workDate: string;
  worksiteId: number | null;
  jobProfileId?: number | null;
  shiftDefinitionIds: number[];
  unavailableShiftDefinitionIds?: number[];
  ineligibleShiftDefinitionIds?: number[];
  approvedLeaveShiftDefinitionIds?: number[];
};

function timeMinute(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function interval(startTime: string, endTime: string, spansMidnight?: boolean) {
  const start = timeMinute(startTime);
  let end = timeMinute(endTime);
  if (spansMidnight || end <= start) end += 1440;
  return { start, end };
}

export function weekdayForDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Date must use YYYY-MM-DD.");
  return parsed.getUTCDay();
}

export function availabilityRuleApplies(
  rule: AvailabilityRule,
  date: string,
) {
  if (rule.weekday !== weekdayForDate(date)) return false;
  if (rule.effectiveFrom > date) return false;
  if (rule.effectiveUntil && rule.effectiveUntil < date) return false;
  return true;
}

export function availabilityConflictForShift(input: {
  rules: AvailabilityRule[];
  date: string;
  shift: ShiftWindow;
}) {
  const shift = interval(
    input.shift.startTime,
    input.shift.endTime,
    input.shift.spansMidnight,
  );

  return input.rules.some((rule) => {
    if (rule.availabilityType !== "unavailable") return false;
    if (!availabilityRuleApplies(rule, input.date)) return false;
    const unavailable = interval(rule.startTime, rule.endTime);
    return unavailable.start < shift.end && shift.start < unavailable.end;
  });
}

export function preferredForShift(input: {
  rules: AvailabilityRule[];
  date: string;
  shift: ShiftWindow;
}) {
  const shift = interval(
    input.shift.startTime,
    input.shift.endTime,
    input.shift.spansMidnight,
  );

  return input.rules.some((rule) => {
    if (rule.availabilityType !== "preferred") return false;
    if (!availabilityRuleApplies(rule, input.date)) return false;
    const preferred = interval(rule.startTime, rule.endTime);
    return preferred.start <= shift.start && preferred.end >= shift.end;
  });
}

export function computeCoverage(input: {
  requirements: StaffingRequirementInput[];
  scheduled: ScheduledCoverageInput[];
}) {
  return input.requirements.map((requirement) => {
    const matching = input.scheduled.filter((row) =>
      row.workDate === requirement.workDate
      && row.worksiteId === requirement.worksiteId
      && row.shiftDefinitionIds.includes(requirement.shiftDefinitionId)
      && (requirement.jobProfileId == null || row.jobProfileId === requirement.jobProfileId),
    );
    const conflicted = matching.filter((row) =>
      row.unavailableShiftDefinitionIds?.includes(requirement.shiftDefinitionId),
    );
    const capabilityIneligible = requirement.jobProfileId == null
      ? []
      : matching.filter((row) =>
          row.ineligibleShiftDefinitionIds?.includes(requirement.shiftDefinitionId),
        );
    const approvedLeave = matching.filter((row) =>
      row.approvedLeaveShiftDefinitionIds?.includes(requirement.shiftDefinitionId),
    );
    const unavailableOrIneligible = new Set([
      ...conflicted.map((row) => row.employeeId),
      ...capabilityIneligible.map((row) => row.employeeId),
      ...approvedLeave.map((row) => row.employeeId),
    ]);
    const availableScheduled = matching.filter((row) => !unavailableOrIneligible.has(row.employeeId)).length;
    const gap = Math.max(0, requirement.requiredHeadcount - availableScheduled);

    return {
      requirementId: requirement.id,
      worksiteId: requirement.worksiteId,
      workDate: requirement.workDate,
      shiftDefinitionId: requirement.shiftDefinitionId,
      jobProfileId: requirement.jobProfileId ?? null,
      requiredHeadcount: requirement.requiredHeadcount,
      scheduledHeadcount: matching.length,
      unavailableScheduledHeadcount: conflicted.length,
      capabilityIneligibleHeadcount: capabilityIneligible.length,
      approvedLeaveScheduledHeadcount: approvedLeave.length,
      availableScheduledHeadcount: availableScheduled,
      gap,
      overage: Math.max(0, availableScheduled - requirement.requiredHeadcount),
    };
  });
}

export function remainingOpenShiftSlots(input: {
  slots: number;
  approvedClaims: number;
}) {
  return Math.max(0, input.slots - input.approvedClaims);
}
