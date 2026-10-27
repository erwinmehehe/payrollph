import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows as readRows } from "../scripts/qa/tenant-table-rows/read/assets.mjs";
import { createRows as writeRows } from "../scripts/qa/tenant-table-rows/write/assets.mjs";

const read = readRows({ assert, pool: {} });
const write = writeRows({ assert, pool: {} });
const fixture = {
  orgId: 21, workerId: 34, marker: "FICTIONAL-ATTA-123", seeded: { id: 52 },
  victim: { org: { id: 91 }, worker: { id: 99 }, marker: "FICTIONAL-VICTIM-123" },
  victimSeeded: { id: 144 },
};
const own = (id, name, organizationId = fixture.orgId, employeeId = fixture.workerId) =>
  ({ id, organizationId, employeeId, name, type: "laptop", serialNumber: null, status: "assigned" });

// These tests validate the fixture/expectation contract without claiming HTTP
// success; CI also runs the real localhost production build and disposable PG16.
test("asset custody selects four exact method keys and requires genuine evidence", () => {
  assert.deepEqual(read.map((row) => row.key), ["GET assets"]);
  assert.deepEqual(write.map((row) => row.key), ["POST assets", "PATCH assets", "DELETE assets"]);
  for (const row of [...read, ...write]) {
    assert.equal(row.deny ?? 403, 403);
    assert.equal(typeof row.seed, "function");
  }
  for (const row of write) {
    assert.equal(typeof row.state, "function");
    assert.equal(typeof row.expect, "function");
  }
  assert.equal(write[0].status, 201);
  assert.equal(write[1].forged.status, 404);
  assert.equal(write[0].forged.status, 404);
});

test("GET detects a real own asset, fails empty and foreign-only responses", () => {
  const get = read[0];
  const good = own(fixture.seeded.id, fixture.marker + " read asset");
  get.prove({ json: [good] }, fixture);
  assert.throws(() => get.prove({ json: [] }, fixture));
  assert.throws(() => get.prove({ json: [own(144, fixture.victim.marker + " read asset", 91, 99)] }, fixture));
  assert.throws(() => get.prove({ json: [good, own(144, fixture.victim.marker + " read asset", 91, 99)] }, fixture));
  assert.throws(() => get.prove({ json: [good] }, { ...fixture, orgId: 22, seeded: { id: 53 } }));
});

test("POST proves only an own-employer insert and refuses a forged worker selector", () => {
  const post = write[0];
  const body = post.ownBody(fixture);
  assert.equal(body.organizationId, fixture.orgId);
  assert.equal(body.employeeId, fixture.workerId);
  assert.equal(post.foreignBody(fixture).organizationId, fixture.victim.org.id);
  assert.equal(post.forged.body(fixture).employeeId, fixture.victim.worker.id);
  const before = [own(52, "existing")];
  const added = { ...own(160, fixture.marker + " created"), serialNumber: fixture.marker + "-SERIAL" };
  const after = [...before, added];
  post.expect(before, after, fixture, { json: { id: 160, organizationId: 21, employeeId: 34 } });
  assert.throws(() => post.expect(before, before, fixture, { json: {} }));
  assert.throws(() => post.expect(before, [...before, { ...added, organizationId: 91 }], fixture,
    { json: { id: 160, organizationId: 91 } }));
});

test("PATCH requires exactly one own asset name change; victim and peer cannot pass", () => {
  const patch = write[1];
  assert.equal(patch.ownBody(fixture).id, fixture.seeded.id);
  assert.equal(patch.foreignBody(fixture).id, fixture.victimSeeded.id);
  assert.equal(patch.forged.body(fixture).employeeId, fixture.victim.worker.id);
  const before = [own(52, "unchanged original"), own(53, "peer")];
  const after = [{ ...before[0], name: fixture.marker + " patched" }, before[1]];
  patch.expect(before, after, fixture, { json: { id: 52, name: fixture.marker + " patched" } });
  assert.throws(() => patch.expect(before, [after[0], { ...before[1], name: "modified peer" }], fixture,
    { json: { id: 52, name: fixture.marker + " patched" } }));
  assert.throws(() => patch.expect(before, after, { ...fixture, seeded: { id: 144 } }, { json: {} }));
});

test("DELETE uses persisted victim ID in foreign URL and preserves all other rows", () => {
  const del = write[2];
  assert.equal(del.query(fixture, "own"), "id=52");
  assert.equal(del.query(fixture, "foreign"), "id=144");
  const before = [own(52, "to remove"), own(53, "keep")];
  del.expect(before, [before[1]], fixture, { json: { success: true } });
  assert.throws(() => del.expect(before, [], fixture, { json: { success: true } }));
  assert.throws(() => del.expect(before, [before[1]], { ...fixture, seeded: { id: 144 } },
    { json: { success: true } }));
});

test("source still derives employer access from a real membership and scopes asset ownership", () => {
  const source = readFileSync("src/app/api/assets/route.ts", "utf8");
  assert.match(source, /assertOrganizationRole\(/);
  assert.match(source, /getAccess\(user\.id, organizationId\)/);
  assert.match(source, /eq\(assets\.organizationId, organizationId\)/);
  assert.match(source, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(source, /eq\(assets\.organizationId, target\.organizationId\)/);
  assert.match(source, /enforceSameOriginMutation\(request\)/);
});

test("all four asset API methods remain GAP until the actual HTTP evidence is reviewed", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = manifest.allApiRouteFiles["src/app/api/assets/route.ts"];
  assert.ok(record, "asset custody methods must be inventoried");
  assert.deepEqual(record.methods.map((m) => [m.name, m.status]),
    [["GET", "GAP"], ["POST", "GAP"], ["PATCH", "GAP"], ["DELETE", "GAP"]]);
});
