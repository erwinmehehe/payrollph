/**
 * A read-only, historically backtested staffing-plan outlook.
 *
 * The observations are mutable, manager-entered staffing requirements, NOT
 * observed customer traffic, independently frozen plans, paid hours, or worker
 * attendance. Predictions never become scheduled shifts or payroll evidence.
 */
export const WFM_OUTLOOK_LOOKBACK_DAYS = 182;
export const WFM_OUTLOOK_MAX_ROWS = 2000;
export const WFM_OUTLOOK_MAX_COHORTS = 40;
const TRAINING_OCCURRENCES = 6;
const HOLDOUT_OCCURRENCES = 3;
const MAX_STALENESS_DAYS = 35;

export type HistoricalStaffingRequirement = {
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  requiredHeadcount: number;
};

export type StaffingOutlookDay = {
  workDate: string;
  worksiteId: number;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  weekday: number;
  estimatedHeadcount: number;
  lowerScenarioHeadcount: number;
  upperScenarioHeadcount: number;
  trainingObservations: number;
  latestHistoricalWorkDate: string;
  backtestObservations: number;
  backtestMaeHeadcount: number;
  backtestWapePercent: number | null;
  evidence: "stronger" | "limited";
};

export type StaffingOutlook = {
  status: "ready" | "insufficient_history" | "source_review";
  source: "historical_staffing_requirements";
  model: "trailing-six-same-weekday-weighted-average";
  today: string;
  lookbackStart: string;
  horizonDays: 7 | 14;
  historicalRows: number;
  distinctCohorts: number;
  daysForecast: number;
  missingEvidenceSlots: number;
  forecasts: StaffingOutlookDay[];
  holdout: {
    comparisons: number;
    maeHeadcount: number | null;
    wapePercent: number | null;
  };
  boundary: string;
};

export const STAFFING_OUTLOOK_BOUNDARY =
  "Read-only forecast of previously entered staffing requirements, not measured customer demand. " +
  "Missing dates are unknown, never assumed to mean zero workers. Historical plans can be edited; " +
  "walk-forward error describes plan consistency only, not independently verified demand accuracy. " +
  "Scenario ranges are illustrative, not statistical confidence intervals. " +
  "No auto-roster, absence finding, payroll adjustment or headcount authorization.";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function dayTime(value: string): number {
  if (!DATE.test(value)) throw new Error("Staffing history requires YYYY-MM-DD dates.");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid staffing history calendar date.");
  }
  return time;
}

export function shiftOutlookDate(value: string, days: number): string {
  if (!Number.isSafeInteger(days) || Math.abs(days) > 366) {
    throw new Error("Invalid staffing outlook calendar offset.");
  }
  return new Date(dayTime(value) + days * DAY_MS).toISOString().slice(0, 10);
}

const twoDecimals = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function sameWeekdayEstimate(samples: readonly number[]): number {
  const tail = samples.slice(-TRAINING_OCCURRENCES);
  if (tail.length < TRAINING_OCCURRENCES) {
    throw new Error("Insufficient weekday history for prediction.");
  }
  let sum = 0;
  let denominator = 0;
  tail.forEach((n, i) => {
    const weight = i + 1;
    sum += weight * n;
    denominator += weight;
  });
  return Math.max(0, Math.round(sum / denominator));
}

type Bucket = {
  worksiteId: number;
  shiftDefinitionId: number;
  jobProfileId: number | null;
  weekday: number;
  dates: string[];
  values: number[];
};

/** Walk-forward holdout always predicts a point from *earlier* observations. */
function validateBucket(bucket: Bucket) {
  let totalAbsoluteError = 0;
  let totalActual = 0;
  let comparisons = 0;
  const first = Math.max(TRAINING_OCCURRENCES, bucket.values.length - HOLDOUT_OCCURRENCES);
  for (let index = first; index < bucket.values.length; index++) {
    const predicted = sameWeekdayEstimate(bucket.values.slice(0, index));
    const actual = bucket.values[index];
    totalAbsoluteError += Math.abs(actual - predicted);
    totalActual += actual;
    comparisons++;
  }
  return { comparisons, totalAbsoluteError, totalActual,
    mae: comparisons ? totalAbsoluteError / comparisons : null,
    wape: totalActual > 0 ? 100 * totalAbsoluteError / totalActual : null };
}

