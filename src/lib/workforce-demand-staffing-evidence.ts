import type { IssuedDemandSnapshot } from "./workforce-issued-demand-evidence";
import type { DemandStaffingSlot } from "./workforce-demand-staffing-planner";

/**
 * Builds bounded, read-only WFM scenario inputs from a *hash-verified* issued
 * forecast and an independently authorized coverage read.
 * This module never treats a missing forecast, roster or eligibility as zero.
 */
export type DemandStaffingCoverage = {
  requirementId: number;
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  availableScheduledHeadcount: number;
};
export type DemandStaffingShift = {
  id: number;
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
  breakMinutes: number;
};
export type DemandStaffingCostRow = {
  requirementId: number;
  benchmarkHourlyRate: number | null;
};
export type DemandStaffingSourceRow = {
  workDate: string;
  forecastIntervals: number;
  missingForecastIntervals: number;
  peakPredictedCount: number | null;
  totalPredictedActivity: number | null;
  requirementId: number | null;
  notes: string[];
};
export type DemandStaffingInputs = {
  slots: DemandStaffingSlot[];
  evidence: DemandStaffingSourceRow[];
  boundary: string;
};
const DAY = 86_400_000;
const MINUTE = 60_000;
const PH_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;
const nextDay = (v: string) => new Date(Date.parse(v + "T00:00:00Z") + DAY).toISOString().slice(0, 10);
function validDate(value: string) {
  if (!PH_DATE.test(value)) return false;
  const x = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(x) && new Date(x).toISOString().slice(0, 10) === value;
}
function shiftWindow(workDate: string, shift: DemandStaffingShift) {
  const a = CLOCK.exec(shift.startTime);
  const b = CLOCK.exec(shift.endTime);
  if (!a || !b || !validDate(workDate)) throw new Error("Worksite shift clock or date is invalid.");
  const startMinute = Number(a[1]) * 60 + Number(a[2]);
  const endMinute = Number(b[1]) * 60 + Number(b[2]);
  const overnight = endMinute <= startMinute;
  if (shift.spansMidnight !== overnight || endMinute === startMinute) {
    throw new Error("Shift midnight flag and effective wall-clock window conflict.");
  }
  const total = endMinute - startMinute + (overnight ? 1440 : 0);
  if (!Number.isSafeInteger(shift.breakMinutes) || shift.breakMinutes < 0 ||
    shift.breakMinutes >= total) throw new Error("Shift break or duration is invalid.");
  const start = Date.parse(workDate + "T00:00:00+08:00") + startMinute * MINUTE;
  return { start, end: start + total * MINUTE, wallMinutes: total,
    paidMinutes: total - shift.breakMinutes };
}

