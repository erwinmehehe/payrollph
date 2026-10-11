import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  demandSha256, nextPhDay, phIntervalUtc, makeIssuedDemandSnapshot,
  evaluateFrozenDemandForecast, ISSUED_DEMAND_MAX_POINTS,
  type IssuedDemandSnapshot, type ObservedDemandRevision,
} from "../src/lib/workforce-issued-demand-evidence";
import { forecastObservedWorkload } from "../src/lib/workforce-operational-demand-forecast";
import {
  parseIssueDemandRequest, parseScoreDemandRequest,
} from "../src/lib/workforce-issued-demand-validation";

const issuedAt = new Date("2026-10-11T03:00:00Z"); // 11 AM PH Sunday
const scope = {
  organizationId: 9, worksiteId: 15, sourceKey: "pos-main",
  metricKind: "transactions" as const, intervalMinutes: 30 as const,
  horizonDays: 7 as const,
};
const goodHash = "a".repeat(64);
const mondaySamples = [2,2,2,2,2,2,3,3,4,4,4,5].map((count, index) => {
  const date = new Date("2026-10-12T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - 7 * (12 - index));
  return {
    intervalStart: phIntervalUtc(date.toISOString().slice(0, 10), "09:00"),
    intervalMinutes: 30 as const, revision: 1, observedCount: count, quality: "complete" as const,
  };
});
const model = forecastObservedWorkload({
  metricKind: scope.metricKind, intervalMinutes: scope.intervalMinutes,
  horizonDays: scope.horizonDays, today: "2026-10-12", observations: mondaySamples,
});
const issue = () => makeIssuedDemandSnapshot({
  issuedAt, scope, evidenceSha256: goodHash, forecast: model,
});
const actual = (overrides: Partial<ObservedDemandRevision> = {}): ObservedDemandRevision => ({
  id: 501, intervalStart: phIntervalUtc("2026-10-12", "09:00"),
  intervalMinutes: 30, revision: 1, recordedAt: "2026-10-12T02:00:00.000Z",
  quality: "complete", observedCount: 5, ...overrides,
});
const evaluate = (snapshot: IssuedDemandSnapshot, rows: ObservedDemandRevision[],
  evaluatedAt = "2026-10-14T03:00:00Z") =>
  evaluateFrozenDemandForecast({
    snapshot, issuedSha256: demandSha256(snapshot),
    evaluatedAt: new Date(evaluatedAt), observations: rows,
  });

test("PH daylight boundaries are explicit without browser/server timezone leakage", () => {
  assert.equal(nextPhDay(new Date("2026-10-11T15:59:59Z")), "2026-10-12");
  assert.equal(nextPhDay(new Date("2026-10-11T16:00:00Z")), "2026-10-13");
  assert.equal(phIntervalUtc("2024-02-29", "00:00"), "2024-02-28T16:00:00.000Z");
  assert.throws(() => phIntervalUtc("2026-02-29", "09:00"));
  assert.throws(() => phIntervalUtc("2026-10-12", "24:00"));
});

test("an issued snapshot predicts only future intervals and fixes the source evidence SHA", () => {
  assert.equal(model.status, "ready");
  const snapshot = issue();
  assert.equal(snapshot.issuedAt, issuedAt.toISOString());
  assert.equal(snapshot.sourceCutoffAt, snapshot.issuedAt);
  assert.equal(snapshot.horizonStartPh, "2026-10-12");
  assert.equal(snapshot.points.length, 1);
  assert.equal(snapshot.points[0].intervalStart, "2026-10-12T01:00:00.000Z");
  assert.equal(snapshot.points[0].predictedCount, 4);
  assert.equal(snapshot.trainingEvidenceSha256, goodHash);
  assert.equal(snapshot.scope.worksiteId, 15);
  assert.match(demandSha256(snapshot), /^[a-f0-9]{64}$/);
  assert.match(snapshot.boundary, /No auto-scheduling/);
  assert.notEqual(demandSha256({ ...snapshot, points: [{ ...snapshot.points[0], predictedCount: 10 }] }),
    demandSha256(snapshot));
});

test("issuance refuses incomplete, mismatched, out-of-horizon and too-large predictions", () => {
  assert.throws(() => makeIssuedDemandSnapshot({
    issuedAt, scope, evidenceSha256: "oops", forecast: model,
  }));
  assert.throws(() => makeIssuedDemandSnapshot({
    issuedAt, scope: { ...scope, worksiteId: 15, intervalMinutes: 15 },
    evidenceSha256: goodHash, forecast: model,
  }));
  assert.throws(() => makeIssuedDemandSnapshot({
    issuedAt, scope, evidenceSha256: goodHash,
    forecast: { ...model, points: [{ ...model.points[0], workDate: "2026-10-10" }] },
  }));
  assert.throws(() => makeIssuedDemandSnapshot({
    issuedAt, scope, evidenceSha256: goodHash,
    forecast: { ...model, points: Array.from({ length: ISSUED_DEMAND_MAX_POINTS + 1 },
      () => model.points[0]) },
  }));
});

test("cannot final-score missing, partial or unsettled actuals as zero demand", () => {
  const snap = issue();
  assert.deepEqual(evaluate(snap, []).status, "awaiting_evidence");
  assert.deepEqual(evaluate(snap, [actual({ quality: "partial" })]).status, "awaiting_evidence");
  assert.equal(evaluate(snap, [actual()], "2026-10-12T23:00:00Z").status, "awaiting_evidence");
  assert.deepEqual(evaluate(snap, [actual()]).missing, 0);
  assert.equal(evaluate(snap, [actual()]).status, "ready");
});

test("frozen prospective scoring uses later source-reported counts, WAPE and mean bias", () => {
  const snap = issue();
  const result = evaluate(snap, [actual()]);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw Error("score not ready");
  assert.equal(result.report.comparisonCount, 1);
  assert.equal(result.report.mae, 1);
  assert.equal(result.report.wapePercent, 20);
  assert.equal(result.report.meanBiasCount, -1);
  assert.deepEqual(result.report.points.map(p => p.observationRevisionId), [501]);
  const zeros = evaluate(snap, [actual({ observedCount: 0 })]);
  assert.equal(zeros.status, "ready");
  if (zeros.status !== "ready") throw Error("zero expected");
  assert.equal(zeros.report.wapePercent, null, "zero total actual is undefined WAPE, not infinity");
});

test("latest correction quality wins; no fallback to superseded complete revision", () => {
  const snap = issue();
  assert.equal(evaluate(snap, [
    actual(), actual({ id: 502, revision: 2, observedCount: 9, quality: "partial" }),
  ]).status, "awaiting_evidence");
  const revised = evaluate(snap, [
    actual(), actual({ id: 502, revision: 2, observedCount: 9 }),
  ]);
  assert.equal(revised.status, "ready");
  if (revised.status !== "ready") throw Error("revised");
  assert.equal(revised.report.points[0].reportedCount, 9);
  assert.equal(revised.report.points[0].observationRevisionId, 502);
  assert.equal(revised.report.mae, 5);
});

test("source review blocks early observations, future revisions, duplicates and tampered issue hashes", () => {
  const snap = issue();
  const cases = [
    [actual({ recordedAt: "2026-10-11T02:00:00Z" })],
    [actual({ recordedAt: "2026-11-01T03:00:00Z" })],
    [actual(), actual()],
    [actual({ quality: "bad" as "complete" })],
    [actual({ observedCount: -4 })],
  ];
  for (const rows of cases) assert.equal(evaluate(snap, rows).status, "source_review");
  const damaged = evaluateFrozenDemandForecast({
    snapshot: { ...snap, points: [{ ...snap.points[0], predictedCount: 100 }] },
    issuedSha256: demandSha256(snap), evaluatedAt: new Date("2026-10-14T03:00:00Z"),
    observations: [actual()],
  });
  assert.equal(damaged.status, "source_review");
});

test("strict request parsing rejects extra identifying data and requires explicit approval", () => {
  const request = { ...scope, idempotencyKey: "test-forecast-id-01234", acknowledged: true };
  assert.deepEqual(parseIssueDemandRequest(request), request);
  assert.throws(() => parseIssueDemandRequest({ ...request, customerEmail: "test@example.com" }));
  assert.throws(() => parseIssueDemandRequest({ ...request, acknowledged: false }));
  assert.throws(() => parseIssueDemandRequest({ ...request, metricKind: "patient_id" }));
  assert.deepEqual(parseScoreDemandRequest({
    organizationId: 9, issueId: 1, acknowledged: true,
  }).issueId, 1);
  assert.throws(() => parseScoreDemandRequest({
    organizationId: 9, issueId: 1, acknowledged: true, forceRescore: true,
  }));
});

test("API keeps role, MFA, origin, tenant, flags, advisory lock and no wage writes", () => {
  const issueAPI = readFileSync("src/app/api/workforce/demand-observations/issued/route.ts", "utf8");
  const scoreAPI = readFileSync("src/app/api/workforce/demand-observations/issued/score/route.ts", "utf8");
  const server = readFileSync("src/lib/workforce-issued-demand-server.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.match(issueAPI, /issuedDemandPilotAllowed\(/);
  assert.match(issueAPI, /enforceSameOriginMutation\(request\)/);
  assert.match(issueAPI, /requireSensitiveActionMfa\(user\)/);
  assert.match(issueAPI, /!access.companyWide/);
  assert.match(issueAPI, /operationalDemandSiteAuthorized\(access, site\)/);
  assert.match(scoreAPI, /requireSensitiveActionMfa\(user\)/);
  assert.match(scoreAPI, /eq\(workforceDemandForecastIssues.organizationId, input.organizationId\)/);
  assert.match(server, /pg_advisory_xact_lock\(8857/);
  assert.match(server, /lte\(workforceDemandObservationRevisions.recordedAt, issuedAt\)/);
  assert.match(server, /db.transaction/);
  assert.match(server, /snapshotSha256/);
  assert.match(server, /tx.insert\(auditEvents\)/);
  assert.match(schema, /export const workforceDemandForecastIssues = pgTable/);
  assert.match(schema, /export const workforceDemandForecastScores = pgTable/);
  assert.doesNotMatch(server, /tx\.update\(|tx\.delete\(/);
  assert.doesNotMatch(issueAPI + scoreAPI, /payrollRuns|scheduleOverrides|payoutBatches/);
});
