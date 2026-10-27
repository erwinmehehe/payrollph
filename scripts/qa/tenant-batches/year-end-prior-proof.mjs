import assert from "node:assert/strict";

export function proveOwnPriorRead(response, actor, evidence, digest, revision, approved = false) {
  assert.equal(response.status, 200, "populated own GET must succeed");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const record = response.json?.record;
  assert.ok(record && typeof record === "object", "a null record is not positive evidence");
  assert.deepEqual(record.evidence, evidence, "must return the exact fictional employer's data");
  assert.equal(record.evidence.sourceReference, evidence.sourceReference);
  assert.equal(record.digest, digest, "persisted digest must match");
  assert.match(record.digest, /^[0-9a-f]{64}$/);
  assert.equal(record.revision, revision);
  assert.equal(record.makerUserId, actor.ownerId);
  assert.equal(record.approved, approved);
}
export function proveUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": denied requests and unrelated employer data must be unchanged");
}
function assertSingleAudit(before, after, actor, action, revision) {
  assert.equal(after.audit.length, before.audit.length + 1, "exactly one actor-bound audit");
  const added = after.audit.filter(r => !before.audit.some(old => old.id === r.id));
  assert.equal(added.length, 1);
  assert.deepEqual(after.audit.filter(r => r.id !== added[0].id), before.audit,
    "other audit entries cannot be rewritten");
  const record = added[0];
  assert.equal(record.organizationId, actor.orgId);
  assert.equal(record.actor, action === "approve" ? actor.checkerName : actor.ownerName);
  assert.equal(record.action, "Year-end prior evidence " + action);
  assert.equal(record.resource, "Employee #" + actor.workerId + " / " + actor.taxYear);
  assert.deepEqual(record.metadata, {
    employeeId: actor.workerId, taxYear: actor.taxYear,
    actorUserId: action === "approve" ? actor.checkerId : actor.ownerId,
    revision, plaintextPersisted: false,
  });
}
function stableTables(before, after) {
  for (const key of ["employees", "legalEntities", "adjustments", "payroll"]) {
    assert.deepEqual(after[key], before[key], key + " unexpectedly modified");
  }
}
export function proveSave(before, after, actor, response, oldDigest, newEvidenceDigest) {
  assert.equal(response.status, 200, "own save must succeed over HTTP");
  assert.equal(response.json?.record?.saved, true);
  stableTables(before, after);
  assert.equal(before.prior.length, 1, "seeded previous evidence must exist");
  assert.equal(after.prior.length, 1, "save updates one existing row");
  const old = before.prior[0], now = after.prior[0];
  assert.equal(old.id, actor.priorId);
  assert.equal(now.id, old.id);
  assert.equal(now.organizationId, actor.orgId);
  assert.equal(now.employeeId, actor.workerId);
  assert.equal(now.taxYear, actor.taxYear);
  assert.equal(now.revision, old.revision + 1);
  assert.equal(now.sourceDigest, newEvidenceDigest);
  assert.notEqual(now.sourceDigest, oldDigest);
  assert.ok(now.encryptedEvidence.startsWith("enc:govid:v1:"));
  assert.ok(!now.encryptedEvidence.includes(actor.marker),
    "sensitive fictional source text must not be stored in plaintext");
  assert.notEqual(now.encryptedEvidence, old.encryptedEvidence);
  assert.equal(now.makerUserId, actor.ownerId);
  assert.equal(now.checkerUserId, null);
  assert.equal(now.approvedAt, null);
  assert.ok(now.updatedAt instanceof Date && now.updatedAt.getTime() >= old.updatedAt.getTime());
  assertSingleAudit(before, after, actor, "save", old.revision + 1);
}
export function proveApprove(before, after, actor, response) {
  assert.equal(response.status, 200, "independent checker approval must succeed");
  assert.equal(response.json?.record?.saved, true);
  stableTables(before, after);
  assert.equal(after.prior.length, 1);
  const old = before.prior[0], now = after.prior[0];
  assert.equal(old.id, actor.priorId);
  assert.equal(old.checkerUserId, null);
  assert.equal(old.approvedAt, null);
  for (const key of ["id", "organizationId", "employeeId", "taxYear",
    "revision", "sourceDigest", "encryptedEvidence", "makerUserId"]) {
    assert.deepEqual(now[key], old[key], key + " cannot change on approval");
  }
  assert.notEqual(actor.checkerId, actor.ownerId, "maker and checker must be distinct");
  assert.equal(now.checkerUserId, actor.checkerId);
  assert.ok(now.approvedAt instanceof Date && Number.isFinite(now.approvedAt.getTime()));
  assert.ok(now.updatedAt instanceof Date && now.updatedAt.getTime() >= old.updatedAt.getTime());
  assertSingleAudit(before, after, actor, "approve", old.revision);
}
