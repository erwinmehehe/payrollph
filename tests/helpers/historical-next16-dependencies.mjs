/** Immutable historical Next.js 16.4.2 inputs for archived proof receipts ONLY. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FILE = "tests/fixtures/tenant-next-16-4-2-lock-delta.json";
const FILE_SHA = "4e9f4ef0838f5a75d8dec487f0cf407d935e8cdf";
const blob = value => {
  const bytes = Buffer.from(value);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};
const from = value => Buffer.isBuffer(value) ? value : Buffer.from(value);

export function historicalNext16DependencyInput(path, read = readFileSync) {
  assert.ok(path === "package.json" || path === "package-lock.json");
  const record = from(read(FILE));
  assert.equal(blob(record), FILE_SHA, "Historical dependency delta fixture changed");
  const fixture = JSON.parse(record.toString("utf8"));
  assert.equal(fixture.schema, "payrollph-historic-next-package-delta-v1");
  assert.equal(fixture.purpose, "Historical security receipt verification only. NEVER current Next.js proof.");
  const source = from(read(path));
  const fresh = path === "package.json" ? fixture.after.packageSha : fixture.after.lockSha;
  const historic = path === "package.json" ? fixture.before.packageSha : fixture.before.lockSha;
  // This reconstruction MUST refuse any future dependency or package change.
  assert.equal(blob(source), fresh, "Current framework input is not the exact reviewed 16.4.6 upgrade");
  let historical;
  if (path === "package.json") {
    const text = source.toString("utf8");
    assert.equal(text.split('"next": "16.4.6"').length, 2);
    assert.equal(text.split('"eslint-config-next": "16.4.6"').length, 2);
    historical = text.replace('"next": "16.4.6"', '"next": "16.4.2"')
      .replace('"eslint-config-next": "16.4.6"', '"eslint-config-next": "16.4.2"');
  } else {
    const target = JSON.parse(source.toString("utf8"));
    assert.equal(Object.keys(fixture.previousLockPackages).length, 13);
    for (const [key, previous] of Object.entries(fixture.previousLockPackages)) {
      assert.ok(Object.hasOwn(target.packages, key), "Historic lock entry missing: " + key);
      target.packages[key] = previous;
    }
    historical = JSON.stringify(target, null, 2) + "\n";
  }
  assert.equal(blob(Buffer.from(historical)), historic, "Historical Next.js receipt source cannot be reconstructed");
  return Buffer.from(historical);
}
