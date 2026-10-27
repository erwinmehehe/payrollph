import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";
import { bindTenantReadRequests, loadTenantRows, validateTenantRow } from "../scripts/qa/tenant-table-loader.mjs";

const parityBaseline = JSON.parse(readFileSync("scripts/qa/tenant-table-rows/baseline.json", "utf8"));
function originalRows(kind) { return parityBaseline[kind]; }

test("the family split preserves every original method, full executable row body and fixture order", () => {
  for (const kind of ["read", "write"]) {
    const original = originalRows(kind);
    const keys = new Set(original.map((row) => row.key));
    assert.deepEqual(tenantFamilyCatalog(kind).filter((row) => keys.has(row.key)).map(({ key, text }) => ({ key, sha256: createHash("sha256").update(text).digest("hex") })), original);
  }
});

test("every family factory loads with its original profile and complete proof contract", async () => {
  // Factory construction must not execute DB/HTTP calls. Function bodies run only inside the guarded runner.
  const deferredProof = () => () => {};
  const context = new Proxy({}, { get: (_, name) => name === "proofs"
    ? new Proxy({}, { get: () => deferredProof }) : deferredProof });
  for (const kind of ["read", "write"]) {
    const rows = await loadTenantRows(kind, context);
    assert.deepEqual(rows.map((r) => r.key), tenantFamilyCatalog(kind).map((r) => r.key));
    assert.ok(Object.isFrozen(rows) && rows.every(Object.isFrozen));
  }
});

function withFamilies(files, check) {
  const root = mkdtempSync(join(tmpdir(), "fictional-tenant-families-"));
  try {
    mkdirSync(join(root, "read")); mkdirSync(join(root, "write"));
    for (const [file, source] of Object.entries(files)) writeFileSync(join(root, "read", file), source);
    check(pathToFileURL(root + "/"));
  } finally { assert.equal(dirname(root), tmpdir()); rmSync(root, { recursive: true, force: true }); }
}
const factory = (body) => "export function createRows() { return [" + body + "]; }";

test("catalog refuses duplicate methods, dynamic keys, wrong verbs, unknown profiles and missing flags", () => {
  const row = '{ key: "GET fictional", prove: () => {} }';
  withFamilies({ "a.mjs": factory(row), "b.mjs": factory(row) }, (root) => assert.throws(() => tenantFamilyCatalog("read", root), /duplicate tenant method/));
  for (const [body, message] of [
    ['{ key: process.env.METHOD, prove: () => {} }', /method key must be literal/],
    ['{ key: "POST fictional", prove: () => {} }', /incorrect method identity/],
    ['{ key: "GET fictional", profile: "unknown", prove: () => {} }', /unknown profile/],
    ['{ key: "GET fictional", flags: ["MULTI_ENTITY_ENABLED"], prove: () => {} }', /profile does not enable/],
    ['...[]', /cannot use spreads/],
  ]) withFamilies({ "a.mjs": factory(body) }, (root) => assert.throws(() => tenantFamilyCatalog("read", root), message));
  withFamilies({ "untracked.txt": factory(row) }, (root) => assert.throws(() => tenantFamilyCatalog("read", root), /unexpected family entry/));
});

test("runtime contract rejects missing proofs, false success, foreign success and source/runtime drift", () => {
  const readSpec = { key: "GET fictional", kind: "read", profile: "default", flags: [] };
  const good = { key: readSpec.key, prove: () => {} };
  validateTenantRow(good, readSpec);
  for (const bad of [{ ...good, prove: undefined }, { ...good, key: "GET other" }, { ...good, status: 404 },
    { ...good, deny: 200 }, { ...good, profile: "multi-entity" }, { ...good, flags: ["UNREVIEWED_FLAG"] }]) {
    assert.throws(() => validateTenantRow(bad, readSpec));
  }
  const spec = { ...readSpec, key: "PATCH fictional", kind: "write" };
  const write = { key: spec.key, state: () => [], expect: () => {}, ownBody: () => ({}), foreignBody: () => ({}) };
  validateTenantRow(write, spec);
  for (const field of ["state", "expect", "ownBody", "foreignBody"]) {
    assert.throws(() => validateTenantRow({ ...write, [field]: undefined }, spec));
  }
});

test("credit refresh retains statuses and pins both the family row and actual shared HTTP assertions", () => {
  const path = "scripts/qa/tenant-isolation-coverage-manifest.json";
  const before = readFileSync(path, "utf8");
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--refresh-links", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0);
  assert.deepEqual(report.before, report.after);
  assert.equal(readFileSync(path, "utf8"), before);
  const manifest = JSON.parse(before);
  for (const kind of ["read", "write"]) {
    for (const row of tenantFamilyCatalog(kind)) {
      const [verb, route] = row.key.split(" ");
      const record = Object.values(manifest.allApiRouteFiles).find((r) => r.route === route);
      const proof = record.methods.find((m) => m.name === verb).testedBy;
      if (proof?.file !== "scripts/qa/tenant-table-http.mjs" && proof?.file !== "scripts/qa/tenant-write-table-http.mjs") continue;
      assert.equal(proof.rowFile, row.file);
      assert.equal(proof.rowLine, row.line);
      const source = readFileSync(proof.file, "utf8").split("\n");
      assert.match(source[proof.ownPositiveLine - 1], /const owned = expectStatus/);
      assert.match(source[proof.foreignDenialLine - 1], /const foreign = expectStatus/);
      assert.match(source[proof.unchangedDbLine - 1], /assert\.deepEqual\(victimAfter, victimBefore/);
    }
  }
});

test("two attacker attempts bind independent URLs while frozen definitions retain their proof", async () => {
  const proof = () => {};
  const definition = Object.freeze({ key: "GET fictional", prove: proof, flags: Object.freeze([]) });
  const first = bindTenantReadRequests(definition, 11, 99, "&employeeId=21");
  const second = bindTenantReadRequests(definition, 12, 99, "&employeeId=22");
  assert.equal(first.own, "/api/fictional?organizationId=11&employeeId=21");
  assert.equal(first.foreign, "/api/fictional?organizationId=99&employeeId=21");
  assert.equal(second.own, "/api/fictional?organizationId=12&employeeId=22");
  assert.equal(second.foreign, "/api/fictional?organizationId=99&employeeId=22");
  assert.equal(first.prove, proof);
  assert.equal(second.prove, proof);
  assert.equal(Object.hasOwn(definition, "own"), false);
  assert.equal(Object.hasOwn(definition, "foreign"), false);
  assert.ok(Object.isFrozen(definition) && Object.isFrozen(first) && Object.isFrozen(second));
  const runner = readFileSync("scripts/qa/tenant-table-http.mjs", "utf8");
  assert.match(runner, /const item = bindTenantReadRequests\(definition, own\.org\.id, victim\.org\.id, extra, ctx\)/);
  assert.doesNotMatch(runner, /item\.(?:own|foreign) =/);
});
