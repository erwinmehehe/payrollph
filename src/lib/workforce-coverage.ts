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
  siteIneligibleShiftDefinitionIds?: number[];
  paidMinutesByShiftDefinitionId?: Record<number, number>;
  approvedLeaveUnavailableMinutesByShiftDefinitionId?: Record<number, number>;
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
    const siteIneligible = matching.filter((row) =>
      row.siteIneligibleShiftDefinitionIds?.includes(requirement.shiftDefinitionId),
    );
    const unavailableOrIneligible = new Set([
      ...conflicted.map((row) => row.employeeId),
      ...capabilityIneligible.map((row) => row.employeeId),
      ...approvedLeave.map((row) => row.employeeId),
      ...siteIneligible.map((row) => row.employeeId),
    ]);
    const availableScheduled = matching.filter((row) => !unavailableOrIneligible.has(row.employeeId)).length;
    const scheduledPaidMinutes = matching.reduce(
      (sum, row) => sum + Math.max(0, Number(row.paidMinutesByShiftDefinitionId?.[requirement.shiftDefinitionId] ?? 0)),
      0,
    );
    const approvedLeaveUnavailableMinutes = matching.reduce(
      (sum, row) => sum + Math.max(0, Number(row.approvedLeaveUnavailableMinutesByShiftDefinitionId?.[requirement.shiftDefinitionId] ?? 0)),
      0,
    );
    const approvedLeavePartiallyUnavailable = matching.filter((row) => {
      const paid = Math.max(0, Number(row.paidMinutesByShiftDefinitionId?.[requirement.shiftDefinitionId] ?? 0));
      const unavailable = Math.max(0, Number(row.approvedLeaveUnavailableMinutesByShiftDefinitionId?.[requirement.shiftDefinitionId] ?? 0));
      return paid > 0
        && unavailable > 0
        && unavailable < paid
        && !row.approvedLeaveShiftDefinitionIds?.includes(requirement.shiftDefinitionId);
    });
    const availableScheduledMinutes = matching.reduce((sum, row) => {
      if (unavailableOrIneligible.has(row.employeeId)) return sum;
      const paid = Math.max(0, Number(row.paidMinutesByShiftDefinitionId?.[requirement.shiftDefinitionId] ?? 0));
      const unavailable = Math.max(0, Number(row.approvedLeaveUnavailableMinutesByShiftDefinitionId?.[requirement.shiftDefinitionId] ?? 0));
      return sum + Math.max(0, paid - Math.min(paid, unavailable));
    }, 0);
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
      approvedLeavePartiallyUnavailableHeadcount: approvedLeavePartiallyUnavailable.length,
      approvedLeaveUnavailableMinutes,
      scheduledPaidMinutes,
      availableScheduledMinutes,
      siteIneligibleHeadcount: siteIneligible.length,
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


export type CoverageCandidateInput = {
  employeeId: number;
  employeeName: string;
  preferred: boolean;
  scheduledMinutesInWindow: number;
  consecutiveWorkingDaysBeforeShift: number;
  alreadyWorkingThatDay: boolean;
};

export type RankedCoverageCandidate = CoverageCandidateInput & {
  score: number;
  workloadRisk: "low" | "medium" | "high";
  reasons: string[];
};

export function rankCoverageCandidates(input: {
  candidates: CoverageCandidateInput[];
  shiftPaidMinutes: number;
  maxRecommendations?: number;
}) {
  const maxRecommendations = Math.max(1, Math.min(20, input.maxRecommendations ?? 5));
  const shiftPaidMinutes = Math.max(0, input.shiftPaidMinutes);

  return input.candidates
    .filter((candidate) => !candidate.alreadyWorkingThatDay)
    .map((candidate): RankedCoverageCandidate => {
      const projectedMinutes = candidate.scheduledMinutesInWindow + shiftPaidMinutes;
      const projectedHours = projectedMinutes / 60;
      const fairnessBonus = Math.max(0, Math.min(30, Math.round((48 - Math.min(48, candidate.scheduledMinutesInWindow / 60)) * 0.625)));
      const preferenceBonus = candidate.preferred ? 20 : 0;
      const consecutivePenalty = Math.max(0, candidate.consecutiveWorkingDaysBeforeShift - 4) * 8;
      const workloadPenalty = projectedHours > 48 ? 25 : projectedHours > 40 ? 10 : 0;
      const score = 50 + fairnessBonus + preferenceBonus - consecutivePenalty - workloadPenalty;
      const workloadRisk: RankedCoverageCandidate["workloadRisk"] =
        projectedHours > 48 || candidate.consecutiveWorkingDaysBeforeShift >= 6
          ? "high"
          : projectedHours > 40 || candidate.consecutiveWorkingDaysBeforeShift >= 5
            ? "medium"
            : "low";
      const reasons = [
        candidate.preferred ? "Matches preferred availability" : "Available for the shift",
        `${(candidate.scheduledMinutesInWindow / 60).toFixed(1)}h currently scheduled in the planning window`,
      ];
      if (candidate.consecutiveWorkingDaysBeforeShift > 0) {
        reasons.push(`${candidate.consecutiveWorkingDaysBeforeShift} consecutive working day(s) before this shift`);
      }
      if (workloadRisk !== "low") reasons.push(`Projected workload risk: ${workloadRisk}`);

      return {
        ...candidate,
        score,
        workloadRisk,
        reasons,
      };
    })
    .sort((a, b) =>
      b.score - a.score
      || a.scheduledMinutesInWindow - b.scheduledMinutesInWindow
      || a.employeeName.localeCompare(b.employeeName),
    )
    .slice(0, maxRecommendations);
}


export type CoverageRiskInput = {
  requirementId: number;
  gap: number;
  eligibleRecoveryCandidates: number;
  unavailableScheduledHeadcount?: number;
  capabilityIneligibleHeadcount?: number;
  approvedLeaveScheduledHeadcount?: number;
  siteIneligibleHeadcount?: number;
};

export type CoverageRisk = {
  requirementId: number;
  level: "low" | "medium" | "high" | "critical";
  reasons: string[];
};

export function forecastCoverageRisk(rows: CoverageRiskInput[]): CoverageRisk[] {
  return rows.map((row) => {
    const exclusions =
      (row.unavailableScheduledHeadcount ?? 0)
      + (row.capabilityIneligibleHeadcount ?? 0)
      + (row.approvedLeaveScheduledHeadcount ?? 0)
      + (row.siteIneligibleHeadcount ?? 0);
    const reasons: string[] = [];
    let level: CoverageRisk["level"] = "low";

    if (row.gap > 0 && row.eligibleRecoveryCandidates === 0) {
      level = "critical";
      reasons.push(`${row.gap} uncovered slot(s) with no governed eligible recovery candidate`);
    } else if (row.gap > 0 && row.eligibleRecoveryCandidates < row.gap) {
      level = "high";
      reasons.push(`${row.gap} uncovered slot(s) but only ${row.eligibleRecoveryCandidates} eligible recovery candidate(s)`);
    } else if (row.gap > 0) {
      level = "medium";
      reasons.push(`${row.gap} uncovered slot(s) remain before publish`);
    }

    if (exclusions > 0) {
      reasons.push(`${exclusions} scheduled worker exclusion(s) from availability, qualification, leave, or worksite rules`);
      if (level === "low") level = "medium";
    }

    if (reasons.length === 0) reasons.push("Recorded staffing demand is covered with no current exclusion signal");
    return { requirementId: row.requirementId, level, reasons };
  });
}
