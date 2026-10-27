import assert from "node:assert/strict";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/read/registration-changes.mjs";

const [row] = createRows({ assert });
const context = (rank) => ({
  entityId: 100 + rank,
  owner: { id: 1000 + rank },
  victim: { entity: { id: 999 }, marker: "TTBL-VICTIM-PERSISTED" },
  seeded: {
    id: 10000 + rank,
    legalEntityId: 100 + rank,
    reason: "TTBL-ATT" + rank + " fictional statutory registration request",
    envelope: "NONDECRYPTABLE_PRIVATE_FIXTURE_TTBL-ATT" + rank,
    historyId: 20000 + rank, makerId: 3000 + rank, versionId: 30000 + rank, revision: rank,
    historyReason: 'TTBL-ATT' + rank + ' fictional historical approval',
  },
});

function response(contextValue = context(1)) {
  const data = {
    requests: [{ id: contextValue.seeded.historyId, effectiveDate: '2026-10-26', changedFields: ['legalName'], status: 'approved',
      reason: contextValue.seeded.historyReason, requestedByUserId: contextValue.seeded.makerId, decidedByUserId: contextValue.owner.id,
      createdAt: '2026-10-26T10:00:00Z', decidedAt: '2026-10-26T11:00:00Z', canReview: false }, {
      id: contextValue.seeded.id, effectiveDate: "2026-10-27",
      changedFields: ["displayName"], status: "pending_approval",
      reason: contextValue.seeded.reason,
      requestedByUserId: contextValue.owner.id, decidedByUserId: null,
      createdAt: "2026-10-27T10:00:00.000Z", decidedAt: null,
      canReview: false,
    }],
    versions: [{ id: contextValue.seeded.versionId, revision: contextValue.seeded.revision, effectiveDate: '2026-10-26',
      approvedByUserId: contextValue.owner.id, createdAt: '2026-10-26T11:00:00Z' }], today: "2026-10-27",
  };
  return { json: data, text: JSON.stringify(data) };
}

test("one exact read-only method uses the multi-entity flagged tenant profile", () => {
  assert.equal(row.key, "GET multi-entity/registration-changes");
  assert.equal(row.profile, "multi-entity");
  assert.deepEqual(row.flags, ["MULTI_ENTITY_ENABLED", "MULTI_ENTITY_REGISTRATIONS_ENABLED"]);
  assert.equal(row.query(context(1)), "legalEntityId=101");
  assert.equal(row.foreignQuery(context(1)), "legalEntityId=999");
  assert.equal(row.deny ?? 403, 403);
  assert.equal(row.status ?? 200, 200);
  assert.equal(typeof row.seed, "function");
  assert.equal(typeof row.prove, "function");
  assert.equal(row.ownBody, undefined);
});

test("disposable fixture writes one pending record to the actual employer and owner only", async () => {
  const employer = {
    org: { id: 77 }, entity: { id: 88, updatedAt: new Date("2026-10-27T02:00:00Z") },
    owner: { id: 99 }, marker: "TTBL-SYNTHETIC-X",
  };
  const granted = [];
  const calls = [];
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: 811 }] };
  } };
  const [fixture] = createRows({ assert, pool: db, grantOwnEntity: async e => { granted.push(e); } });
  const seeded = await fixture.seed(employer);
  assert.deepEqual(granted, [employer]);
  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /INSERT INTO legal_entity_profile_change_requests/);
  assert.match(calls[0].sql, /RETURNING id/);
  assert.equal(calls[0].values.length, 9);
  assert.deepEqual(calls[0].values.slice(0, 5), [77, 88, employer.entity.updatedAt,
    "2026-10-27", '["displayName"]']);
  assert.equal(calls[0].values[5], "NONDECRYPTABLE_PRIVATE_FIXTURE_TTBL-SYNTHETIC-X");
  assert.equal(calls[0].values[6], "TTBL-SYNTHETIC-X fictional statutory registration request");
  assert.deepEqual(calls[0].values.slice(7), ["pending_approval", 99]);
  assert.equal(seeded.id, 811);
  assert.equal(seeded.legalEntityId, 88);
  assert.equal(seeded.envelope, calls[0].values[5]);
  assert.match(calls[1].sql, /local_password_enabled/);
  assert.deepEqual(calls[2].values.slice(0, 4), [77, 88, '2026-10-26', '["legalName"]']);
  assert.deepEqual(calls[2].values.slice(6), ['approved', 811, 99]);
  assert.deepEqual(calls[3].values, [77, 88, 1, '2026-10-26', seeded.envelope, 99, 811]);
});

test("own-positive evidence is employer discriminating and rejects forged or empty data", () => {
  const first = context(1), second = context(2);
  row.prove(response(first), first);
  row.prove(response(second), second);
  assert.throws(() => row.prove(response(first), second));
  assert.throws(() => row.prove(response(second), first));
  const cases = [
    d => { d.requests = []; },
    d => { d.requests[0].id += 1; },
    d => { d.requests[0].reason = second.seeded.historyReason; },
    d => { d.requests[0].requestedByUserId = second.owner.id; },
    d => { d.requests[0].changedFields = []; },
    d => { d.requests[0].status = "pending_approval"; },
    d => { d.requests[0].canReview = true; },
    d => { d.requests[0].effectiveDate = "2026-01-01"; },
    d => { d.versions.push({ id: 1 }); },
    d => { d.versions = []; },
    d => { d.versions[0].id = second.seeded.versionId; },
    d => { d.versions[0].approvedByUserId = second.owner.id; },
    d => { d.versions[0].profileEnvelope = 'PRIVATE'; },
  ];
  for (const mutate of cases) {
    const altered = response(first);
    mutate(altered.json);
    altered.text = JSON.stringify(altered.json);
    assert.throws(() => row.prove(altered, first));
  }
});

test("rejects leaked sealed values, victim marker, PII and unexpected scope metadata", () => {
  const first = context(1);
  for (const edit of [
    d => { d.requests[0].profileEnvelope = first.seeded.envelope; },
    d => { d.requests[0].tin = "123456789"; },
    d => { d.requests[0].organizationId = 555; },
    d => { d.requests[0].legalEntityId = 999; },
    d => { d.requests[1].decidedByUserId = 42; },
    d => { d.requests[1].decidedAt = "2026-10-27T10:00:00Z"; },
    d => { d.extra = first.victim.marker; },
    d => { d.requests[0].reason = first.victim.marker; },
  ]) {
    const altered = response(first);
    edit(altered.json);
    altered.text = JSON.stringify(altered.json);
    assert.throws(() => row.prove(altered, first));
  }
  for (const leaked of [first.seeded.envelope, first.victim.marker]) {
    const altered = response(first);
    altered.text += leaked;
    assert.throws(() => row.prove(altered, first));
  }
});
