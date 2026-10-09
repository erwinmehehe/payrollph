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


export type CoverageSimulationRequirement = {
  requirementId: number;
  workDate: string;
  gap: number;
  /** Verified payable duration of the proposed shift; required for guarded drafts. */
  shiftPaidMinutes?: number;
  candidates: Array<{
    employeeId: number;
    employeeName: string;
    score: number;
    workloadRisk: "low" | "medium" | "high";
    /** Baseline minutes scheduled across this exact planning window. */
    scheduledMinutesInWindow?: number;
    consecutiveWorkingDaysBeforeShift?: number;
  }>;
};

export type CoverageSimulation = {
  fills: Array<{
    requirementId: number;
    workDate: string;
    employeeId: number;
    employeeName: string;
    score: number;
    workloadRisk: "low" | "medium" | "high";
  }>;
  baselineGap: number;
  projectedGap: number;
  avoidedHighRiskCandidates: number;
  /** Additional shifts that would breach an explicit planning-window cap. */
  avoidedProjectedOverload: number;
  /** Additional shifts that would break the manager's consecutive-day policy. */
  avoidedConsecutiveStreak: number;
  /** Candidate rows excluded because their required workload evidence is unknown. */
  missingWorkloadEvidence: number;
  requirementsRecovered: number;
  requirementsStillAtRisk: number;
};

function previousIsoDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const stamp = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) return null;
  return new Date(stamp - 86_400_000).toISOString().slice(0, 10);
}

/**
 * A draft-only, deterministic recovery plan. Never publishes shifts. Guards
 * accumulate across proposed dates instead of treating each row independently.
 * All authoritative employment, OT, rest, leave and role checks still belong to
 * the existing manager-stage/approval handlers.
 */
export function simulateBestFitCoverage(input: {
  requirements: CoverageSimulationRequirement[];
  allowHighWorkloadRisk?: boolean;
  /** Optional company planning guideline, not a statutory PH weekly-hour rule. */
  maxProjectedMinutesInWindow?: number;
  maxConsecutiveWorkingDays?: number;
}): CoverageSimulation {
  const usedEmployeeDate = new Set<string>();
  const extraMinutesByEmployee = new Map<number, number>();
  const selectedCountByEmployee = new Map<number, number>();
  const projectedStreak = new Map<number, { date: string; consecutiveDays: number }>();
  const fills: CoverageSimulation["fills"] = [];
  let avoidedHighRiskCandidates = 0;
  let avoidedProjectedOverload = 0;
  let avoidedConsecutiveStreak = 0;
  let missingWorkloadEvidence = 0;
  let requirementsRecovered = 0;
  let requirementsStillAtRisk = 0;
  const enforceMinutes = input.maxProjectedMinutesInWindow !== undefined;
  const enforceDays = input.maxConsecutiveWorkingDays !== undefined;
  const minuteCap = input.maxProjectedMinutesInWindow;
  const dayCap = input.maxConsecutiveWorkingDays;
  const validMinuteCap = !enforceMinutes || (Number.isSafeInteger(minuteCap) && minuteCap! > 0);
  const validDayCap = !enforceDays || (Number.isSafeInteger(dayCap) && dayCap! >= 1 && dayCap! <= 14);
  const baselineGap = input.requirements.reduce(
    (sum, row) => sum + Math.max(0, row.gap), 0,
  );

  // Chronological selection is required so earlier draft shifts influence
  // next-day streaks and later shifts consume their actual available capacity.
  for (const requirement of [...input.requirements].sort((a, b) =>
    a.workDate.localeCompare(b.workDate) || b.gap - a.gap || a.requirementId - b.requirementId
  )) {
    let remaining = Math.max(0, requirement.gap);
    const ranked = [...requirement.candidates].sort((a, b) =>
      (b.score - (selectedCountByEmployee.get(b.employeeId) ?? 0) * 12)
      - (a.score - (selectedCountByEmployee.get(a.employeeId) ?? 0) * 12)
      || a.employeeName.localeCompare(b.employeeName)
    );
    for (const candidate of ranked) {
      if (remaining <= 0) break;
      const key = `${candidate.employeeId}|${requirement.workDate}`;
      if (usedEmployeeDate.has(key)) continue;
      if (candidate.workloadRisk === "high" && !input.allowHighWorkloadRisk) {
        avoidedHighRiskCandidates += 1;
        continue;
      }

      let extraMinutes = 0;
      if (enforceMinutes) {
        const initial = candidate.scheduledMinutesInWindow;
        const shift = requirement.shiftPaidMinutes;
        if (!validMinuteCap || !Number.isSafeInteger(initial) || initial! < 0
          || !Number.isSafeInteger(shift) || shift! <= 0) {
          missingWorkloadEvidence += 1;
          continue;
        }
        extraMinutes = extraMinutesByEmployee.get(candidate.employeeId) ?? 0;
        if (initial! + extraMinutes + shift! > minuteCap!) {
          avoidedProjectedOverload += 1;
          continue;
        }
      }

      let streakAfter = 0;
      if (enforceDays) {
        const dateBefore = previousIsoDate(requirement.workDate);
        const reported = candidate.consecutiveWorkingDaysBeforeShift;
        if (!validDayCap || dateBefore === null
          || !Number.isSafeInteger(reported) || reported! < 0) {
          missingWorkloadEvidence += 1;
          continue;
        }
        const previous = projectedStreak.get(candidate.employeeId);
        const before = previous?.date === dateBefore
          ? Math.max(reported!, previous.consecutiveDays)
          : reported!;
        streakAfter = before + 1;
        if (streakAfter > dayCap!) {
          avoidedConsecutiveStreak += 1;
          continue;
        }
      }

      usedEmployeeDate.add(key);
      if (enforceMinutes) extraMinutesByEmployee.set(
        candidate.employeeId, extraMinutes + requirement.shiftPaidMinutes!,
      );
      if (enforceDays) projectedStreak.set(candidate.employeeId, {
        date: requirement.workDate, consecutiveDays: streakAfter,
      });
      const previousCount = selectedCountByEmployee.get(candidate.employeeId) ?? 0;
      selectedCountByEmployee.set(candidate.employeeId, previousCount + 1);
      fills.push({
        requirementId: requirement.requirementId,
        workDate: requirement.workDate,
        employeeId: candidate.employeeId,
        employeeName: candidate.employeeName,
        score: candidate.score - previousCount * 12,
        workloadRisk: candidate.workloadRisk,
      });
      remaining -= 1;
    }
    if (requirement.gap > 0 && remaining === 0) requirementsRecovered += 1;
    if (remaining > 0) requirementsStillAtRisk += 1;
  }
  return {
    fills,
    baselineGap,
    projectedGap: Math.max(0, baselineGap - fills.length),
    avoidedHighRiskCandidates,
    avoidedProjectedOverload,
    avoidedConsecutiveStreak,
    missingWorkloadEvidence,
    requirementsRecovered,
    requirementsStillAtRisk,
  };
}

