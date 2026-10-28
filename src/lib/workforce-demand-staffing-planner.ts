/**
 * Advisory, pure demand-to-staffing calculation. No employee assignment, shift
 * publication, payroll calculation or statutory rate inference.
 * All forecast, capacity, skill and wage evidence must already be scoped by
 * authorized server code before this function is called.
 */
export type DemandStaffingSlot = {
  workDate: string;
  startTime: string;
  predictedCount: number | null;
  lowerScenarioCount: number | null;
  upperScenarioCount: number | null;
  scheduledHeadcount: number | null;
  /** Each forecast count represents this many PH-local activity minutes. */
  demandIntervalMinutes?: 15 | 30 | 60;
  availableEligibleHeadcount: number | null;
  eligibleSkillEvidenceComplete: boolean;
  restAndAvailabilityEvidenceComplete: boolean;
  serviceTargetCoveragePercent: number;
  productiveUnitsPerWorkerHour: number;
  paidMinutesPerWorker: number;
  hourlyBaseCostPhp: number | null;
  overtimeHoursPerAddedWorker: number | null;
  overtimeRateMultiplier: number | null;
};
export type DemandStaffingRow = {
  workDate: string;
  startTime: string;
  requiredWorkers: number | null;
  lowScenarioWorkers: number | null;
  highScenarioWorkers: number | null;
  scheduledWorkers: number | null;
  gapWorkers: number | null;
  feasibleDraftAdds: number | null;
  uncoveredWorkers: number | null;
  estimatedAddedBaseCostPhp: number | null;
  estimatedAddedOvertimeCostPhp: number | null;
  reviewReasons: string[];
};
export type DemandStaffingResult = {
  status: "review_ready" | "source_review";
  approvalRequired: true;
  automaticallyPublished: false;
  rows: DemandStaffingRow[];
  totals: {
    gaps: number | null;
    feasibleDraftAdds: number | null;
    uncovered: number | null;
    estimatedBaseCostPhp: number | null;
    estimatedOvertimeCostPhp: number | null;
  };
  boundary: string;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const limit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1_000_000;
const rounded = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const count = (n: number, perHour: number, minutes: number, servicePercent: number) => {
  const workers = Math.ceil((n * servicePercent / 100) / (perHour * minutes / 60));
  return Number.isSafeInteger(workers) && workers >= 0 && workers <= 10000 ? workers : null;
};

export function previewDemandToStaffing(slots: readonly DemandStaffingSlot[]): DemandStaffingResult {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 672) {
    throw new Error("Select 1 to 672 scoped forecast intervals.");
  }
  const seen = new Set<string>();
  const rows: DemandStaffingRow[] = slots.map(s => {
    const dateTime = Date.parse(s.workDate + "T00:00:00Z");
    const key = s.workDate + "|" + s.startTime;
    if (!DATE.test(s.workDate) || !Number.isFinite(dateTime) ||
      new Date(dateTime).toISOString().slice(0, 10) !== s.workDate ||
      !TIME.test(s.startTime) || seen.has(key) ||
      (s.scheduledHeadcount !== null && (!Number.isSafeInteger(s.scheduledHeadcount) ||
        s.scheduledHeadcount < 0 || s.scheduledHeadcount > 10000)) ||
      (s.demandIntervalMinutes !== undefined && ![15, 30, 60].includes(s.demandIntervalMinutes)) ||
      ![s.predictedCount, s.lowerScenarioCount, s.upperScenarioCount].every(x =>
        x === null || (Number.isSafeInteger(x) && limit(x))) ||
      !Number.isFinite(s.productiveUnitsPerWorkerHour) ||
      s.productiveUnitsPerWorkerHour <= 0 || s.productiveUnitsPerWorkerHour > 1_000_000 ||
      !Number.isSafeInteger(s.paidMinutesPerWorker) ||
      s.paidMinutesPerWorker < 15 || s.paidMinutesPerWorker > 1440 ||
      !Number.isFinite(s.serviceTargetCoveragePercent) ||
      s.serviceTargetCoveragePercent <= 0 || s.serviceTargetCoveragePercent > 100 ||
      // Never interpret truthy JSON strings/numbers as independently verified
      // skill or worker rest/availability proof in a scenario result.
      typeof s.eligibleSkillEvidenceComplete !== "boolean" ||
      typeof s.restAndAvailabilityEvidenceComplete !== "boolean" ||
      (s.availableEligibleHeadcount !== null &&
        (!Number.isSafeInteger(s.availableEligibleHeadcount) ||
         s.availableEligibleHeadcount < 0 || s.availableEligibleHeadcount > 10000)) ||
      (s.hourlyBaseCostPhp !== null && !limit(s.hourlyBaseCostPhp)) ||
      (s.overtimeHoursPerAddedWorker !== null && !limit(s.overtimeHoursPerAddedWorker)) ||
      (s.overtimeRateMultiplier !== null &&
        (!Number.isFinite(s.overtimeRateMultiplier) || s.overtimeRateMultiplier < 1 ||
         s.overtimeRateMultiplier > 10))) {
      throw new Error("Invalid, duplicated or unbounded demand-to-staffing evidence.");
    }
    seen.add(key);
    const reasons: string[] = [];
    if (s.scheduledHeadcount === null) reasons.push("missing_roster_evidence");
    if (s.predictedCount === null || s.lowerScenarioCount === null ||
      s.upperScenarioCount === null) reasons.push("missing_forecast");
    if (s.predictedCount !== null && s.lowerScenarioCount !== null &&
        s.upperScenarioCount !== null &&
        (s.lowerScenarioCount > s.predictedCount ||
          s.predictedCount > s.upperScenarioCount)) reasons.push("invalid_scenario_range");
    if (!s.eligibleSkillEvidenceComplete) reasons.push("skill_evidence_missing");
    if (!s.restAndAvailabilityEvidenceComplete) reasons.push("rest_availability_evidence_missing");
    if (s.availableEligibleHeadcount === null) reasons.push("eligible_capacity_unknown");
    if (s.hourlyBaseCostPhp === null) reasons.push("cost_evidence_missing");
    if (s.overtimeHoursPerAddedWorker === null ||
      s.overtimeRateMultiplier === null) reasons.push("overtime_cost_evidence_missing");
    const forecastUsable = !reasons.some(reason =>
      reason === "missing_forecast" || reason === "invalid_scenario_range");
    const countMinutes = s.demandIntervalMinutes ?? s.paidMinutesPerWorker;
    const required = forecastUsable
      ? count(s.predictedCount!, s.productiveUnitsPerWorkerHour,
        countMinutes, s.serviceTargetCoveragePercent) : null;
    if (forecastUsable && required === null) reasons.push("staffing_estimate_unbounded");
    const gap = required === null || s.scheduledHeadcount === null
      ? null : Math.max(0, required - s.scheduledHeadcount);
    const eligible = s.eligibleSkillEvidenceComplete &&
      s.restAndAvailabilityEvidenceComplete && s.availableEligibleHeadcount !== null;
    // These are theoretical capacity counts only, not worker selection or shift drafts.
    const adds = gap === null || !eligible ? null : Math.min(gap, s.availableEligibleHeadcount!);
    const laborHours = s.paidMinutesPerWorker / 60;
    // Independent of candidate eligibility: estimated cost of the missing
    // *worker positions*, not wages committed to any specific employee.
    const base = gap === null || s.hourlyBaseCostPhp === null
      ? null : rounded(gap * laborHours * s.hourlyBaseCostPhp);
    const overtime = gap === null || s.hourlyBaseCostPhp === null ||
      s.overtimeHoursPerAddedWorker === null || s.overtimeRateMultiplier === null
      ? null : rounded(gap * s.hourlyBaseCostPhp *
        s.overtimeHoursPerAddedWorker * s.overtimeRateMultiplier);
    return {
      workDate: s.workDate, startTime: s.startTime,
      requiredWorkers: required,
      lowScenarioWorkers: forecastUsable ? count(s.lowerScenarioCount!, s.productiveUnitsPerWorkerHour,
        countMinutes, s.serviceTargetCoveragePercent) : null,
      highScenarioWorkers: forecastUsable ? count(s.upperScenarioCount!, s.productiveUnitsPerWorkerHour,
        countMinutes, s.serviceTargetCoveragePercent) : null,
      scheduledWorkers: s.scheduledHeadcount, gapWorkers: gap,
      feasibleDraftAdds: adds, uncoveredWorkers: gap === null || adds === null ? null : gap - adds,
      estimatedAddedBaseCostPhp: base, estimatedAddedOvertimeCostPhp: overtime,
      reviewReasons: reasons,
    };
  });
  const sum = (key: "gapWorkers" | "feasibleDraftAdds" | "uncoveredWorkers" |
    "estimatedAddedBaseCostPhp" | "estimatedAddedOvertimeCostPhp"): number | null =>
    rows.some(row => row[key] === null) ? null :
      rounded(rows.reduce((value, row) => value + (row[key] ?? 0), 0));
  return {
    status: rows.some(row => row.reviewReasons.length > 0) ? "source_review" : "review_ready",
    approvalRequired: true, automaticallyPublished: false, rows,
    totals: {
      gaps: sum("gapWorkers"), feasibleDraftAdds: sum("feasibleDraftAdds"),
      uncovered: sum("uncoveredWorkers"),
      estimatedBaseCostPhp: sum("estimatedAddedBaseCostPhp"),
      estimatedOvertimeCostPhp: sum("estimatedAddedOvertimeCostPhp"),
    },
    boundary: "Illustrative manager-reviewed staffing scenario only. Productivity, service target, skill, rest, availability and pay rates must be independently approved. Peak-interval staffing estimates and gap-cost illustrations are not statutory payroll calculations. Does not assign named workers, validate published schedules, calculate statutory premiums, change payroll or publish shifts.",
  };
}
