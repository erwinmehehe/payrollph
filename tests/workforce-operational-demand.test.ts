import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseDemandImport, demandImportDigest, operationalDemandPilotAllowed,
} from "../src/lib/workforce-operational-demand-import";
import {
  forecastObservedWorkload,
  type DemandObservationVersion,
} from "../src/lib/workforce-operational-demand-forecast";
import { operationalDemandSiteAuthorized } from "../src/lib/workforce-operational-demand-scope";

const time = (workDate: string, clock = "09:00") =>
  new Date(workDate + "T" + clock + ":00+08:00").toISOString();
const today = "2026-10-12"; // PH Monday
const base = {
  organizationId: 30, worksiteId: 40, sourceKey: "pos-main",
  metricKind: "transactions", intervalMinutes: 30,
  idempotencyKey: "a4ca95c4-6c6c-48ff-9d92-f21f7c257eb3",
  acknowledged: true,
  rows: [{
    intervalStart: "2026-10-10T09:00:00+08:00",
    observedCount: 27, quality: "complete", revision: 1,
  }],
};

test("strict aggregate-only import accepts completed Philippine interval with deterministic digest", () => {
  const first = parseDemandImport(base, new Date("2026-10-11T20:00:00+08:00"));
  assert.deepEqual(first.rows, base.rows);
  assert.match(demandImportDigest(first), /^[a-f0-9]{64}$/);
  const reversed = parseDemandImport({ ...base,
    rows: [base.rows[0], { ...base.rows[0], intervalStart: "2026-10-10T09:30:00+08:00" }],
  }, new Date("2026-10-11T20:00:00+08:00"));
  const switched = parseDemandImport({ ...base,
    rows: [...reversed.rows].reverse(),
  }, new Date("2026-10-11T20:00:00+08:00"));
  assert.equal(demandImportDigest(reversed), demandImportDigest(switched));
  assert.notEqual(demandImportDigest(first), demandImportDigest(reversed));
});

test("reject PII-like extra fields, ambiguous times, future, invalid alignment and duplicates", () => {
  const now = new Date("2026-10-11T20:00:00+08:00");
  const rejects = [
    { ...base, customerEmail: "customer@example.test" },
    { ...base, acknowledged: false },
    { ...base, sourceKey: "*" },
    { ...base, organizationId: 0 },
    { ...base, intervalMinutes: 12 },
    { ...base, rows: [{ ...base.rows[0], customerId: "x" }] },
    { ...base, rows: [{ ...base.rows[0], intervalStart: "2026-10-10T09:00:00Z" }] },
    { ...base, rows: [{ ...base.rows[0], intervalStart: "2026-10-10T09:15:00+08:00" }] },
    { ...base, rows: [{ ...base.rows[0], intervalStart: "2026-10-10T23:45:00+08:00" }] },
    { ...base, rows: [{ ...base.rows[0], intervalStart: "2026-10-12T09:00:00+08:00" }] },
    { ...base, rows: [{ ...base.rows[0], intervalStart: "2026-02-30T09:00:00+08:00" }] },
    { ...base, rows: [{ ...base.rows[0], observedCount: -1 }] },
    { ...base, rows: [{ ...base.rows[0], observedCount: 2.5 }] },
    { ...base, rows: [{ ...base.rows[0], quality: "unknown" }] },
    { ...base, rows: [{ ...base.rows[0], revision: 0 }] },
    { ...base, rows: [base.rows[0], base.rows[0]] },
    { ...base, rows: Array.from({ length: 101 }, (_, i) => ({
      ...base.rows[0], intervalStart: "2026-10-10T09:00:00+08:00", revision: i + 1,
    })) },
  ];
  for (const bad of rejects) {
    assert.throws(() => parseDemandImport(bad, now), Error, JSON.stringify(bad).slice(0, 130));
  }
});

