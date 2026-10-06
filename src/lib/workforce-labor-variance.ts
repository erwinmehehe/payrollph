export type LaborVarianceShift = {
  id: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight: boolean;
};

export type LaborVarianceRequirement = {
  id: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId?: number | null;
  requiredHeadcount: number;
};

export type ScheduledLaborEntry = {
  employeeId: number;
  worksiteId: number | null;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId?: number | null;
  paidMinutes: number;
  hourlyRate: number;
};

export type ActualLaborEntry = {
  employeeId: number;
  worksiteId: number | null;
  workDate: string;
  shiftDefinitionId: number | null;
  jobProfileId?: number | null;
  workedMinutes: number;
  hourlyRate: number;
  matchedToSchedule: boolean;
  flags?: string[];
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function timeMinute(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new Error(`Invalid shift time "${value}".`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid shift time "${value}".`);
  return hours * 60 + minutes;
}

export function paidShiftMinutes(shift: LaborVarianceShift) {
  const start = timeMinute(shift.startTime);
  let end = timeMinute(shift.endTime);
  if (shift.spansMidnight || end <= start) end += 24 * 60;
  const minutes = end - start - Math.max(0, shift.breakMinutes);
  if (minutes <= 0 || minutes > 24 * 60) {
    throw new Error(`Shift #${shift.id} has an invalid paid duration.`);
  }
  return minutes;
}

export function actualWorkedMinutes(input: {
  timeIn: Date | string | null;
  timeOut: Date | string | null;
  breakStart?: Date | string | null;
  breakEnd?: Date | string | null;
  scheduledBreakMinutes?: number;
}) {
  if (!input.timeIn || !input.timeOut) {
    return { minutes: 0, flags: ["Incomplete punch pair"] };
  }
  const timeIn = new Date(input.timeIn);
  const timeOut = new Date(input.timeOut);
  if (!Number.isFinite(timeIn.getTime()) || !Number.isFinite(timeOut.getTime()) || timeOut <= timeIn) {
    return { minutes: 0, flags: ["Invalid punch sequence"] };
  }

  const grossMinutes = Math.round((timeOut.getTime() - timeIn.getTime()) / 60_000);
  let breakMinutes = Math.max(0, Math.trunc(input.scheduledBreakMinutes ?? 0));
  const flags: string[] = [];

  if (input.breakStart && input.breakEnd) {
    const start = new Date(input.breakStart);
    const end = new Date(input.breakEnd);
    if (
      !Number.isFinite(start.getTime())
      || !Number.isFinite(end.getTime())
      || end <= start
      || start < timeIn
      || end > timeOut
    ) {
      flags.push("Invalid break punch pair");
    } else {
      breakMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    }
  } else if (input.breakStart || input.breakEnd) {
    flags.push("Incomplete break punch pair");
  }

  return {
    minutes: Math.max(0, grossMinutes - breakMinutes),
    flags,
  };
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return numerator > 0 ? 100 : 0;
  return round2((numerator / denominator) * 100);
}

export function computeWorkforceLaborVariance(input: {
  requirements: LaborVarianceRequirement[];
  shifts: LaborVarianceShift[];
  scheduled: ScheduledLaborEntry[];
  actual: ActualLaborEntry[];
  benchmarkHourlyRate: number;
}) {
  const shiftById = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const rows = input.requirements.map((requirement) => {
    const shift = shiftById.get(requirement.shiftDefinitionId);
    if (!shift) throw new Error(`Staffing requirement #${requirement.id} references a missing shift.`);
    const shiftMinutes = paidShiftMinutes(shift);

    const scheduled = input.scheduled.filter((entry) =>
      entry.workDate === requirement.workDate
      && entry.worksiteId === requirement.worksiteId
      && entry.shiftDefinitionId === requirement.shiftDefinitionId
      && (requirement.jobProfileId == null || entry.jobProfileId === requirement.jobProfileId)
    );
    const actual = input.actual.filter((entry) =>
      entry.workDate === requirement.workDate
      && entry.worksiteId === requirement.worksiteId
      && entry.shiftDefinitionId === requirement.shiftDefinitionId
      && (requirement.jobProfileId == null || entry.jobProfileId === requirement.jobProfileId)
    );

    const scheduledHeadcount = new Set(scheduled.map((entry) => entry.employeeId)).size;
    const actualHeadcount = new Set(
      actual.filter((entry) => entry.workedMinutes > 0).map((entry) => entry.employeeId),
    ).size;
    const scheduledMinutes = scheduled.reduce((sum, entry) => sum + Math.max(0, entry.paidMinutes), 0);
    const actualMinutes = actual.reduce((sum, entry) => sum + Math.max(0, entry.workedMinutes), 0);
    const requiredMinutes = Math.max(0, requirement.requiredHeadcount) * shiftMinutes;

    const scheduledBaseCost = scheduled.reduce(
      (sum, entry) => sum + Math.max(0, entry.paidMinutes) / 60 * Math.max(0, entry.hourlyRate),
      0,
    );
    const actualBaseCost = actual.reduce(
      (sum, entry) => sum + Math.max(0, entry.workedMinutes) / 60 * Math.max(0, entry.hourlyRate),
      0,
    );

    let benchmarkHourlyRate = Math.max(0, input.benchmarkHourlyRate);
    let requiredCostBasis: "scheduled-mix" | "actual-mix" | "workspace-average" = "workspace-average";
    if (scheduledMinutes > 0) {
      benchmarkHourlyRate = scheduledBaseCost / (scheduledMinutes / 60);
      requiredCostBasis = "scheduled-mix";
    } else if (actualMinutes > 0) {
      benchmarkHourlyRate = actualBaseCost / (actualMinutes / 60);
      requiredCostBasis = "actual-mix";
    }
    const requiredBaseCost = requiredMinutes / 60 * benchmarkHourlyRate;

    const actualFlags = [...new Set(actual.flatMap((entry) => entry.flags ?? []))];

    return {
      requirementId: requirement.id,
      worksiteId: requirement.worksiteId,
      workDate: requirement.workDate,
      shiftDefinitionId: requirement.shiftDefinitionId,
      jobProfileId: requirement.jobProfileId ?? null,
      requiredHeadcount: requirement.requiredHeadcount,
      scheduledHeadcount,
      actualHeadcount,
      requiredHours: round2(requiredMinutes / 60),
      scheduledHours: round2(scheduledMinutes / 60),
      actualHours: round2(actualMinutes / 60),
      scheduledCoveragePercent: percent(scheduledMinutes, requiredMinutes),
      actualCoveragePercent: percent(actualMinutes, requiredMinutes),
      scheduledVsRequiredHours: round2((scheduledMinutes - requiredMinutes) / 60),
      actualVsScheduledHours: round2((actualMinutes - scheduledMinutes) / 60),
      actualVsRequiredHours: round2((actualMinutes - requiredMinutes) / 60),
      benchmarkHourlyRate: round2(benchmarkHourlyRate),
      requiredCostBasis,
      requiredBaseCost: round2(requiredBaseCost),
      scheduledBaseCost: round2(scheduledBaseCost),
      actualBaseCost: round2(actualBaseCost),
      scheduledVsRequiredBaseCost: round2(scheduledBaseCost - requiredBaseCost),
      actualVsScheduledBaseCost: round2(actualBaseCost - scheduledBaseCost),
      actualVsRequiredBaseCost: round2(actualBaseCost - requiredBaseCost),
      attendanceFlags: actualFlags,
    };
  });

  const requirementMatchesEntry = (entry: {
    worksiteId: number | null;
    workDate: string;
    shiftDefinitionId: number | null;
    jobProfileId?: number | null;
  }) => input.requirements.some((requirement) =>
    requirement.workDate === entry.workDate
    && requirement.worksiteId === entry.worksiteId
    && requirement.shiftDefinitionId === entry.shiftDefinitionId
    && (requirement.jobProfileId == null || requirement.jobProfileId === entry.jobProfileId)
  );
  const unmatchedActual = input.actual.filter((entry) => !requirementMatchesEntry(entry));
  const scheduledOutsideRequirements = input.scheduled.filter(
    (entry) => !requirementMatchesEntry(entry),
  );
  const sum = <T>(items: T[], pick: (item: T) => number) =>
    items.reduce((total, item) => total + pick(item), 0);

  const summary = {
    requiredHours: round2(sum(rows, (row) => row.requiredHours)),
    scheduledHours: round2(sum(rows, (row) => row.scheduledHours)),
    actualHours: round2(sum(rows, (row) => row.actualHours)),
    scheduledVsRequiredHours: round2(sum(rows, (row) => row.scheduledVsRequiredHours)),
    actualVsScheduledHours: round2(sum(rows, (row) => row.actualVsScheduledHours)),
    actualVsRequiredHours: round2(sum(rows, (row) => row.actualVsRequiredHours)),
    requiredBaseCost: round2(sum(rows, (row) => row.requiredBaseCost)),
    scheduledBaseCost: round2(sum(rows, (row) => row.scheduledBaseCost)),
    actualBaseCost: round2(sum(rows, (row) => row.actualBaseCost)),
    scheduledVsRequiredBaseCost: round2(sum(rows, (row) => row.scheduledVsRequiredBaseCost)),
    actualVsScheduledBaseCost: round2(sum(rows, (row) => row.actualVsScheduledBaseCost)),
    actualVsRequiredBaseCost: round2(sum(rows, (row) => row.actualVsRequiredBaseCost)),
    unmatchedActualHours: round2(sum(unmatchedActual, (entry) => Math.max(0, entry.workedMinutes)) / 60),
    unmatchedActualBaseCost: round2(sum(
      unmatchedActual,
      (entry) => Math.max(0, entry.workedMinutes) / 60 * Math.max(0, entry.hourlyRate),
    )),
    scheduledOutsideRequirementHours: round2(sum(
      scheduledOutsideRequirements,
      (entry) => Math.max(0, entry.paidMinutes),
    ) / 60),
    scheduledOutsideRequirementBaseCost: round2(sum(
      scheduledOutsideRequirements,
      (entry) => Math.max(0, entry.paidMinutes) / 60 * Math.max(0, entry.hourlyRate),
    )),
    attendanceExceptionCount: input.actual.filter(
      (entry) => !entry.matchedToSchedule || (entry.flags?.length ?? 0) > 0,
    ).length,
  };

  return {
    version: "workforce-labor-variance-v1" as const,
    costingBoundary: "Base-pay planning estimate only; excludes statutory premiums, OT/NSD overlays, employer contributions and payroll tax.",
    rows,
    summary,
  };
}