export function buildDemandStaffingShiftEvidence(input: {
  organizationId: number;
  worksiteId: number;
  shift: DemandStaffingShift;
  jobProfileId: number | null;
  snapshot: IssuedDemandSnapshot;
  hashVerified: boolean;
  windowStart: string;
  windowEnd: string;
  productivityUnitsPerHour: number;
  serviceTargetPercent: number;
  coverage: readonly DemandStaffingCoverage[];
  laborCostVisible: boolean;
  laborRows: readonly DemandStaffingCostRow[];
  now?: Date;
}): DemandStaffingInputs {
  const s = input.snapshot, scope = s.scope;
  const now = input.now ?? new Date();
  if (!input.hashVerified || !Number.isSafeInteger(input.organizationId) ||
    !Number.isSafeInteger(input.worksiteId) ||
    !Number.isFinite(now.getTime()) ||
    scope.organizationId !== input.organizationId ||
    scope.worksiteId !== input.worksiteId ||
    ![15, 30, 60].includes(scope.intervalMinutes) ||
    ![7, 14].includes(scope.horizonDays) ||
    s.source !== "source_reported_aggregate_workload" ||
    s.version !== 1 ||
    s.issuedAt !== s.sourceCutoffAt ||
    !validDate(s.horizonStartPh) ||
    !validDate(input.windowStart) || !validDate(input.windowEnd) ||
    input.windowEnd < input.windowStart ||
    Date.parse(input.windowEnd) - Date.parse(input.windowStart) > 13 * DAY ||
    !Number.isFinite(input.productivityUnitsPerHour) ||
    input.productivityUnitsPerHour < 0.01 ||
    input.productivityUnitsPerHour > 1_000_000 ||
    !Number.isFinite(input.serviceTargetPercent) ||
    input.serviceTargetPercent <= 0 || input.serviceTargetPercent > 100 ||
    !Array.isArray(s.points) || s.points.length > 400) {
    throw new Error("A verified, scoped forecast and bounded manager assumptions are required.");
  }
  const issued = Date.parse(s.issuedAt);
  if (!Number.isFinite(issued)) throw new Error("Issued forecast time is invalid.");
  const endHorizon = new Date(Date.parse(s.horizonStartPh + "T00:00:00Z") +
    scope.horizonDays * DAY).toISOString().slice(0, 10);
  const pointByTime = new Map<string, (typeof s.points)[number]>();
  for (const point of s.points) {
    const t = Date.parse(point.intervalStart);
    if (!Number.isFinite(t) || new Date(t).toISOString() !== point.intervalStart ||
      t <= issued || pointByTime.has(point.intervalStart) ||
      ![point.predictedCount, point.lowerScenarioCount, point.upperScenarioCount]
        .every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000) ||
      point.lowerScenarioCount > point.predictedCount ||
      point.upperScenarioCount < point.predictedCount) {
      throw new Error("Issued forecast contains untrusted intervals.");
    }
    pointByTime.set(point.intervalStart, point);
  }

  const slots: DemandStaffingSlot[] = [], evidence: DemandStaffingSourceRow[] = [];
  const start = input.windowStart > s.horizonStartPh ? input.windowStart : s.horizonStartPh;
  const lastForecastDate = new Date(Date.parse(endHorizon + "T00:00:00Z") - DAY)
    .toISOString().slice(0, 10);
  const end = input.windowEnd < lastForecastDate ? input.windowEnd : lastForecastDate;
  if (end < start) return {
    slots: [], evidence: [],
    boundary: "Forecast dates do not overlap the selected roster window. Change the coverage date range.",
  };
  for (let date = start; date <= end; date = nextDay(date)) {
    const window = shiftWindow(date, input.shift);
    const segmentMinutes = scope.intervalMinutes;
    const dateNotes: string[] = [];
    const expected = window.wallMinutes / segmentMinutes;
    const values: Array<(typeof s.points)[number]> = [];
    const alignment = Number.isInteger(expected) &&
      (window.start / MINUTE) % segmentMinutes === 0;
    if (alignment) {
      for (let ms = window.start; ms < window.end; ms += segmentMinutes * MINUTE) {
        const p = pointByTime.get(new Date(ms).toISOString());
        if (p) values.push(p);
      }
    }
    const missing = alignment ? expected - values.length : Math.ceil(expected);
    if (missing > 0) dateNotes.push("Forecast interval coverage incomplete; missing demand is unknown.");
    if (window.start < now.getTime()) dateNotes.push("Work date has started or passed; future planning is unavailable.");
    const rows = input.coverage.filter(row =>
      row.worksiteId === input.worksiteId &&
      row.shiftDefinitionId === input.shift.id &&
      row.jobProfileId === input.jobProfileId &&
      row.workDate === date);
    const row = rows.length === 1 ? rows[0] : null;
    if (!row) dateNotes.push(rows.length > 1 ? "Duplicate role-specific roster requirement." :
      "No approved staffing requirement for this worksite, shift and role.");
    const scheduled = row && Number.isSafeInteger(row.availableScheduledHeadcount) &&
      row.availableScheduledHeadcount >= 0 ? row.availableScheduledHeadcount : null;
    if (scheduled === null) dateNotes.push("Scheduled eligible headcount unverified.");
    const wageRow = input.laborCostVisible && row
      ? input.laborRows.find(v => v.requirementId === row.requirementId) : null;
    const base = wageRow?.benchmarkHourlyRate;
    const hourlyRate = base != null && Number.isFinite(base) && base > 0 &&
      base <= 1_000_000 ? base : null;
    if (hourlyRate === null) dateNotes.push("Estimated labor-rate evidence not available to this role.");
    // Existing coverage recommendations are limited/ranked, NOT an exhaustive,
    // rest-certified employee pool. Never misrepresent them as available workers.
    dateNotes.push("Available extra qualified workers, rest and overtime approval not certified.");
    const usable = alignment && missing === 0 && window.start >= now.getTime();
    const predicted = usable ? Math.max(...values.map(v => v.predictedCount)) : null;
    const lower = usable ? Math.max(...values.map(v => v.lowerScenarioCount)) : null;
    const upper = usable ? Math.max(...values.map(v => v.upperScenarioCount)) : null;
    evidence.push({
      workDate: date, forecastIntervals: alignment ? expected : 0,
      missingForecastIntervals: missing, peakPredictedCount: predicted,
      totalPredictedActivity: usable ? values.reduce((total, p) => total + p.predictedCount, 0) : null,
      requirementId: row?.requirementId ?? null, notes: dateNotes,
    });
    slots.push({
      workDate: date, startTime: input.shift.startTime.slice(0, 5),
      predictedCount: predicted, lowerScenarioCount: lower, upperScenarioCount: upper,
      scheduledHeadcount: scheduled, demandIntervalMinutes: segmentMinutes,
      availableEligibleHeadcount: null, eligibleSkillEvidenceComplete: false,
      restAndAvailabilityEvidenceComplete: false,
      productiveUnitsPerWorkerHour: input.productivityUnitsPerHour,
      serviceTargetCoveragePercent: input.serviceTargetPercent,
      paidMinutesPerWorker: window.paidMinutes, hourlyBaseCostPhp: hourlyRate,
      overtimeHoursPerAddedWorker: null, overtimeRateMultiplier: null,
    });
  }
  return {
    slots, evidence,
    boundary: "Peak-interval forecast and role-specific scheduled headcount. Missing intervals/requirements remain unknown; cost is illustrative baseline only when permission and evidence exist. No candidate eligibility, overtime compliance, source certification, approval or roster publication is implied.",
  };
}