export type RosterReadinessSignal = {
  code:
    | "coverage_gap"
    | "coverage_critical"
    | "coverage_high"
    | "pending_recovery"
    | "blocking_guardrail"
    | "role_evidence"
    | "capability_evidence"
    | "absence_evidence"
    | "site_evidence";
  level: "blocker" | "warning";
  count: number;
  message: string;
};

export type RosterPublishReadiness = {
  status: "ready" | "warning" | "blocked";
  blockerCount: number;
  warningCount: number;
  signals: RosterReadinessSignal[];
};

export function buildRosterPublishReadiness(input: {
  coverageRisk: Array<{ level: "low" | "medium" | "high" | "critical" }>;
  uncoveredRequirements: number;
  uncoveredSlots: number;
  pendingRecoveryClaims: number;
  blockingGuardrailIssues: number;
  roleEvidenceIssues: number;
  capabilityEvidenceIssues: number;
  absenceEvidenceIssues: number;
  siteEvidenceIssues: number;
}): RosterPublishReadiness {
  const signals: RosterReadinessSignal[] = [];
  const criticalCoverage = input.coverageRisk.filter((row) => row.level === "critical").length;
  const highCoverage = input.coverageRisk.filter((row) => row.level === "high").length;

  if (input.uncoveredRequirements > 0) {
    signals.push({
      code: "coverage_gap",
      level: "blocker",
      count: input.uncoveredRequirements,
      message: `${input.uncoveredSlots} required staffing slot(s) remain uncovered across ${input.uncoveredRequirements} requirement(s).`,
    });
  }

  if (criticalCoverage > 0) {
    signals.push({
      code: "coverage_critical",
      level: "blocker",
      count: criticalCoverage,
      message: `${criticalCoverage} staffing requirement(s) have uncovered demand with no governed eligible recovery candidate.`,
    });
  }
  if (highCoverage > 0) {
    signals.push({
      code: "coverage_high",
      level: "warning",
      count: highCoverage,
      message: `${highCoverage} staffing requirement(s) have a recovery bench smaller than the remaining gap.`,
    });
  }
  if (input.pendingRecoveryClaims > 0) {
    signals.push({
      code: "pending_recovery",
      level: "warning",
      count: input.pendingRecoveryClaims,
      message: `${input.pendingRecoveryClaims} recovery claim(s) still need a manager decision.`,
    });
  }
  if (input.blockingGuardrailIssues > 0) {
    signals.push({
      code: "blocking_guardrail",
      level: "blocker",
      count: input.blockingGuardrailIssues,
      message: `${input.blockingGuardrailIssues} blocking schedule guardrail issue(s) remain unresolved.`,
    });
  }

  const evidence: Array<[RosterReadinessSignal["code"], number, string]> = [
    ["role_evidence", input.roleEvidenceIssues, "job-profile evidence"],
    ["capability_evidence", input.capabilityEvidenceIssues, "skills/credential evidence"],
    ["absence_evidence", input.absenceEvidenceIssues, "leave/absence evidence"],
    ["site_evidence", input.siteEvidenceIssues, "worksite eligibility evidence"],
  ];
  for (const [code, count, label] of evidence) {
    if (count <= 0) continue;
    signals.push({
      code,
      level: code === "role_evidence" ? "blocker" : "warning",
      count,
      message: `${count} ${label} issue(s) need review before the roster is treated as final.`,
    });
  }

  const blockerCount = signals
    .filter((signal) => signal.level === "blocker")
    .reduce((sum, signal) => sum + signal.count, 0);
  const warningCount = signals
    .filter((signal) => signal.level === "warning")
    .reduce((sum, signal) => sum + signal.count, 0);

  return {
    status: blockerCount > 0 ? "blocked" : warningCount > 0 ? "warning" : "ready",
    blockerCount,
    warningCount,
    signals,
  };
}
