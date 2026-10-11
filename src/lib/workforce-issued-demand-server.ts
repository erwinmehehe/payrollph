import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, workforceDemandObservationRevisions,
  workforceDemandForecastIssues, workforceDemandForecastScores,
} from "@/db/schema";
import { forecastObservedWorkload, WORKLOAD_MAX_VERSIONS } from "@/lib/workforce-operational-demand-forecast";
import type { DemandQuality } from "@/lib/workforce-operational-demand-import";
import {
  demandSha256, evaluateFrozenDemandForecast, makeIssuedDemandSnapshot,
  nextPhDay, ISSUED_DEMAND_MAX_POINTS,
  type IssuedDemandSnapshot, type FrozenDemandScoreReport, type ObservedDemandRevision,
} from "@/lib/workforce-issued-demand-evidence";
import type { IssueDemandRequest } from "@/lib/workforce-issued-demand-validation";

const MS_DAY = 86_400_000;
export class DemandEvidenceConflict extends Error {
  constructor(message: string, public missingCount = 0) { super(message); }
}

async function databaseNow(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const result = await tx.execute(sql<{ issued_at: Date }>`SELECT clock_timestamp() AS issued_at`);
  const value = result.rows?.[0]?.issued_at;
  const now = new Date(value);
  if (!Number.isFinite(now.getTime())) throw new DemandEvidenceConflict("Database issue time is unavailable.");
  return now;
}

function serializableRequest(req: IssueDemandRequest) {
  return { organizationId: req.organizationId, worksiteId: req.worksiteId,
    sourceKey: req.sourceKey, metricKind: req.metricKind,
    intervalMinutes: req.intervalMinutes, horizonDays: req.horizonDays };
}

/**
 * Issuing and imports take the SAME exact-org advisory lock. The transaction
 * freezes source revision IDs that were committed before cutoff; it cannot see
 * a later import or silently edit past issuance.
 */
