import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  organizations, users, worksites, auditEvents,
  workforceDemandImportBatches, workforceDemandObservationRevisions,
  workforceDemandForecastIssues, workforceDemandForecastScores,
} from "../src/db/schema";
import { nextPhDay, phIntervalUtc, makeIssuedDemandSnapshot, demandSha256 } from
  "../src/lib/workforce-issued-demand-evidence";
import {
  DemandEvidenceConflict, issueOperationalDemandForecast, finalizeOperationalDemandScore,
  fetchIssuedDemandForecasts,
} from "../src/lib/workforce-issued-demand-server";
import type { WorkloadDemandForecast } from "../src/lib/workforce-operational-demand-forecast";

const DAY_MS = 86_400_000;
function addDays(day: string, count: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + DAY_MS * count).toISOString().slice(0, 10);
}

test("isolated PostgreSQL freezes issue once, blocks early score, and never silently rescores corrections", async () => {
  const mark = randomUUID().slice(0, 8);
  const [org] = await db.insert(organizations).values({
    name: "Synthetic forecast " + mark,
    legalName: "Synthetic forecast " + mark,
  }).returning({ id: organizations.id });
  let siteId = 0, userId = 0;
  try {
    const [site] = await db.insert(worksites).values({
      organizationId: org.id, code: "ISSUED-" + mark,
      name: "Fictional interval site", timezone: "Asia/Manila",
    }).returning({ id: worksites.id });
    siteId = site.id;
    const [operator] = await db.insert(users).values({
      name: "Synthetic Demand Auditor",
      email: "wfm-issue-" + mark + "@example.invalid",
      passwordHash: "synthetic-never-used", role: "owner",
    }).returning({ id: users.id });
    userId = operator.id;

    const now = new Date();
    const tomorrow = nextPhDay(now);
    const historical = Array.from({ length: 12 }, (_, i) => {
      const date = addDays(tomorrow, -7 * (12 - i));
      return phIntervalUtc(date, "09:00");
    });
    const [batch] = await db.insert(workforceDemandImportBatches).values({
      organizationId: org.id, worksiteId: siteId, sourceKey: "pos-main",
      metricKind: "transactions", intervalMinutes: 30,
      idempotencyKey: "hist-" + randomUUID(), requestSha256: "a".repeat(64),
      rowCount: historical.length, createdByUserId: userId,
    }).returning({ id: workforceDemandImportBatches.id });
    await db.insert(workforceDemandObservationRevisions).values(historical.map((slot, i) => ({
      organizationId: org.id, worksiteId: siteId, importBatchId: batch.id,
      sourceKey: "pos-main", metricKind: "transactions", intervalMinutes: 30,
      intervalStart: new Date(slot), revision: 1,
      observedCount: [2,2,2,2,2,2,3,3,4,4,4,5][i],
      quality: "complete", recordedAt: new Date(Date.parse(slot) + 3600_000),
    })));

    const request = {
      organizationId: org.id, worksiteId: siteId,
      sourceKey: "pos-main", metricKind: "transactions" as const,
      intervalMinutes: 30 as const, horizonDays: 7 as const,
      idempotencyKey: "issue-" + randomUUID(), acknowledged: true as const,
    };
    const issuer = { request, actorUserId: userId, actorName: "Synthetic Demand Auditor" };
    const result = await issueOperationalDemandForecast(issuer);
    assert.equal(result.replayed, false);
    assert.ok(result.pointsCount >= 1);
    assert.match(result.snapshotSha256, /^[a-f0-9]{64}$/);
    const replay = await issueOperationalDemandForecast(issuer);
    assert.equal(replay.replayed, true);
    assert.equal(replay.issueId, result.issueId);
    await assert.rejects(
      issueOperationalDemandForecast({
        ...issuer,
        request: { ...request, horizonDays: 14 },
      }), DemandEvidenceConflict,
      "One idempotency key cannot issue different horizons",
    );
    await assert.rejects(
      finalizeOperationalDemandScore({
        organizationId: org.id, issueId: result.issueId,
        actorUserId: userId, actorName: "Synthetic Demand Auditor",
      }), DemandEvidenceConflict,
      "Cannot finalize the still-future forecast before actuals arrive and settle",
    );
    const visible = await fetchIssuedDemandForecasts({
      organizationId: org.id, worksiteId: siteId,
    });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].integrity, "matches_issued_hash");
    assert.equal(visible[0].score, null);
    assert.equal((await fetchIssuedDemandForecasts({
      organizationId: org.id + 10000, worksiteId: siteId,
    })).length, 0, "cross-tenant reads return no evidence");

    // Construct a fictional issue that was made 25 days ago and whose target
    // future interval was subsequently completed. No clock manipulation or
    // real employer data is involved.
    const oldIssuedAt = new Date(Date.now() - 25 * DAY_MS);
    const oldTarget = nextPhDay(oldIssuedAt);
    const fakeForecast: WorkloadDemandForecast = {
      status: "ready", source: "reported_aggregate_operational_counts",
      metricKind: "transactions", intervalMinutes: 30, horizonDays: 7,
      historicalVersions: 12, latestIntervals: 12, qualityExcluded: 0,
      predictedIntervals: 1, unknownIntervals: 0,
      backtest: { comparisons: 3, mae: 1, wapePercent: 20 },
      points: [{
        workDate: oldTarget, startTime: "09:00", predictedCount: 4,
        lowerScenarioCount: 3, upperScenarioCount: 5,
        heldOutMae: 1, heldOutWapePercent: 20, evidenceCount: 12,
        lastSourceDate: addDays(oldTarget, -7),
      }],
      boundary: "Synthetic source-reported volume only.",
    };
    const scope = {
      organizationId: org.id, worksiteId: siteId,
      sourceKey: "pos-main", metricKind: "transactions" as const,
      intervalMinutes: 30 as const, horizonDays: 7 as const,
    };
    const snapshot = makeIssuedDemandSnapshot({
      scope, issuedAt: oldIssuedAt,
      evidenceSha256: "b".repeat(64), forecast: fakeForecast,
    });
    const sha = demandSha256(snapshot);
    const [oldIssue] = await db.insert(workforceDemandForecastIssues).values({
      ...scope, idempotencyKey: "previous-" + randomUUID(),
      requestSha256: "c".repeat(64), issuedByUserId: userId,
      issuedAt: oldIssuedAt, sourceCutoffAt: oldIssuedAt,
      trainingEvidenceSha256: snapshot.trainingEvidenceSha256,
      snapshotSha256: sha, pointsCount: snapshot.points.length, snapshot,
    }).returning({ id: workforceDemandForecastIssues.id });
    const targetInterval = new Date(snapshot.points[0].intervalStart);
    const [actualBatch] = await db.insert(workforceDemandImportBatches).values({
      organizationId: org.id, worksiteId: siteId, sourceKey: "pos-main",
      metricKind: "transactions", intervalMinutes: 30,
      idempotencyKey: "actual-" + randomUUID(), requestSha256: "d".repeat(64),
      rowCount: 1, createdByUserId: userId,
    }).returning({ id: workforceDemandImportBatches.id });
    await db.insert(workforceDemandObservationRevisions).values({
      organizationId: org.id, worksiteId: siteId, importBatchId: actualBatch.id,
      sourceKey: "pos-main", metricKind: "transactions",
      intervalMinutes: 30, intervalStart: targetInterval, revision: 1,
      observedCount: 5, quality: "complete",
      recordedAt: new Date(targetInterval.getTime() + 2 * 3600_000),
    });
    const score = await finalizeOperationalDemandScore({
      organizationId: org.id, issueId: oldIssue.id,
      actorUserId: userId, actorName: "Synthetic Demand Auditor",
    });
    assert.equal(score.replayed, false);
    assert.equal(score.report.comparisonCount, 1);
    assert.equal(score.report.wapePercent, 20);
    const scoreReplay = await finalizeOperationalDemandScore({
      organizationId: org.id, issueId: oldIssue.id,
      actorUserId: userId, actorName: "Synthetic Demand Auditor",
    });
    assert.equal(scoreReplay.replayed, true);
    assert.equal(scoreReplay.scoreId, score.scoreId);

    // A revision arriving later does not alter the one-time issued score.
    const [lateBatch] = await db.insert(workforceDemandImportBatches).values({
      organizationId: org.id, worksiteId: siteId, sourceKey: "pos-main",
      metricKind: "transactions", intervalMinutes: 30,
      idempotencyKey: "late-" + randomUUID(), requestSha256: "e".repeat(64),
      rowCount: 1, createdByUserId: userId,
    }).returning({ id: workforceDemandImportBatches.id });
    await db.insert(workforceDemandObservationRevisions).values({
      organizationId: org.id, worksiteId: siteId, importBatchId: lateBatch.id,
      sourceKey: "pos-main", metricKind: "transactions",
      intervalMinutes: 30, intervalStart: targetInterval, revision: 2,
      observedCount: 90, quality: "complete", recordedAt: new Date(),
    });
    const frozen = await finalizeOperationalDemandScore({
      organizationId: org.id, issueId: oldIssue.id,
      actorUserId: userId, actorName: "Synthetic Demand Auditor",
    });
    assert.equal(frozen.report.wapePercent, 20);
    assert.equal(frozen.reportSha256, score.reportSha256);
    const scoreRows = await db.select().from(workforceDemandForecastScores)
      .where(eq(workforceDemandForecastScores.organizationId, org.id));
    assert.equal(scoreRows.length, 1);
  } finally {
    await db.delete(workforceDemandForecastScores).where(
      eq(workforceDemandForecastScores.organizationId, org.id));
    await db.delete(workforceDemandForecastIssues).where(
      eq(workforceDemandForecastIssues.organizationId, org.id));
    await db.delete(workforceDemandObservationRevisions).where(
      eq(workforceDemandObservationRevisions.organizationId, org.id));
    await db.delete(workforceDemandImportBatches).where(
      eq(workforceDemandImportBatches.organizationId, org.id));
    await db.delete(auditEvents).where(eq(auditEvents.organizationId, org.id));
    if (siteId) await db.delete(worksites).where(eq(worksites.id, siteId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
