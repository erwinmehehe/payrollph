import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("table reconciliation cannot silently restore the stale Worker 360 credit", () => {
  const path = "scripts/qa/tenant-isolation-coverage-manifest.json";
  const before = readFileSync(path);
  const result = JSON.parse(execFileSync(process.execPath,
    ["scripts/qa/tenant-table-credit.mjs", "--check"], { encoding: "utf8" }));
  assert.equal(result.newlyCredited, 0);
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(readFileSync(path), before);
});

test("an explicit historical Worker 360 table selection also fails closed", () => {
  const result = spawnSync(process.execPath,
    ["scripts/qa/tenant-table-credit.mjs", "--only-key", "GET hcm/worker-360", "--check"],
    { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /historical organization-only proof was superseded/);
});

for (const key of ["GET year-end", "POST year-end"]) {
  test("superseded " + key + " cannot bypass the source hold through table selection", () => {
    const files = ["scripts/qa/tenant-isolation-coverage-manifest.json",
      "docs/engineering/tenant-isolation-coverage-inventory.md"];
    const before = files.map(path => readFileSync(path));
    for (const extra of [
      ["--check"],
      ["--run-label", "historical table receipt is not source renewal"],
      ["--refresh-links", "--check"],
    ]) {
      const result = spawnSync(process.execPath,
        ["scripts/qa/tenant-table-credit.mjs", "--only-key", key, ...extra],
        { encoding: "utf8" });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /historical annualization proof was superseded/);
      assert.match(result.stderr, /dedicated exact-source renewal required/);
      files.forEach((path, i) => assert.deepEqual(readFileSync(path), before[i],
        "A refused credit selection must not change " + path));
    }
  });
}
