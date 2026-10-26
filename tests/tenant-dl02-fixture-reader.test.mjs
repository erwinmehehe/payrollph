import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrivateDl02Fixture } from "../scripts/qa/tenant-dl02-fixture-reader.mjs";

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "payrollph-dl02-"));
  const file = join(dir, "three-employers.json");
  try { fn({ file, dir }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("DL-02 fixture reads a private regular file with no path reopening", () => {
  withFixture(({ file }) => {
    const payload = { schema: "tenant-dl02-closure-three-employers-v1", attackers: [1, 2], victim: 3 };
    writeFileSync(file, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
    assert.deepEqual(readPrivateDl02Fixture(file), payload);
  });
});

test("DL-02 fixture refuses a symlink to private credentials", () => {
  withFixture(({ file, dir }) => {
    const target = join(dir, "target.json");
    writeFileSync(target, "{}", { mode: 0o600 });
    symlinkSync(target, file);
    assert.throws(() => readPrivateDl02Fixture(file));
  });
});

test("DL-02 fixture refuses permissive or oversize files", () => {
  withFixture(({ file }) => {
    writeFileSync(file, "{}", { mode: 0o600 });
    chmodSync(file, 0o644);
    assert.throws(() => readPrivateDl02Fixture(file), /private/);
    chmodSync(file, 0o600);
    writeFileSync(file, "X".repeat(65537));
    assert.throws(() => readPrivateDl02Fixture(file), /bounded/);
  });
});

test("DL-02 fixture refuses untrusted locations and directory substitution", () => {
  assert.throws(() => readPrivateDl02Fixture("/tmp/arbitrary.json"), /private CI-generated/);
  withFixture(({ dir }) => {
    assert.throws(() => readPrivateDl02Fixture(join(dir, "other.json")), /private CI-generated/);
  });
});
