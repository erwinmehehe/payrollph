import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows, fixtureDemandSha256 } from "../scripts/qa/tenant-table-rows/read/demand-governance.mjs";

const [issued, policy] = createRows({ assert });
const marker = rank => "TTBL-ATT" + rank + "-fictional";
const sourceKey = rank => ("ttbl_" + marker(rank)).toLowerCase();
const victimMarker = "TTBL-VICTIM-actual-higher-id";

function scope(rank) {
  const orgId = 90 + rank, siteId = 190 + rank;
  return { rank, orgId, siteId, marker: marker(rank),
    victim: { marker: victimMarker },
    owner: { id: 290 + rank },
  };
}
function issueContext(rank) {
  const c = scope(rank);
  return { ...c, seeded: { id: 390 + rank, siteId: c.siteId,
    sourceKey: sourceKey(rank), hash: String(rank).repeat(64),
    predictedCount: 11 + rank,
  } };
}
function policyContext(rank) {
  const c = scope(rank);
  return { ...c, seeded: {
    id: 490 + rank, siteId: c.siteId, hash: String(rank).repeat(64),
    spec: {
      organizationId: c.orgId, worksiteId: c.siteId,
      jobProfileId: null, metricKind: "transactions", intervalMinutes: 60,
      effectiveFrom: "2026-11-01", effectiveUntil: "2026-11-30",
      productiveUnitsPerWorkerHour: 4 + rank,
      serviceTargetCoveragePercent: 75,
      rationale: c.marker + " fictional unapproved demand policy",
    },
  } };
}

function issuedResponse(c) {
  const snapshot = {
    scope: {
      organizationId: c.orgId, worksiteId: c.seeded.siteId,
      sourceKey: c.seeded.sourceKey,
    },
    points: [{ predictedCount: c.seeded.predictedCount }],
    boundary: "Fictional QA source only. Not reviewed or approved.",
  };
  const json = { readOnly: true,
    scope: { organizationId: c.orgId, worksiteId: c.seeded.siteId },
    issued: [{
      id: c.seeded.id, organizationId: c.orgId, worksiteId: c.seeded.siteId,
      sourceKey: c.seeded.sourceKey,
      metricKind: "transactions", intervalMinutes: 60, horizonDays: 7,
      issuedAt: "2026-10-27T02:00:00.000Z",
      snapshotSha256: c.seeded.hash, pointsCount: 1, snapshot,
      integrity: "matches_issued_hash", score: null,
    }],
  };
  return { json, text: JSON.stringify(json) };
}
function policyResponse(c) {
  const json = { readOnly: true,
    scope: { organizationId: c.orgId, worksiteId: c.seeded.siteId,
      jobProfileId: null, metricKind: "transactions", intervalMinutes: 60 },
    policies: [{
      ...c.seeded.spec, id: c.seeded.id, version: 1, status: "draft",
      createdAt: "2026-10-27T03:00:00.000Z",
      submittedAt: null, approvedAt: null, contentSha256: c.seeded.hash,
      approvalReceiptSha256: null, approvalIntegrity: "matches_hash",
    }],
    boundary: "Only independently approved policies may inform planning. No roster or payroll write.",
  };
  return { json, text: JSON.stringify(json) };
}
const mutate = (make, cb) => {
  const r = make(); cb(r.json); r.text = JSON.stringify(r.json); return r;
};

