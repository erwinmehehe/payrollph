// Two new GAP reads in an independent Workforce Demand Governance batch.
// Disposable, fictional stored evidence only. No forecast issuance, staffing
// approval, schedule, payroll or provider interaction is performed by the rows.
// The existing PG16/localhost-HTTP table runner supplies both attackers and
// a genuinely persisted, higher-ID victim employer.
import { createHash } from "node:crypto";

export const fixtureOrder = {};

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
};

// Same sorted-JSON digest contract used for source evidence in the application.
// An internal QA fixture helper, NOT an issuance signature or approval receipt.
export function fixtureDemandSha256(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function createRows({ assert, db, rowTables }) {
  const tables = async () => rowTables ?? (await import("../../../../src/db/schema.ts"));
  const siteSeed = async (employer, suffix) => {
    const { worksites } = await tables();
    const [site] = await db.insert(worksites).values({
      organizationId: employer.org.id, orgUnitId: employer.unit.id,
      code: (employer.marker + suffix).slice(0, 32),
      name: employer.marker + " fictional " + suffix + " worksite",
      timezone: "Asia/Manila", active: true,
    }).returning();
    assert.equal(site.organizationId, employer.org.id);
    return site;
  };
  return [
    {
      key: "GET workforce/demand-observations/issued",
      profile: "allowlisted-reads",
      flags: ["WFM_OPERATIONAL_DEMAND_ENABLED", "WFM_ISSUED_DEMAND_FORECASTS_ENABLED"],
      seed: async employer => {
        const { workforceDemandForecastIssues } = await tables();
        const site = await siteSeed(employer, "-ISS");
        const sourceKey = ("ttbl_" + employer.marker).toLowerCase();
        const predictedCount = 11 + employer.rank;
        const issuedAt = new Date("2026-10-27T02:00:00.000Z");
        const evidenceHash = fixtureDemandSha256({
          fictional: true, marker: employer.marker, kind: "unverified-aggregate-observation",
        });
        const scope = {
          organizationId: employer.org.id, worksiteId: site.id,
          sourceKey, metricKind: "transactions", intervalMinutes: 60, horizonDays: 7,
        };
        const snapshot = {
          version: 1, source: "source_reported_aggregate_workload",
          scope, issuedAt: issuedAt.toISOString(),
          sourceCutoffAt: issuedAt.toISOString(),
          horizonStartPh: "2026-10-28", trainingEvidenceSha256: evidenceHash,
          retrospectiveComparisons: 9,
          points: [{
            intervalStart: "2026-10-28T02:00:00.000Z",
            predictedCount, lowerScenarioCount: predictedCount - 2,
            upperScenarioCount: predictedCount + 2, historicalEvidenceCount: 9,
          }],
          boundary: "Fictional QA source only. Not approved, published or linked to roster/payroll.",
        };
        const hash = fixtureDemandSha256(snapshot);
        const [record] = await db.insert(workforceDemandForecastIssues).values({
          ...scope,
          idempotencyKey: employer.marker + "-qa-issue",
          requestSha256: fixtureDemandSha256(scope),
          issuedByUserId: employer.owner.id,
          issuedAt, sourceCutoffAt: issuedAt,
          trainingEvidenceSha256: evidenceHash, snapshotSha256: hash,
          pointsCount: 1, snapshot,
        }).returning();
        assert.ok(Number.isSafeInteger(record.id) && record.id > 0);
        return { id: record.id, siteId: site.id, sourceKey, hash, predictedCount };
      },
      query: c => "worksiteId=" + c.seeded.siteId,
      foreignQuery: c => "worksiteId=" + c.victimSeeded.siteId,
      prove: (response, c) => {
        const body = response.json;
        assert.equal(body?.readOnly, true);
        assert.deepEqual(Object.keys(body).sort(), ["readOnly", "scope", "issued"].sort());
        assert.deepEqual(body.scope, { organizationId: c.orgId, worksiteId: c.seeded.siteId });
        assert.ok(Array.isArray(body.issued) && body.issued.length === 1,
          "must return exactly one persisted and employer-specific issued record");
        const issue = body.issued[0];
        assert.equal(issue.id, c.seeded.id);
        assert.equal(issue.organizationId, c.orgId);
        assert.equal(issue.worksiteId, c.seeded.siteId);
        assert.equal(issue.sourceKey, c.seeded.sourceKey);
        assert.equal(issue.metricKind, "transactions");
        assert.equal(issue.intervalMinutes, 60);
        assert.equal(issue.horizonDays, 7);
        assert.equal(issue.snapshotSha256, c.seeded.hash);
        assert.equal(issue.integrity, "matches_issued_hash");
        assert.equal(issue.pointsCount, 1);
        assert.equal(issue.score, null, "no actual evidence score has been created");
        assert.equal(issue.snapshot?.scope?.organizationId, c.orgId);
        assert.equal(issue.snapshot?.scope?.worksiteId, c.seeded.siteId);
        assert.equal(issue.snapshot?.scope?.sourceKey, c.seeded.sourceKey);
        assert.equal(issue.snapshot?.points?.length, 1);
        assert.equal(issue.snapshot.points[0].predictedCount, c.seeded.predictedCount);
        assert.match(issue.snapshot.boundary, /^Fictional QA source only/);
        assert.ok(!response.text.includes(c.victim.marker), "victim's marker must not leak");
      },
    },
    {
      key: "GET workforce/demand-staffing/policies",
      profile: "allowlisted-reads",
      flags: [
        "WFM_OPERATIONAL_DEMAND_ENABLED",
        "WFM_ISSUED_DEMAND_FORECASTS_ENABLED",
        "WFM_DEMAND_STAFFING_POLICIES_ENABLED",
      ],
      seed: async employer => {
        const { workforceDemandStaffingPolicies } = await tables();
        const site = await siteSeed(employer, "-POL");
        const spec = {
          organizationId: employer.org.id, worksiteId: site.id,
          jobProfileId: null, metricKind: "transactions", intervalMinutes: 60,
          effectiveFrom: "2026-11-01", effectiveUntil: "2026-11-30",
          productiveUnitsPerWorkerHour: 4 + employer.rank,
          serviceTargetCoveragePercent: 75,
          rationale: employer.marker + " fictional unapproved demand policy",
        };
        const hash = fixtureDemandSha256({ version: 1, spec });
        const [record] = await db.insert(workforceDemandStaffingPolicies).values({
          ...spec,
          version: 1, productiveUnitsPerWorkerHour: spec.productiveUnitsPerWorkerHour.toFixed(4),
          serviceTargetCoveragePercent: spec.serviceTargetCoveragePercent.toFixed(2),
          idempotencyKey: employer.marker + "-qa-policy",
          contentSha256: hash, status: "draft", proposedByUserId: employer.owner.id,
        }).returning();
        assert.ok(Number.isSafeInteger(record.id) && record.id > 0);
        return { id: record.id, siteId: site.id, spec, hash };
      },
      query: c => "worksiteId=" + c.seeded.siteId +
        "&jobProfileId=any&metricKind=transactions&intervalMinutes=60&mode=manage",
      foreignQuery: c => "worksiteId=" + c.victimSeeded.siteId +
        "&jobProfileId=any&metricKind=transactions&intervalMinutes=60&mode=manage",
      prove: (response, c) => {
        const body = response.json;
        assert.equal(body?.readOnly, true);
        assert.deepEqual(Object.keys(body).sort(), ["readOnly", "scope", "policies", "boundary"].sort());
        assert.deepEqual(body.scope, {
          organizationId: c.orgId, worksiteId: c.seeded.siteId,
          jobProfileId: null, metricKind: "transactions", intervalMinutes: 60,
        });
        assert.match(body.boundary, /No roster or payroll write/);
        assert.ok(Array.isArray(body.policies) && body.policies.length === 1,
          "must show one genuine employer-specific draft policy, not an empty default");
        const policy = body.policies[0];
        assert.equal(policy.id, c.seeded.id);
        assert.equal(policy.version, 1);
        assert.equal(policy.status, "draft", "an unapproved policy must not become active");
        assert.equal(policy.approvalIntegrity, "matches_hash");
        assert.equal(policy.contentSha256, c.seeded.hash);
        assert.equal(policy.approvalReceiptSha256, null);
        assert.equal(policy.submittedAt, null);
        assert.equal(policy.approvedAt, null);
        for (const [field, value] of Object.entries(c.seeded.spec)) {
          assert.equal(policy[field], value, field + " must match the own persisted draft");
        }
        assert.ok(!response.text.includes(c.victim.marker), "victim's policy must not leak");
      },
    },
  ];
}