export async function issueOperationalDemandForecast(input: {
  request: IssueDemandRequest; actorUserId: number; actorName: string;
}) {
  const { request } = input;
  const requestSha = demandSha256(serializableRequest(request));
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8857, ${request.organizationId})`);
    const [prior] = await tx.select().from(workforceDemandForecastIssues).where(and(
      eq(workforceDemandForecastIssues.organizationId, request.organizationId),
      eq(workforceDemandForecastIssues.idempotencyKey, request.idempotencyKey),
    )).limit(1);
    if (prior) {
      if (prior.requestSha256 !== requestSha) {
        throw new DemandEvidenceConflict("Forecast issue idempotency key was reused for another source or horizon.");
      }
      return { issueId: prior.id, snapshotSha256: prior.snapshotSha256,
        pointsCount: prior.pointsCount, issuedAt: prior.issuedAt.toISOString(), replayed: true };
    }

    const issuedAt = await databaseNow(tx);
    const tomorrowPh = nextPhDay(issuedAt);
    const forecastStart = Date.parse(tomorrowPh + "T00:00:00+08:00");
    const lookbackStart = new Date(forecastStart - 183 * MS_DAY);
    const historical = await tx.select({
      id: workforceDemandObservationRevisions.id,
      intervalStart: workforceDemandObservationRevisions.intervalStart,
      intervalMinutes: workforceDemandObservationRevisions.intervalMinutes,
      revision: workforceDemandObservationRevisions.revision,
      observedCount: workforceDemandObservationRevisions.observedCount,
      quality: workforceDemandObservationRevisions.quality,
      recordedAt: workforceDemandObservationRevisions.recordedAt,
    }).from(workforceDemandObservationRevisions).where(and(
      eq(workforceDemandObservationRevisions.organizationId, request.organizationId),
      eq(workforceDemandObservationRevisions.worksiteId, request.worksiteId),
      eq(workforceDemandObservationRevisions.sourceKey, request.sourceKey),
      eq(workforceDemandObservationRevisions.metricKind, request.metricKind),
      eq(workforceDemandObservationRevisions.intervalMinutes, request.intervalMinutes),
      gte(workforceDemandObservationRevisions.intervalStart, lookbackStart),
      lt(workforceDemandObservationRevisions.intervalStart, new Date(forecastStart)),
      lte(workforceDemandObservationRevisions.recordedAt, issuedAt),
    )).orderBy(asc(workforceDemandObservationRevisions.intervalStart),
      desc(workforceDemandObservationRevisions.revision)).limit(WORKLOAD_MAX_VERSIONS + 1);

    if (historical.length > WORKLOAD_MAX_VERSIONS) {
      throw new DemandEvidenceConflict("Historical workload source exceeds the bounded evidence window.");
    }
    const completeBeforeIssue = historical.filter(row =>
      row.intervalStart.getTime() + request.intervalMinutes * 60_000 <= issuedAt.getTime());
    const evidenceSha = demandSha256(completeBeforeIssue.map(row => ({
      id: row.id, intervalStart: row.intervalStart.toISOString(),
      revision: row.revision, observedCount: row.observedCount,
      quality: row.quality, recordedAt: row.recordedAt.toISOString(),
    })));
    const forecast = forecastObservedWorkload({
      today: tomorrowPh, horizonDays: request.horizonDays,
      metricKind: request.metricKind, intervalMinutes: request.intervalMinutes,
      observations: completeBeforeIssue.map(row => ({
        intervalStart: row.intervalStart.toISOString(),
        intervalMinutes: request.intervalMinutes, revision: row.revision,
        observedCount: row.observedCount, quality: row.quality as DemandQuality,
      })),
    });
    if (forecast.status !== "ready") {
      throw new DemandEvidenceConflict("Insufficient verified historical time slots to issue a future workload forecast.");
    }
    const snapshot = makeIssuedDemandSnapshot({
      scope: serializableRequest(request),
      issuedAt, evidenceSha256: evidenceSha, forecast,
    });
    if (snapshot.points.length > ISSUED_DEMAND_MAX_POINTS) {
      throw new DemandEvidenceConflict("Too many future points for one issued forecast.");
    }
    const snapshotSha = demandSha256(snapshot);
    const [record] = await tx.insert(workforceDemandForecastIssues).values({
      organizationId: request.organizationId, worksiteId: request.worksiteId,
      sourceKey: request.sourceKey, metricKind: request.metricKind,
      intervalMinutes: request.intervalMinutes, horizonDays: request.horizonDays,
      idempotencyKey: request.idempotencyKey, requestSha256: requestSha,
      issuedByUserId: input.actorUserId, issuedAt, sourceCutoffAt: issuedAt,
      trainingEvidenceSha256: evidenceSha, snapshotSha256: snapshotSha,
      pointsCount: snapshot.points.length, snapshot,
    }).returning({ id: workforceDemandForecastIssues.id });

    await tx.insert(auditEvents).values({
      organizationId: request.organizationId, actor: input.actorName.slice(0, 120),
      action: "WFM future aggregate demand forecast issued",
      resource: "worksite:" + request.worksiteId,
      metadata: {
        issueId: record.id, metricKind: request.metricKind, sourceKey: request.sourceKey,
        intervalMinutes: request.intervalMinutes, horizonDays: request.horizonDays,
        pointsCount: snapshot.points.length,
        issuedAt: issuedAt.toISOString(), snapshotSha256: snapshotSha,
        trainingEvidenceSha256: evidenceSha,
      },
    });
    return { issueId: record.id, snapshotSha256: snapshotSha,
      pointsCount: snapshot.points.length, issuedAt: issuedAt.toISOString(), replayed: false };
  });
}

export async function fetchIssuedDemandForecasts(input: {
  organizationId: number; worksiteId: number; limit?: number;
}) {
  const issues = await db.select({
    id: workforceDemandForecastIssues.id,
    organizationId: workforceDemandForecastIssues.organizationId,
    worksiteId: workforceDemandForecastIssues.worksiteId,
    sourceKey: workforceDemandForecastIssues.sourceKey,
    metricKind: workforceDemandForecastIssues.metricKind,
    intervalMinutes: workforceDemandForecastIssues.intervalMinutes,
    horizonDays: workforceDemandForecastIssues.horizonDays,
    issuedAt: workforceDemandForecastIssues.issuedAt,
    snapshotSha256: workforceDemandForecastIssues.snapshotSha256,
    pointsCount: workforceDemandForecastIssues.pointsCount,
    snapshot: workforceDemandForecastIssues.snapshot,
  }).from(workforceDemandForecastIssues).where(and(
    eq(workforceDemandForecastIssues.organizationId, input.organizationId),
    eq(workforceDemandForecastIssues.worksiteId, input.worksiteId),
  )).orderBy(desc(workforceDemandForecastIssues.issuedAt)).limit(
    Math.min(20, Math.max(1, input.limit ?? 10))
  );
  // Verify persisted evidence before returning it to any authorized manager.
  return issues.map(row => {
    const integrityOk = demandSha256(row.snapshot) === row.snapshotSha256;
    return { ...row, snapshot: integrityOk ? row.snapshot : null,
      integrity: integrityOk ? "matches_issued_hash" : "source_review" };
  });
}

/** Finalize only when EVERY predicted interval has a complete, settled actual. */
export async function finalizeOperationalDemandScore(input: {
  organizationId: number; issueId: number;
  actorUserId: number; actorName: string;
}) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8857, ${input.organizationId})`);
    const [issue] = await tx.select().from(workforceDemandForecastIssues).where(and(
      eq(workforceDemandForecastIssues.organizationId, input.organizationId),
      eq(workforceDemandForecastIssues.id, input.issueId),
    )).limit(1);
    if (!issue) throw new DemandEvidenceConflict("Issued forecast is not in this employer.");
    const [previous] = await tx.select().from(workforceDemandForecastScores).where(and(
      eq(workforceDemandForecastScores.organizationId, input.organizationId),
      eq(workforceDemandForecastScores.issueId, issue.id),
    )).limit(1);
    if (previous) {
      if (demandSha256(previous.report) !== previous.reportSha256) {
        throw new DemandEvidenceConflict("Previously scored evidence is inconsistent.");
      }
      return { issueId: issue.id, scoreId: previous.id,
        reportSha256: previous.reportSha256, replayed: true,
        report: previous.report as FrozenDemandScoreReport };
    }
    if (demandSha256(issue.snapshot) !== issue.snapshotSha256 ||
      issue.sourceCutoffAt.getTime() !== issue.issuedAt.getTime()) {
      throw new DemandEvidenceConflict("Issued forecast evidence failed its stored source hash or cutoff.");
    }
    const snapshot = issue.snapshot as IssuedDemandSnapshot;
    if (snapshot.scope.organizationId !== issue.organizationId
      || snapshot.scope.worksiteId !== issue.worksiteId
      || snapshot.scope.sourceKey !== issue.sourceKey
      || snapshot.scope.metricKind !== issue.metricKind
      || snapshot.scope.intervalMinutes !== issue.intervalMinutes
      || snapshot.points.length !== issue.pointsCount
      || snapshot.issuedAt !== issue.issuedAt.toISOString()) {
      throw new DemandEvidenceConflict("Issued forecast scope and stored evidence disagree.");
    }
    const now = await databaseNow(tx);
    const moments = snapshot.points.map(point => Date.parse(point.intervalStart));
    if (moments.some(ms => !Number.isFinite(ms))) {
      throw new DemandEvidenceConflict("Issued forecast has invalid interval timestamps.");
    }
    const from = new Date(Math.min(...moments));
    const to = new Date(Math.max(...moments) + issue.intervalMinutes * 60_000);
    const observations = await tx.select({
      id: workforceDemandObservationRevisions.id,
      intervalStart: workforceDemandObservationRevisions.intervalStart,
      intervalMinutes: workforceDemandObservationRevisions.intervalMinutes,
      revision: workforceDemandObservationRevisions.revision,
      observedCount: workforceDemandObservationRevisions.observedCount,
      quality: workforceDemandObservationRevisions.quality,
      recordedAt: workforceDemandObservationRevisions.recordedAt,
    }).from(workforceDemandObservationRevisions).where(and(
      eq(workforceDemandObservationRevisions.organizationId, issue.organizationId),
      eq(workforceDemandObservationRevisions.worksiteId, issue.worksiteId),
      eq(workforceDemandObservationRevisions.sourceKey, issue.sourceKey),
      eq(workforceDemandObservationRevisions.metricKind, issue.metricKind),
      eq(workforceDemandObservationRevisions.intervalMinutes, issue.intervalMinutes),
      gte(workforceDemandObservationRevisions.intervalStart, from),
      lt(workforceDemandObservationRevisions.intervalStart, to),
      lte(workforceDemandObservationRevisions.recordedAt, now),
    )).orderBy(asc(workforceDemandObservationRevisions.intervalStart),
      desc(workforceDemandObservationRevisions.revision)).limit(WORKLOAD_MAX_VERSIONS + 1);
    if (observations.length > WORKLOAD_MAX_VERSIONS) {
      throw new DemandEvidenceConflict("Final actual evidence exceeds the bounded query.");
    }
    const score = evaluateFrozenDemandForecast({
      snapshot, issuedSha256: issue.snapshotSha256, evaluatedAt: now,
      observations: observations.map(row => ({
        id: row.id, intervalStart: row.intervalStart.toISOString(),
        intervalMinutes: row.intervalMinutes,
        revision: row.revision, observedCount: row.observedCount,
        quality: row.quality as DemandQuality, recordedAt: row.recordedAt.toISOString(),
      })) satisfies ObservedDemandRevision[],
    });
    if (score.status === "awaiting_evidence") {
      throw new DemandEvidenceConflict(
        "Final scoring requires all issued intervals to have settled complete observations.",
        score.missing,
      );
    }
    if (score.status !== "ready") {
      throw new DemandEvidenceConflict("Forecast or actual observation evidence requires review.");
    }
    const sha = demandSha256(score.report);
    const [record] = await tx.insert(workforceDemandForecastScores).values({
      organizationId: input.organizationId, issueId: issue.id,
      scoredByUserId: input.actorUserId, scoredAt: now,
      evaluationCutoffAt: now, pointsCount: score.report.comparisonCount,
      reportSha256: sha, report: score.report,
    }).returning({ id: workforceDemandForecastScores.id });
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId, actor: input.actorName.slice(0, 120),
      action: "WFM future aggregate demand forecast scored",
      resource: "forecast-issue:" + issue.id,
      metadata: {
        issueId: issue.id, scoreId: record.id,
        snapshotSha256: issue.snapshotSha256, scoreSha256: sha,
        comparisonCount: score.report.comparisonCount,
        evaluatedAt: now.toISOString(),
      },
    });
    return { issueId: issue.id, scoreId: record.id,
      reportSha256: sha, replayed: false, report: score.report };
  });
}