test("two exact separate GAP methods, strict allowlists and source-only GET contract", () => {
  assert.equal(issued.key, "GET workforce/demand-observations/issued");
  assert.equal(policy.key, "GET workforce/demand-staffing/policies");
  assert.equal(issued.profile, "allowlisted-reads");
  assert.equal(policy.profile, "allowlisted-reads");
  assert.deepEqual(issued.flags, [
    "WFM_OPERATIONAL_DEMAND_ENABLED", "WFM_ISSUED_DEMAND_FORECASTS_ENABLED",
  ]);
  assert.deepEqual(policy.flags, [
    "WFM_OPERATIONAL_DEMAND_ENABLED", "WFM_ISSUED_DEMAND_FORECASTS_ENABLED",
    "WFM_DEMAND_STAFFING_POLICIES_ENABLED",
  ]);
  for (const row of [issued, policy]) {
    assert.equal(row.deny ?? 403, 403);
    assert.equal(row.status ?? 200, 200);
    assert.equal(typeof row.seed, "function");
    assert.equal(typeof row.prove, "function");
    assert.equal(typeof row.query, "function");
    assert.equal(typeof row.foreignQuery, "function");
    assert.equal(row.ownBody, undefined);
  }
  const c = issueContext(1), p = policyContext(1);
  assert.equal(issued.query(c), "worksiteId=191");
  assert.equal(policy.query(p),
    "worksiteId=191&jobProfileId=any&metricKind=transactions&intervalMinutes=60&mode=manage");
  assert.equal(issued.foreignQuery({ victimSeeded: { siteId: 999 } }), "worksiteId=999");
  assert.match(policy.foreignQuery({ victimSeeded: { siteId: 999 } }), /^worksiteId=999&/);
});

test("canonical JSONB hash is key-order independent and binds employer-specific facts", () => {
  assert.equal(fixtureDemandSha256({ b: 2, a: { z: 9, c: 1 } }),
    fixtureDemandSha256({ a: { c: 1, z: 9 }, b: 2 }));
  assert.equal(fixtureDemandSha256({ a: 1 }), createHash("sha256")
    .update('{"a":1}').digest("hex"));
  assert.notEqual(fixtureDemandSha256({ organizationId: 11 }),
    fixtureDemandSha256({ organizationId: 22 }));
  assert.notEqual(fixtureDemandSha256({ policy: { rate: 5 } }),
    fixtureDemandSha256({ policy: { rate: 6 } }));
});

test("seeds are persisted own-site, own-actor, computed-hash synthetic records with no money", async () => {
  const rows = [];
  let nextId = 200;
  const rowTables = {
    worksites: { name: "worksites" },
    workforceDemandForecastIssues: { name: "issues" },
    workforceDemandStaffingPolicies: { name: "policies" },
  };
  const db = { insert: table => ({
    values: values => ({
      returning: async () => {
        const item = { id: ++nextId, ...structuredClone(values) };
        rows.push({ table: table.name, values: structuredClone(values), item });
        return [item];
      },
    }),
  }) };
  const defs = createRows({ assert, db, rowTables });
  const e = {
    org: { id: 21 }, unit: { id: 31 }, owner: { id: 41 },
    marker: "TTBL-ATTA-fixture", rank: 1,
  };
  const issue = await defs[0].seed(e);
  const draft = await defs[1].seed(e);
  assert.deepEqual(rows.map(x => x.table), ["worksites", "issues", "worksites", "policies"]);
  assert.equal(rows[0].values.organizationId, 21);
  assert.equal(rows[1].values.organizationId, 21);
  assert.equal(rows[1].values.worksiteId, issue.siteId);
  assert.equal(rows[1].values.issuedByUserId, 41);
  assert.equal(rows[1].values.snapshot.scope.organizationId, 21);
  assert.equal(rows[1].values.snapshot.scope.worksiteId, issue.siteId);
  assert.equal(rows[1].values.snapshotSha256, fixtureDemandSha256(rows[1].values.snapshot));
  assert.equal(rows[1].values.pointsCount, 1);
  assert.equal(rows[1].values.requestSha256.length, 64);
  assert.equal(issue.id, 202);
  assert.equal(rows[3].values.organizationId, 21);
  assert.equal(rows[3].values.worksiteId, draft.siteId);
  assert.equal(rows[3].values.proposedByUserId, 41);
  assert.equal(rows[3].values.status, "draft");
  assert.equal(rows[3].values.version, 1);
  assert.equal(rows[3].values.contentSha256, draft.hash);
  assert.equal(rows[3].values.approvedAt, undefined);
  assert.equal(rows[3].values.decidedByUserId, undefined);
  assert.equal(draft.id, 204);
  assert.notEqual(issue.siteId, draft.siteId);
  assert.equal(rows.every(r => !["payroll_runs", "schedule_overrides", "money"].includes(r.table)), true);
});

