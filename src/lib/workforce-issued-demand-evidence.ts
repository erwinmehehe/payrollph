import { createHash } from "node:crypto";
import type { WorkloadDemandForecast } from "./workforce-operational-demand-forecast";
import type { DemandMetric, DemandQuality } from "./workforce-operational-demand-import";

/**
 * A genuine future forecast issue has a fixed server issue timestamp, an
 * observation cutoff, an exact aggregate-source evidence SHA and predictions
 * for intervals strictly after issue. No historical observation may be used
 * that arrived after the cutoff.
 */
export const ISSUED_DEMAND_MAX_POINTS = 400;
const MS_DAY = 86_400_000;
const PH_OFFSET_MS = 8 * 3_600_000;
const SHA256 = /^[a-f0-9]{64}$/;
const PH_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type IssueScope = {
  organizationId: number;
  worksiteId: number;
  sourceKey: string;
  metricKind: DemandMetric;
  intervalMinutes: 15 | 30 | 60;
  horizonDays: 7 | 14;
};

export type IssuedDemandPoint = {
  intervalStart: string; // fixed UTC timestamp
  predictedCount: number; lowerScenarioCount: number; upperScenarioCount: number;
  historicalEvidenceCount: number;
};

export type IssuedDemandSnapshot = {
  version: 1;
  source: "source_reported_aggregate_workload";
  scope: IssueScope;
  issuedAt: string;
  sourceCutoffAt: string;
  horizonStartPh: string;
  trainingEvidenceSha256: string;
  retrospectiveComparisons: number;
  points: IssuedDemandPoint[];
  boundary: string;
};

export type ObservedDemandRevision = {
  id: number;
  intervalStart: string;
  intervalMinutes: number;
  revision: number;
  recordedAt: string;
  observedCount: number;
  quality: DemandQuality;
};

export type DemandScorePoint = {
  intervalStart: string;
  predictedCount: number;
  reportedCount: number;
  observationRevisionId: number;
  absoluteError: number;
};

export type FrozenDemandScoreReport = {
  version: 1;
  issuedSnapshotSha256: string;
  evaluatedAt: string;
  source: "later_reported_aggregate_workload";
  comparisonCount: number;
  mae: number;
  wapePercent: number | null;
  meanBiasCount: number;
  points: DemandScorePoint[];
  boundary: string;
};

export type ScoreReadiness =
  | { status: "ready"; report: FrozenDemandScoreReport; missing: 0 }
  | { status: "awaiting_evidence"; report: null; missing: number }
  | { status: "source_review"; report: null; missing: number };

export const ISSUED_FORECAST_BOUNDARY =
  "A time-stamped, source-reported aggregate workload prediction, not independently validated provider data. " +
  "Training uses only source revisions received by issue time, and predicted intervals are in the future. " +
  "Final scores compare frozen predictions with later complete counts; missing/partial observations never become zero. " +
  "Late corrections after final scoring do not rewrite the score. No auto-scheduling, payroll, or employment action.";

export function demandSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function nextPhDay(instant: Date): string {
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) throw new Error("Invalid issue timestamp");
  const day = new Date(ms + PH_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(Date.parse(day + "T00:00:00Z") + MS_DAY).toISOString().slice(0, 10);
}