export function forecastHistoricalStaffingRequirements(input: {
  today: string;
  horizonDays: 7 | 14;
  worksiteId: number;
  rows: readonly HistoricalStaffingRequirement[];
}): StaffingOutlook {
  const todayTime = dayTime(input.today);
  if ((input.horizonDays !== 7 && input.horizonDays !== 14)
    || !Number.isSafeInteger(input.worksiteId) || input.worksiteId <= 0) {
    throw new Error("Invalid staffing outlook scope or horizon.");
  }
  const start = shiftOutlookDate(input.today, -WFM_OUTLOOK_LOOKBACK_DAYS);
  const basic = {
    source: "historical_staffing_requirements" as const,
    model: "trailing-six-same-weekday-weighted-average" as const,
    today: input.today,
    lookbackStart: start,
    horizonDays: input.horizonDays,
    historicalRows: input.rows.length,
    boundary: STAFFING_OUTLOOK_BOUNDARY,
  };
  const empty = (status: StaffingOutlook["status"], cohorts = 0): StaffingOutlook => ({
    ...basic, status, distinctCohorts: cohorts, daysForecast: 0, missingEvidenceSlots: 0,
    forecasts: [], holdout: { comparisons: 0, maeHeadcount: null, wapePercent: null },
  });
  // One oversized or untrusted source must not yield partial, optimistic plans.
  if (input.rows.length > WFM_OUTLOOK_MAX_ROWS) return empty("source_review");
  const buckets = new Map<string, Bucket>();
  const cohorts = new Set<string>();
  const uniqueSource = new Set<string>();
  for (const row of input.rows) {
    const dateTime = dayTime(row.workDate);
    if (row.worksiteId !== input.worksiteId
      || !Number.isSafeInteger(row.shiftDefinitionId) || row.shiftDefinitionId <= 0
      || (row.jobProfileId !== null
        && (!Number.isSafeInteger(row.jobProfileId) || row.jobProfileId <= 0))
      || !Number.isSafeInteger(row.requiredHeadcount) || row.requiredHeadcount < 0
      || row.requiredHeadcount > 1000
      || dateTime >= todayTime || row.workDate < start) {
      return empty("source_review");
    }
    const cohort = [row.worksiteId, row.shiftDefinitionId, row.jobProfileId ?? "any"].join(":");
    const uniqueKey = cohort + ":" + row.workDate;
    if (uniqueSource.has(uniqueKey)) return empty("source_review");
    uniqueSource.add(uniqueKey);
    cohorts.add(cohort);
    if (cohorts.size > WFM_OUTLOOK_MAX_COHORTS) return empty("source_review", cohorts.size);
    const weekday = new Date(dateTime).getUTCDay();
    const key = cohort + ":" + weekday;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        worksiteId: row.worksiteId, shiftDefinitionId: row.shiftDefinitionId,
        jobProfileId: row.jobProfileId, weekday, dates: [], values: [],
      };
      buckets.set(key, bucket);
    }
    bucket.dates.push(row.workDate);
    bucket.values.push(row.requiredHeadcount);
  }
  if (!cohorts.size) return empty("insufficient_history");
  for (const bucket of buckets.values()) {
    const ordered = bucket.dates.map((date, i) => ({ date, value: bucket.values[i] }))
      .sort((a, b) => a.date.localeCompare(b.date));
    bucket.dates = ordered.map(item => item.date);
    bucket.values = ordered.map(item => item.value);
  }
  const forecasts: StaffingOutlookDay[] = [];
  let missingEvidenceSlots = 0;
  let totalAbsoluteError = 0;
  let totalActual = 0;
  let totalComparisons = 0;
  // Each cohort is a shift/job combination. A missing future weekday is not
  // treated as an expected zero-staffing day, so no estimate is emitted.
  for (const bucket of buckets.values()) {
    if (bucket.values.length < TRAINING_OCCURRENCES + HOLDOUT_OCCURRENCES) continue;
    const validation = validateBucket(bucket);
    totalAbsoluteError += validation.totalAbsoluteError;
    totalActual += validation.totalActual;
    totalComparisons += validation.comparisons;
    for (let day = 0; day < input.horizonDays; day++) {
      const future = shiftOutlookDate(input.today, day);
      if (new Date(dayTime(future)).getUTCDay() !== bucket.weekday) continue;
      const lastHistoricalDay = bucket.dates[bucket.dates.length - 1];
      if (dayTime(input.today) - dayTime(lastHistoricalDay) > MAX_STALENESS_DAYS * DAY_MS) {
        missingEvidenceSlots++;
        continue;
      }
      const predicted = sameWeekdayEstimate(bucket.values);
      const mae = validation.mae ?? 0;
      const variation = Math.max(1, Math.ceil(mae));
      forecasts.push({
        workDate: future, worksiteId: bucket.worksiteId,
        shiftDefinitionId: bucket.shiftDefinitionId, jobProfileId: bucket.jobProfileId,
        weekday: bucket.weekday, estimatedHeadcount: predicted,
        lowerScenarioHeadcount: Math.max(0, predicted - variation),
        upperScenarioHeadcount: predicted + variation,
        trainingObservations: bucket.values.length,
        latestHistoricalWorkDate: lastHistoricalDay,
        backtestObservations: validation.comparisons,
        backtestMaeHeadcount: twoDecimals(mae),
        backtestWapePercent: validation.wape == null ? null : twoDecimals(validation.wape),
        evidence: bucket.values.length >= 16 && validation.wape != null && validation.wape <= 15
          ? "stronger" : "limited",
      });
    }
  }
  forecasts.sort((a, b) => a.workDate.localeCompare(b.workDate)
    || a.shiftDefinitionId - b.shiftDefinitionId
    || (a.jobProfileId ?? 0) - (b.jobProfileId ?? 0));
  return {
    ...basic,
    status: forecasts.length ? "ready" : "insufficient_history",
    distinctCohorts: cohorts.size,
    daysForecast: new Set(forecasts.map(row => row.workDate)).size,
    missingEvidenceSlots,
    forecasts,
    holdout: {
      comparisons: totalComparisons,
      maeHeadcount: totalComparisons ? twoDecimals(totalAbsoluteError / totalComparisons) : null,
      wapePercent: totalActual > 0 ? twoDecimals(100 * totalAbsoluteError / totalActual) : null,
    },
  };
}
