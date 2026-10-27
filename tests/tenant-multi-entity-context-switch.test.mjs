import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/multi-entity-context-switch.mjs";
import { verifyReceipt } from "../scripts/qa/tenant-legal-employer-admin-receipt.mjs";

const [row] = createRows({ assert, pool: {}, db: {}, eq: () => {}, asc: () => {}, auditEvents: {}, auditBusinessSnapshot: x => x });
const own = {
  orgId: 21, entityId: 44, seeded: { id: 44 }, owner: { id: 33, name: "Fictional employer administrator" },
  victim: { org: { id: 91 }, entity: { id: 144 } }, victimSeeded: { id: 144 },
};
function example() {
  const base = {
    preferences: [{ id: 8, organizationId: 21, userId: 55, legalEntityId: 44,
      updatedAt: "2026-10-27T00:00:00.000Z" }],
    grants: [{ id: 12, organizationId: 21, userId: 33, legalEntityId: 44 }],
    entities: [{ id: 44, organizationId: 21, code: "FICTIONAL", legalName: "Fictional Corp", primaryEntity: true, active: true }],
    audit: [{ id: 70, organizationId: 21, actor: "Old actor", action: "Previous action",
      resource: "Old resource", metadata: {} }],
  };
  const after = structuredClone(base);
  after.preferences.push({ id: 90, organizationId: 21, userId: 33, legalEntityId: 44,
    updatedAt: "2026-10-27T10:00:00.000Z" });
  after.audit.push({ id: 71, organizationId: 21, actor: own.owner.name,
    action: "Entity context changed", resource: "Legal entity",
    metadata: { legalEntityId: 44, actorUserId: 33 } });
  return { before: base, after, response: { json: { legalEntityId: 44 } } };
}

test("exact PATCH method, enabled multi-entity profile, persisted actor/target and real victim selector", () => {
  assert.equal(row.key, "PATCH multi-entity/context");
  assert.equal(row.profile, "multi-entity");
  assert.deepEqual(row.flags, ["MULTI_ENTITY_ENABLED"]);
  for (const key of ["seed", "state", "ownBody", "foreignBody", "expect"]) assert.equal(typeof row[key], "function");
  assert.equal(row.deny ?? 403, 403);
  assert.deepEqual(row.ownBody(own), { organizationId: 21, legalEntityId: 44 });
  assert.deepEqual(row.foreignBody(own), { organizationId: 91, legalEntityId: 144 });
  assert.equal(row.forged.status, 403);
  assert.deepEqual(row.forged.body(own), { organizationId: 21, legalEntityId: 144 });
  assert.ok(own.victimSeeded.id > own.seeded.id, "victim ID must be genuine and higher in shared runner");
});

test("accepts exactly one genuine preference insert and actor-bound audit", () => {
  const { before, after, response } = example();
  row.expect(before, after, own, response);
});

test("fails closed on no-op, wrong tenant, wrong actor, wrong entity, wrong response or stale timestamp", () => {
  const fail = [
    x => { x.after = structuredClone(x.before); },
    x => { x.after.preferences[1].organizationId = 91; },
    x => { x.after.preferences[1].userId = 99; },
    x => { x.after.preferences[1].legalEntityId = 144; },
    x => { x.after.preferences[1].updatedAt = "not-a-date"; },
    x => { x.response.json.legalEntityId = 144; },
    x => { x.after.preferences[0].legalEntityId = 144; },
    x => { x.after.preferences.push({ ...x.after.preferences[1], id: 91 }); },
  ];
  for (const mutation of fail) {
    const e = example(); mutation(e);
    assert.throws(() => row.expect(e.before, e.after, own, e.response));
  }
  const e = example();
  assert.throws(() => row.expect(e.before, e.after, { ...own, orgId: 91 }, e.response));
  assert.throws(() => row.expect(e.before, e.after, { ...own, seeded: { id: 144 } }, e.response));
});

test("rejects permission, legal-employer and audit mutations in any successful own switch", () => {
  const fail = [
    x => { x.after.grants[0].legalEntityId = 144; },
    x => { x.after.entities[0].legalName = "Overwritten"; },
    x => { x.after.audit.pop(); },
    x => { x.after.audit[0].resource = "rewritten audit"; },
    x => { x.after.audit[1].organizationId = 91; },
    x => { x.after.audit[1].actor = "victim"; },
    x => { x.after.audit[1].action = "Grant changed"; },
    x => { x.after.audit[1].metadata.actorUserId = 99; },
    x => { x.after.audit[1].metadata.legalEntityId = 144; },
    x => { x.after.audit.push({ ...x.after.audit[1], id: 72 }); },
  ];
  for (const mutation of fail) {
    const e = example(); mutation(e);
    assert.throws(() => row.expect(e.before, e.after, own, e.response));
  }
});

test("production PATCH still uses membership/grant selector reconciliation and auditable preference write", () => {
  const src = readFileSync("src/app/api/multi-entity/context/route.ts", "utf8");
  const policy = readFileSync("src/lib/multi-entity-server.ts", "utf8");
  assert.match(src, /criticalReleaseFlagEnabled\("multiEntity"\)/);
  assert.match(src, /enforceSameOriginMutation\(request\)/);
  assert.match(src, /getSessionUser\(\)/);
  assert.match(src, /resolveMultiEntityContext\(/);
  assert.match(src, /onConflictDoUpdate\(/);
  assert.match(src, /recordAuditEvent\(/);
  assert.match(policy, /getAccess\(input\.userId, input\.organizationId\)/);
  assert.match(policy, /userLegalEntityGrants\.organizationId, input\.organizationId/);
  assert.match(policy, /userLegalEntityGrants\.userId, input\.userId/);
  assert.match(policy, /resolveExplicitEntitySelection\(/);
  assert.match(policy, /decideEntityAccess\(/);
});

test("PATCH context credit is bound to the executed five-method receipt", () => {
  const receipt = verifyReceipt();
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const methods = manifest.allApiRouteFiles["src/app/api/multi-entity/context/route.ts"].methods;
  const patch = methods.find(x => x.name === "PATCH");
  assert.ok(patch, "PATCH method must exist in source inventory");
  assert.equal(patch.status, "COVERED");
  assert.equal(patch.testedBy.postgresMajor, receipt.postgresMajor);
  assert.ok(patch.testedBy.evidence.includes(receipt.runLabel));
  assert.equal(patch.testedBy.rowFile, "scripts/qa/tenant-table-rows/write/multi-entity-context-switch.mjs");
});
