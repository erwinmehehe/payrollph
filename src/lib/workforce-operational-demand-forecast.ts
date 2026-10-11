import type { DemandMetric, DemandQuality } from "./workforce-operational-demand-import";

/**
 * Retrospective walk-forward validation of aggregate *reported* operational
 * counts. Not a point-in-time live validation: historical source revisions
 * may have been imported after their work date.
 */
export type DemandObservationVersion = {
  intervalStart: string; intervalMinutes: 15 | 30 | 60;
  revision: number; observedCount: number; quality: DemandQuality;
};
export type WorkloadForecastPoint = {
  workDate: string; startTime: string; predictedCount: number;
  lowerScenarioCount: number; upperScenarioCount: number;
  heldOutMae: number; heldOutWapePercent: number | null;
  evidenceCount: number; lastSourceDate: string;
};
export type WorkloadDemandForecast = {
  status: "ready" | "insufficient_history" | "source_review";
  source: "reported_aggregate_operational_counts";
  metricKind: DemandMetric;
  intervalMinutes: 15 | 30 | 60;
  horizonDays: 7 | 14;
  historicalVersions: number; latestIntervals: number; qualityExcluded: number;
  predictedIntervals: number; unknownIntervals: number;
  backtest: { comparisons: number; mae: number | null; wapePercent: number | null };
  points: WorkloadForecastPoint[];
  boundary: string;
};
export const WORKLOAD_FORECAST_BOUNDARY =
  "Retrospective forecast of source-reported aggregate workload, not independently certified POS or visitor counts. " +
  "Partial/unverified or missing intervals remain unknown, never zero. Historical revisions may post-date the historical forecast origin, " +
  "so retrospective walk-forward error is not a frozen live-production accuracy score. " +
  "Sensitivity ranges are illustrative, not statistical confidence intervals. No automated staffing, payroll or attendance decisions.";
export const WORKLOAD_MAX_VERSIONS = 25000;
const PH_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86400_000;
const BACKTEST_HOLDOUT = 3;
const TRAINING_SIZE = 6;

function phPart(instant: number) {
  const date = new Date(instant + PH_OFFSET_MS);
  return {
    date: date.toISOString().slice(0, 10),
    weekday: date.getUTCDay(),
    minuteOfDay: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}
function validToday(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid Philippine forecast date.");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid Philippine forecast date.");
  }
  return time;
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function estimate(series: readonly number[]): number {
  const sample = series.slice(-TRAINING_SIZE);
  let total = 0;
  for (let i = 0; i < sample.length; i++) total += sample[i] * (i + 1);
  return Math.max(0, Math.round(total / 21));
}
type Series = { moments: number[]; values: number[]; weekday: number; minuteOfDay: number };

