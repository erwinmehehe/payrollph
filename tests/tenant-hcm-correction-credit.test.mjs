import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { bindTenantReadRequests, selectTenantRowsByFamily } from "../scripts/qa/tenant-table-loader.mjs";

test("reason-read negative uses the genuine victim source ID without mutating the row", () => {
  const definition = Object.freeze({ key: "GET hcm/effective-change-corrections", foreignQuery: c => "changeId=" + c.victimSeeded.id });
  const bound = bindTenantReadRequests(definition, 3, 9, "&changeId=11", { victimSeeded: { id: 91 } });
  assert.equal(bound.own, "/api/hcm/effective-change-corrections?organizationId=3&changeId=11");
  assert.equal(bound.foreign, "/api/hcm/effective-change-corrections?organizationId=9&changeId=91");
  assert.equal(Object.hasOwn(definition, "foreign"), false);
  assert.throws(() => bindTenantReadRequests({ ...definition, foreignQuery: () => undefined }, 3, 9));
});

test("family filtering is explicit, nonempty and cannot duplicate or silently omit method rows", () => {
  const rows = ["return", "resubmit"].map(action => ({ key: "POST hcm/effective-change-corrections/" + action }));
  assert.equal(selectTenantRowsByFamily("write", rows, undefined), rows);
  assert.deepEqual(selectTenantRowsByFamily("write", rows, "hcm-corrections"), rows);
  assert.throws(() => selectTenantRowsByFamily("write", rows, "missing-family"));
  assert.throws(() => selectTenantRowsByFamily("write", rows.slice(0, 1), "hcm-corrections"));
  assert.throws(() => selectTenantRowsByFamily("write", [...rows, rows[0]], "hcm-corrections"));
});
test("selected credit writes preserve every unrelated method's proof provenance", () => {
  mkdirSync("outputs", { recursive: true });
  const root = mkdtempSync(resolve("outputs/correction-credit-test-"));
  const manifestPath = "scripts/qa/tenant-isolation-coverage-manifest.json";
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  const keys = ["return", "resubmit"].map(action => "POST hcm/effective-change-corrections/" + action);
  try {
    cpSync("scripts/qa", join(root, "scripts/qa"), { recursive: true });
    cpSync("docs/engineering", join(root, "docs/engineering"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    cpSync("node_modules/typescript", join(root, "node_modules/typescript"), { recursive: true });
    const copy = structuredClone(original);
    for (const key of keys) {
      const route = key.slice(5); const method = copy.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods[0];
      method.status = "GAP"; method.testedBy = null;
    }
    // Deliberately stale counts in the isolated copy: writer must recompute,
    // not copy guessed totals. No working-tree ledger fields are hand-edited.
    writeFileSync(join(root, manifestPath), JSON.stringify(copy, null, 2) + "\n");
    execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", ...keys.flatMap(key => ["--only-key", key]), "--run-label", "synthetic writer regression, not HTTP evidence"], { cwd: root });
    const after = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
    for (const [path, record] of Object.entries(original.allApiRouteFiles)) for (const method of record.methods) {
      if (!keys.includes(method.name + " " + record.route)) assert.deepEqual(after.allApiRouteFiles[path].methods.find(m => m.name === method.name), method);
    }
    assert.equal(after.metrics.routeFiles, Object.keys(after.allApiRouteFiles).length);
    assert.equal(after.metrics.methods, Object.values(after.allApiRouteFiles).reduce((sum, record) => sum + record.methods.length, 0));
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), original);
  } finally {
    assert.ok(root.startsWith(resolve("outputs") + sep));
    rmSync(root, { recursive: true, force: true });
  }
});