test("genuine nonempty own forecast response discriminates employers", () => {
  const a = issueContext(1), b = issueContext(2);
  issued.prove(issuedResponse(a), a);
  issued.prove(issuedResponse(b), b);
  assert.throws(() => issued.prove(issuedResponse(a), b));
  assert.throws(() => issued.prove(issuedResponse(b), a));
  const cases = [
    x => { x.issued = []; },
    x => { x.scope.organizationId = 99; },
    x => { x.issued[0].id += 1; },
    x => { x.issued[0].worksiteId += 1; },
    x => { x.issued[0].sourceKey = "other-employer"; },
    x => { x.issued[0].integrity = "source_review"; },
    x => { x.issued[0].snapshotSha256 = "f".repeat(64); },
    x => { x.issued[0].snapshot.scope.organizationId += 1; },
    x => { x.issued[0].snapshot.points[0].predictedCount += 1; },
    x => { x.issued[0].score = { id: 44 }; },
    x => { x.issued[0].employeeBankAccount = "123456789"; },
    x => { x.issued[0].snapshot.boundary = b.marker; },
    x => { x.extra = a.victim.marker; },
  ];
  for (const change of cases) assert.throws(
    () => issued.prove(mutate(() => issuedResponse(a), change), a));
});

test("genuine nonempty own draft policy response discriminates employers and refuses approvals", () => {
  const a = policyContext(1), b = policyContext(2);
  policy.prove(policyResponse(a), a);
  policy.prove(policyResponse(b), b);
  assert.throws(() => policy.prove(policyResponse(a), b));
  assert.throws(() => policy.prove(policyResponse(b), a));
  const cases = [
    x => { x.policies = []; },
    x => { x.scope.organizationId = 99; },
    x => { x.policies[0].id += 1; },
    x => { x.policies[0].status = "approved"; },
    x => { x.policies[0].approvalIntegrity = "source_review"; },
    x => { x.policies[0].approvalReceiptSha256 = "a".repeat(64); },
    x => { x.policies[0].approvedAt = "2026-11-01T00:00:00Z"; },
    x => { x.policies[0].submittedAt = "2026-11-01T00:00:00Z"; },
    x => { x.policies[0].rationale = b.seeded.spec.rationale; },
    x => { x.policies[0].productiveUnitsPerWorkerHour += 1; },
    x => { x.policies[0].employeeBankAccount = "123456789"; },
    x => { x.extra = a.victim.marker; },
  ];
  for (const change of cases) assert.throws(
    () => policy.prove(mutate(() => policyResponse(a), change), a));
});

test("dynamic allowlists, negative-control URLs and flag profile are only synthetic", () => {
  const env = readFileSync("scripts/qa/tenant-table-env.mjs", "utf8");
  const bootstrap = readFileSync("scripts/qa/tenant-table-allowlist-bootstrap.mjs", "utf8");
  const invariants = readFileSync("scripts/qa/tenant-table-invariants.mjs", "utf8");
  const negative = readFileSync("scripts/qa/tenant-table-allowlist-negative.mjs", "utf8");
  for (const flag of ["WFM_ISSUED_DEMAND_FORECASTS_ENABLED", "WFM_DEMAND_STAFFING_POLICIES_ENABLED"]) {
    assert.match(env, new RegExp(flag + ': "true"'));
  }
  for (const key of ["WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS",
    "WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS"]) {
    assert.ok(bootstrap.includes('"' + key + '"'));
    assert.ok(invariants.includes('"' + key + '"'));
    assert.ok(!env.includes(key + "="), "static allowlist must not be committed");
  }
  assert.match(negative, /\/api\/workforce\/demand-observations\/issued/);
  assert.match(negative, /\/api\/workforce\/demand-staffing\/policies/);
  assert.match(negative, /gateRoutes: 10/);
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const key of [issued.key, policy.key]) {
    const [verb,route] = key.split(" ");
    const record = Object.values(manifest.allApiRouteFiles).find(x => x.route === route);
    assert.equal(record?.methods?.find(x => x.name === verb)?.status, "GAP",
      key + " must not receive credits from this batch");
  }
});
