import assert from "node:assert/strict";

/** A populated positive must identify the actual seeded owner, batch and worker. */
export function assertOwnedRosterRead(response, employer) {
  assert.equal(response.status, 200, "own roster batch GET must succeed");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  const batches = response.json?.batches;
  assert.ok(Array.isArray(batches) && batches.length === 1,
    "expected one real, seeded batch; an empty list is not a positive");
  const [batch] = batches;
  assert.equal(batch.id, employer.batchId);
  assert.equal(batch.reason, employer.reason);
  assert.equal(batch.status, "pending");
  assert.equal(batch.requestedByUserId, employer.makerId);
  assert.equal(batch.requestedBy, employer.makerName);
  assert.equal(batch.shiftDefinitionId, employer.shiftId);
  assert.ok(Array.isArray(batch.employees) && batch.employees.length === 1);
  assert.equal(batch.employees[0].id, employer.workerId);
  assert.equal(batch.employees[0].employeeNo, employer.marker);
  assert.ok(batch.employees[0].name.includes(employer.marker));
  assert.equal(batch.overrideCount, 0);
}

/** Includes the protected tenant rows, audit and scheduling/payroll state. */
export function assertUnchangedState(before, after, label) {
  assert.deepEqual(after, before, label + ": no tenant or audit state may change");
}

export function assertRejectedRosterMutation(before, after, employer, response) {
  assert.equal(response.status, 200, "own reject must succeed over real HTTP");
  assert.equal(response.json?.id, employer.batchId);
  assert.equal(response.json?.status, "rejected");
  for (const key of ["staff", "shifts", "overrides", "payroll", "punches", "leaves"]) {
    assert.deepEqual(after[key], before[key], key + " must not change on reject");
  }
  assert.equal(before.batches.length, 1, "one real pending batch must exist");
  assert.equal(after.batches.length, before.batches.length, "reject cannot insert or delete batches");
  const old = before.batches[0], updated = after.batches[0];
  assert.equal(old.id, employer.batchId);
  assert.equal(old.organizationId, employer.orgId);
  assert.equal(old.status, "pending");
  for (const key of [
    "id", "organizationId", "workDate", "shiftDefinitionId", "employeeIds",
    "evidenceSha256", "requestSha256", "idempotencyKey", "reason",
    "requestedByUserId", "requestedByName", "requestedAt", "overrideIds", "createdAt",
  ]) assert.deepEqual(updated[key], old[key], key + " must remain immutable");
  assert.equal(updated.status, "rejected");
  assert.equal(updated.decidedByUserId, employer.ownerId);
  assert.equal(updated.decidedByName, employer.ownerName);
  assert.equal(updated.decisionNote, employer.note);
  assert.ok(updated.decidedAt instanceof Date &&
    Number.isFinite(updated.decidedAt.getTime()), "a real decision timestamp is required");
  assert.ok(updated.updatedAt instanceof Date &&
    updated.updatedAt.getTime() >= old.updatedAt.getTime());
  assert.equal(after.audits.length, before.audits.length + 1,
    "one actor-bound audit event must be persisted");
  assert.deepEqual(after.audits.slice(0, -1), before.audits,
    "previous audit events must not change");
  const added = after.audits.at(-1);
  assert.equal(added.organizationId, employer.orgId);
  assert.equal(added.actor, employer.ownerName);
  assert.equal(added.action, "WFM bulk roster batch rejected");
  assert.equal(added.resource, "Batch #" + employer.batchId);
  assert.deepEqual(added.metadata, { batchId: employer.batchId, reason: employer.note });
}