export function forecastObservedWorkload(input: {
  metricKind: DemandMetric;
  intervalMinutes: 15 | 30 | 60;
  horizonDays: 7 | 14;
  today: string;
  observations: readonly DemandObservationVersion[];
}): WorkloadDemandForecast {
  const todayMs = validToday(input.today);
  if (![15, 30, 60].includes(input.intervalMinutes)
    || (input.horizonDays !== 7 && input.horizonDays !== 14)) {
    throw new Error("Invalid operational demand planning horizon or interval.");
  }
  const base = {
    source: "reported_aggregate_operational_counts" as const,
    metricKind: input.metricKind, intervalMinutes: input.intervalMinutes,
    horizonDays: input.horizonDays, historicalVersions: input.observations.length,
    boundary: WORKLOAD_FORECAST_BOUNDARY,
  };
  const blank = (status: WorkloadDemandForecast["status"], latest = 0, excluded = 0): WorkloadDemandForecast => ({
    ...base, status, latestIntervals: latest, qualityExcluded: excluded,
    predictedIntervals: 0, unknownIntervals: 0,
    backtest: { comparisons: 0, mae: null, wapePercent: null },
    points: [],
  });
  if (input.observations.length > WORKLOAD_MAX_VERSIONS) return blank("source_review");

  // Every individual observation version must be authentic to this query's
  // explicit interval and retrospective lookback before considering revisions.
  const chosen = new Map<number, DemandObservationVersion>();
  const revisions = new Set<string>();
  for (const row of input.observations) {
    const start = Date.parse(row.intervalStart);
    if (!Number.isFinite(start)
      || new Date(start).toISOString() !== row.intervalStart
      || row.intervalMinutes !== input.intervalMinutes
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 1000
      || !Number.isSafeInteger(row.observedCount) || row.observedCount < 0 || row.observedCount > 1_000_000
      || !["complete", "partial", "unverified"].includes(row.quality)
      || phPart(start).minuteOfDay % input.intervalMinutes !== 0
      || start >= todayMs - PH_OFFSET_MS
      || start < todayMs - PH_OFFSET_MS - 183 * DAY_MS) return blank("source_review");
    const key = start + ":" + row.revision;
    if (revisions.has(key)) return blank("source_review");
    revisions.add(key);
    if (!chosen.has(start) || chosen.get(start)!.revision < row.revision) chosen.set(start, row);
  }

  const groups = new Map<string, Series>();
  let qualityExcluded = 0;
  for (const [start, row] of chosen) {
    if (row.quality !== "complete") { qualityExcluded++; continue; }
    const p = phPart(start);
    const key = p.weekday + ":" + p.minuteOfDay;
    const group = groups.get(key) ?? {
      weekday: p.weekday, minuteOfDay: p.minuteOfDay,
      moments: [], values: [],
    };
    group.moments.push(start);
    group.values.push(row.observedCount);
    groups.set(key, group);
  }
  const points: WorkloadForecastPoint[] = [];
  let totalError = 0, totalActual = 0, comparisons = 0, unknownIntervals = 0;
  for (const group of groups.values()) {
    const ordered = group.moments.map((moment, i) => ({ moment, count: group.values[i] }))
      .sort((a, b) => a.moment - b.moment);
    if (ordered.length < TRAINING_SIZE + BACKTEST_HOLDOUT) { unknownIntervals += input.horizonDays / 7; continue; }
    const last = ordered[ordered.length - 1];
    if (todayMs - PH_OFFSET_MS - last.moment > 35 * DAY_MS) {
      unknownIntervals += input.horizonDays / 7; continue;
    }
    let error = 0, actual = 0;
    for (let i = ordered.length - BACKTEST_HOLDOUT; i < ordered.length; i++) {
      const predicted = estimate(ordered.slice(0, i).map(x => x.count));
      error += Math.abs(predicted - ordered[i].count);
      actual += ordered[i].count;
    }
    const mae = error / BACKTEST_HOLDOUT;
    const wape = actual > 0 ? 100 * error / actual : null;
    totalError += error; totalActual += actual; comparisons += BACKTEST_HOLDOUT;
    const predicted = estimate(ordered.map(x => x.count));
    const variation = Math.max(1, Math.ceil(mae));
    for (let i = 0; i < input.horizonDays; i++) {
      const futureMs = todayMs + i * DAY_MS;
      if (new Date(futureMs).getUTCDay() !== group.weekday) continue;
      points.push({
        workDate: new Date(futureMs).toISOString().slice(0, 10),
        startTime: String(Math.floor(group.minuteOfDay / 60)).padStart(2, "0") +
          ":" + String(group.minuteOfDay % 60).padStart(2, "0"),
        predictedCount: predicted,
        lowerScenarioCount: Math.max(0, predicted - variation),
        upperScenarioCount: predicted + variation,
        heldOutMae: round(mae), heldOutWapePercent: wape === null ? null : round(wape),
        evidenceCount: ordered.length,
        lastSourceDate: phPart(last.moment).date,
      });
    }
  }
  points.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.startTime.localeCompare(b.startTime));
  return {
    ...base, status: points.length ? "ready" : "insufficient_history",
    latestIntervals: chosen.size, qualityExcluded,
    predictedIntervals: points.length, unknownIntervals,
    backtest: {
      comparisons, mae: comparisons ? round(totalError / comparisons) : null,
      wapePercent: totalActual > 0 ? round(100 * totalError / totalActual) : null,
    },
    points,
  };
}