function historicalMondays(counts: readonly number[], quality = "complete"):
    DemandObservationVersion[] {
  return counts.map((observedCount, i) => {
    const date = new Date("2026-10-12T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - 7 * (counts.length - i));
    return {
      intervalStart: time(date.toISOString().slice(0, 10)), intervalMinutes: 30,
      revision: 1, observedCount, quality: quality as "complete",
    };
  });
}
const run = (rows: readonly DemandObservationVersion[], horizonDays: 7 | 14 = 7) =>
  forecastObservedWorkload({
    today, horizonDays, intervalMinutes: 30, metricKind: "transactions",
    observations: rows,
  });

test("reported workload outlook uses only earlier observations and an actual-count holdout", () => {
  const values = [2,2,2,2,2,2,3,3,4,4,4,5];
  const out = run(historicalMondays(values));
  assert.equal(out.status, "ready");
  assert.equal(out.latestIntervals, 12);
  assert.equal(out.points.length, 1, "missing other slots/days never become zero");
  assert.equal(out.points[0].workDate, today);
  assert.equal(out.points[0].startTime, "09:00");
  assert.equal(out.points[0].predictedCount, 4);
  assert.equal(out.backtest.comparisons, 3);
  assert.equal(out.backtest.mae, 1);
  assert.equal(out.backtest.wapePercent, 23.08);
  assert.match(out.boundary, /not a frozen live-production accuracy score/);
  assert.deepEqual(run(historicalMondays(values), 14).points.map(r => r.workDate),
    ["2026-10-12", "2026-10-19"]);
});

test("latest corrected revision wins, including revoking an earlier complete interval", () => {
  const base = historicalMondays([1,1,1,1,1,1,1,1,1,1,1,1]);
  const correction = { ...base[11], revision: 2, observedCount: 30 };
  const out = run([...base, correction]);
  assert.equal(out.latestIntervals, 12);
  assert.ok(out.points[0].predictedCount > 1);
  const rescinded = run([...base, { ...correction, quality: "partial" }]);
  assert.equal(rescinded.qualityExcluded, 1);
  assert.equal(rescinded.latestIntervals, 12);
  assert.equal(rescinded.points[0].predictedCount, 1, "do not silently fall back to stale complete v1");
});

test("missing/partial observations, sparse slots and malformed versions fail closed", () => {
  assert.equal(run([]).status, "insufficient_history");
  assert.equal(run(historicalMondays([0,0,0,0,0,0,0,0,0])).points[0].predictedCount, 0);
  assert.equal(run(historicalMondays([3,3,3,3,3,3,3,3])).status, "insufficient_history");
  assert.equal(run(historicalMondays([1,1,1,1,1,1,1,1,1], "partial")).status, "insufficient_history");
  const valid = historicalMondays([1,1,1,1,1,1,1,1,1]);
  assert.equal(run([...valid, valid[0]]).status, "source_review");
  assert.equal(run([...valid, { ...valid[0], observedCount: -1, revision: 2 }]).status, "source_review");
  assert.equal(run([...valid.slice(1), { ...valid[0], intervalStart: "bad" }]).status, "source_review");
  assert.equal(run([...valid.slice(1), { ...valid[0], intervalMinutes: 15 }]).status, "source_review");
  assert.equal(run([...valid.slice(1), { ...valid[0], intervalStart: time(today) }]).status, "source_review");
});

test("tenant and org-unit access fail closed; unauthorised switches cannot expose cross-site demand", () => {
  const manager = { organizationId: 1, companyWide: false, orgUnitId: 3 };
  assert.equal(operationalDemandSiteAuthorized(manager, { organizationId: 1, orgUnitId: 3, active: true }), true);
  assert.equal(operationalDemandSiteAuthorized(manager, { organizationId: 2, orgUnitId: 3, active: true }), false);
  assert.equal(operationalDemandSiteAuthorized(manager, { organizationId: 1, orgUnitId: 4, active: true }), false);
  assert.equal(operationalDemandSiteAuthorized(manager, { organizationId: 1, orgUnitId: null, active: true }), false);
  assert.equal(operationalDemandSiteAuthorized(manager, { organizationId: 1, orgUnitId: 3, active: false }), false);
  const owner = { organizationId: 1, companyWide: true, orgUnitId: null };
  assert.equal(operationalDemandSiteAuthorized(owner, { organizationId: 1, orgUnitId: null, active: true }), true);
  assert.equal(operationalDemandSiteAuthorized(owner, { organizationId: 2, orgUnitId: null, active: true }), false);
});

test("operational demand refuses incoherent access flags and malformed site ownership", () => {
  const company = { organizationId: 1, companyWide: true, orgUnitId: null };
  const ownSite = { organizationId: 1, orgUnitId: 3, active: true };
  // The original truthy companyWide shortcut would have accepted these shapes.
  const malformed: unknown[] = [
    null, undefined,
    { organizationId: 1, companyWide: true, orgUnitId: 3 },
    { organizationId: 1, companyWide: "true", orgUnitId: null },
    { organizationId: 1, companyWide: 1, orgUnitId: null },
    { organizationId: 1, companyWide: false, orgUnitId: null },
    { organizationId: 1, companyWide: false, orgUnitId: 0 },
    { organizationId: 1, companyWide: false, orgUnitId: -3 },
    { organizationId: 1, companyWide: false, orgUnitId: 3.5 },
    { organizationId: 1, companyWide: false, orgUnitId: "3" },
    { organizationId: 1, companyWide: "false", orgUnitId: 3 },
    { organizationId: 0, companyWide: true, orgUnitId: null },
    { organizationId: 1.5, companyWide: true, orgUnitId: null },
    { organizationId: Number.MAX_SAFE_INTEGER + 1, companyWide: true, orgUnitId: null },
  ];
  for (const candidate of malformed) {
    assert.equal(operationalDemandSiteAuthorized(
      candidate as Parameters<typeof operationalDemandSiteAuthorized>[0], ownSite,
    ), false, JSON.stringify(candidate));
  }
  const malformedSites: unknown[] = [
    null, undefined,
    { organizationId: 2, orgUnitId: 3, active: true },
    { organizationId: 0, orgUnitId: 3, active: true },
    { organizationId: 1, orgUnitId: 0, active: true },
    { organizationId: 1, orgUnitId: -1, active: true },
    { organizationId: 1, orgUnitId: 2.5, active: true },
    { organizationId: 1, orgUnitId: Number.MAX_SAFE_INTEGER + 1, active: true },
    { organizationId: 1, orgUnitId: 3, active: "true" },
  ];
  for (const candidate of malformedSites) {
    assert.equal(operationalDemandSiteAuthorized(
      company, candidate as Parameters<typeof operationalDemandSiteAuthorized>[1],
    ), false, JSON.stringify(candidate));
  }
  // Legitimate company-wide and same-unit reads retain their existing results.
  assert.equal(operationalDemandSiteAuthorized(company, ownSite), true);
  assert.equal(operationalDemandSiteAuthorized(
    { organizationId: 1, companyWide: false, orgUnitId: 3 }, ownSite,
  ), true);
});

test("source routes are guarded, remain aggregation-only and never write roster or payroll", () => {
  const imp = readFileSync("src/app/api/workforce/demand-observations/import/route.ts", "utf8");
  const get = readFileSync("src/app/api/workforce/demand-observations/outlook/route.ts", "utf8");
  const storage = readFileSync("src/lib/workforce-operational-demand-server.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const sql = readFileSync("drizzle/0112_wfm_operational_demand_observations.sql", "utf8");
  assert.match(imp, /enforceSameOriginMutation\(request\)/);
  assert.match(imp, /requireSensitiveActionMfa\(user\)/);
  assert.match(imp, /PEOPLE_ADMIN_ROLES/);
  assert.match(imp, /!access.companyWide/);
  assert.match(imp, /operationalDemandPilotAllowed\(batch.organizationId\)/);
  assert.match(get, /WFM_OPERATIONAL_DEMAND_ENABLED/);
  assert.match(get, /eq\(worksites.organizationId, organizationId\)/);
  assert.match(get, /operationalDemandSiteAuthorized\(access, site\)/);
  assert.match(get, /WORKFORCE_MANAGER_ROLES/);
  assert.match(storage, /eq\(workforceDemandObservationRevisions.organizationId, input.organizationId\)/);
  assert.match(storage, /pg_advisory_xact_lock/);
  assert.match(storage, /idempotencyKey/);
  assert.match(storage, /db.transaction/);
  assert.match(storage, /tx.insert\(auditEvents\)/);
  assert.match(schema, /export const workforceDemandImportBatches = pgTable/);
  assert.match(schema, /export const workforceDemandObservationRevisions = pgTable/);
  assert.match(sql, /wfm_demand_observation_version_unique/);
  assert.doesNotMatch(imp, /payrollRuns|employeePayProfiles|scheduleOverrides/);
  assert.doesNotMatch(get, /export async function POST/);
});
