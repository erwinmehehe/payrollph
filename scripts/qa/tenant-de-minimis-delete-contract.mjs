/** Pure method-specific contracts. These do not credit the coverage inventory. */
import assert from "node:assert/strict";

export function assertHiddenGrant(response, markers = []) {
  assert.equal(response.status, 404, "foreign or absent grant must be 404");
  assert.deepEqual(response.json, { error: "Grant not found." });
  for (const marker of markers) {
    assert.ok(marker && !response.text.includes(marker), "denial body exposed foreign data");
    assert.ok(![...response.headers].some(([k, v]) => (k + ":" + v).includes(marker)),
      "denial header exposed foreign data");
  }
}

export function assertForeignEqualsMissing(foreign, missing, markers = []) {
  assertHiddenGrant(foreign, markers);
  assertHiddenGrant(missing, markers);
  assert.equal(foreign.text, missing.text,
    "genuine foreign grant ID must be indistinguishable from a missing ID");
}

export function assertOwnedGrantEnded(before, after, response, { id, organizationId, actor }) {
  assert.equal(response.status, 200, "owned DELETE must succeed");
  assert.deepEqual(response.json, { ok: true });
  assert.equal(before.grants.length, after.grants.length, "DELETE is a soft end");
  const old = before.grants.find(row => row.id === id);
  const changed = after.grants.find(row => row.id === id);
  assert.ok(old?.active, "positive control needs a genuinely active owned grant");
  assert.ok(changed, "target grant must remain persisted");
  assert.equal(changed.organizationId, organizationId);
  assert.equal(changed.active, false, "grant must become inactive");
  assert.match(changed.endedOn ?? "", /^\d{4}-\d{2}-\d{2}$/, "grant must record an end date");
  const remainder = row => Object.fromEntries(Object.entries(row)
    .filter(([key]) => key !== "active" && key !== "endedOn"));
  assert.deepEqual(remainder(changed), remainder(old), "end may not change unrelated grant fields");
  assert.deepEqual(after.grants.filter(row => row.id !== id),
    before.grants.filter(row => row.id !== id),
    "other owned benefit grants must not change");
  assert.equal(after.audit.length, before.audit.length + 1,
    "successful DELETE must add exactly one employer audit event");
  assert.deepEqual(after.audit.slice(0, -1), before.audit, "old audit events must not change");
  const event = after.audit.at(-1);
  assert.equal(event.organizationId, organizationId);
  assert.equal(event.actor, actor);
  assert.equal(event.action, "De minimis benefit ended");
  assert.equal(event.resource, old.benefitType + " grant " + id);
}