export function phIntervalUtc(workDate: string, startTime: string): string {
  if (!PH_DAY.test(workDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    throw new Error("Invalid Philippine interval");
  }
  const utc = Date.parse(workDate + "T" + startTime + ":00+08:00");
  if (!Number.isFinite(utc)
    || new Date(utc + PH_OFFSET_MS).toISOString().slice(0, 16) !== workDate + "T" + startTime) {
    throw new Error("Invalid Philippine calendar interval");
  }
  return new Date(utc).toISOString();
}

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function makeIssuedDemandSnapshot(input: {
  scope: IssueScope;
  issuedAt: Date;
  evidenceSha256: string;
  forecast: WorkloadDemandForecast;
}): IssuedDemandSnapshot {
  const { scope, issuedAt, evidenceSha256, forecast } = input;
  if (!SHA256.test(evidenceSha256)
    || forecast.status !== "ready"
    || forecast.source !== "reported_aggregate_operational_counts"
    || forecast.metricKind !== scope.metricKind
    || forecast.intervalMinutes !== scope.intervalMinutes
    || forecast.horizonDays !== scope.horizonDays
    || ![15, 30, 60].includes(scope.intervalMinutes)
    || ![7, 14].includes(scope.horizonDays)
    || !Number.isFinite(issuedAt.getTime())) {
    throw new Error("Issued forecast source, scope or evidence is not complete.");
  }
  const horizonStartPh = nextPhDay(issuedAt);
  const endMs = Date.parse(horizonStartPh + "T00:00:00Z") + scope.horizonDays * MS_DAY;
  const points: IssuedDemandPoint[] = [];
  const unique = new Set<string>();
  for (const item of forecast.points) {
    const utc = phIntervalUtc(item.workDate, item.startTime);
    const time = Date.parse(utc);
    if (time <= issuedAt.getTime() || time >= endMs - PH_OFFSET_MS
      || item.workDate < horizonStartPh
      || !Number.isSafeInteger(item.predictedCount) || item.predictedCount < 0
      || !Number.isSafeInteger(item.lowerScenarioCount) || item.lowerScenarioCount < 0
      || !Number.isSafeInteger(item.upperScenarioCount)
      || item.upperScenarioCount < item.predictedCount
      || item.lowerScenarioCount > item.predictedCount
      || !Number.isSafeInteger(item.evidenceCount) || item.evidenceCount < 9
      || unique.has(utc)) {
      throw new Error("Issued forecast contains out-of-range, unsupported or duplicate points.");
    }
    unique.add(utc);
    points.push({
      intervalStart: utc,
      predictedCount: item.predictedCount,
      lowerScenarioCount: item.lowerScenarioCount,
      upperScenarioCount: item.upperScenarioCount,
      historicalEvidenceCount: item.evidenceCount,
    });
  }
  if (points.length < 1 || points.length > ISSUED_DEMAND_MAX_POINTS) {
    throw new Error("Issued forecasts require between one and 400 evidenced future interval estimates.");
  }
  points.sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
  return {
    version: 1, source: "source_reported_aggregate_workload",
    scope, issuedAt: issuedAt.toISOString(), sourceCutoffAt: issuedAt.toISOString(),
    horizonStartPh, trainingEvidenceSha256: evidenceSha256,
    retrospectiveComparisons: forecast.backtest.comparisons, points,
    boundary: ISSUED_FORECAST_BOUNDARY,
  };
}

export function evaluateFrozenDemandForecast(input: {
  snapshot: IssuedDemandSnapshot;
  issuedSha256: string;
  evaluatedAt: Date;
  observations: readonly ObservedDemandRevision[];
}): ScoreReadiness {
  const { snapshot, issuedSha256, evaluatedAt } = input;
  if (!SHA256.test(issuedSha256) || demandSha256(snapshot) !== issuedSha256 ||
    !Number.isFinite(evaluatedAt.getTime()) || snapshot.version !== 1
    || snapshot.points.length < 1 || snapshot.points.length > ISSUED_DEMAND_MAX_POINTS) {
    return { status: "source_review", report: null, missing: 0 };
  }
  const cutoff = evaluatedAt.getTime();
  const origin = Date.parse(snapshot.issuedAt);
  if (!Number.isFinite(origin) || cutoff <= origin ||
    ![15, 30, 60].includes(snapshot.scope.intervalMinutes)) {
    return { status: "source_review", report: null, missing: 0 };
  }
  const newest = new Map<string, ObservedDemandRevision>();
  const seenRevision = new Set<string>();
  for (const row of input.observations) {
    const instant = Date.parse(row.intervalStart);
    const received = Date.parse(row.recordedAt);
    const key = row.intervalStart + ":" + row.revision;
    if (!Number.isFinite(instant) || !Number.isFinite(received)
      || new Date(instant).toISOString() !== row.intervalStart
      || row.intervalMinutes !== snapshot.scope.intervalMinutes
      || received > cutoff || received <= origin
      || !Number.isSafeInteger(row.id) || row.id <= 0
      || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !Number.isSafeInteger(row.observedCount) || row.observedCount < 0
      || row.observedCount > 1_000_000
      || !["complete", "partial", "unverified"].includes(row.quality)
      || seenRevision.has(key)) {
      return { status: "source_review", report: null, missing: 0 };
    }
    seenRevision.add(key);
    if (!newest.has(row.intervalStart) ||
      newest.get(row.intervalStart)!.revision < row.revision) {
      newest.set(row.intervalStart, row);
    }
  }
  let missing = 0, absolute = 0, totalActual = 0, bias = 0;
  const points: DemandScorePoint[] = [];
  const seenPoint = new Set<string>();
  for (const point of snapshot.points) {
    const instant = Date.parse(point.intervalStart);
    if (!Number.isFinite(instant) || seenPoint.has(point.intervalStart)
      || !Number.isSafeInteger(point.predictedCount) || point.predictedCount < 0
      || instant <= origin) {
      return { status: "source_review", report: null, missing: 0 };
    }
    seenPoint.add(point.intervalStart);
    // The full interval plus 24h source settlement must have passed before a
    // final, append-only score can be issued.
    const due = instant + snapshot.scope.intervalMinutes * 60_000 + MS_DAY;
    const actual = newest.get(point.intervalStart);
    if (due > cutoff || !actual || actual.quality !== "complete") {
      missing++;
      continue;
    }
    const error = Math.abs(point.predictedCount - actual.observedCount);
    absolute += error;
    totalActual += actual.observedCount;
    bias += point.predictedCount - actual.observedCount;
    points.push({
      intervalStart: point.intervalStart, predictedCount: point.predictedCount,
      reportedCount: actual.observedCount, observationRevisionId: actual.id,
      absoluteError: error,
    });
  }
  if (missing) return { status: "awaiting_evidence", report: null, missing };
  points.sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
  return { status: "ready", missing: 0, report: {
    version: 1, issuedSnapshotSha256: issuedSha256, evaluatedAt: evaluatedAt.toISOString(),
    source: "later_reported_aggregate_workload", comparisonCount: points.length,
    mae: round(absolute / points.length),
    wapePercent: totalActual > 0 ? round(100 * absolute / totalActual) : null,
    meanBiasCount: round(bias / points.length), points,
    boundary: ISSUED_FORECAST_BOUNDARY,
  } };
}
