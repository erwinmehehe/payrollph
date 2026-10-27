import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrivateDl02Fixture } from "../scripts/qa/tenant-dl02-fixture-reader.mjs";

function withFixture(fn) {
  const runnerTemp = mkdtempSync(join(tmpdir(), "dl02-test-runner-"));
  const dir = mkdtempSync(join(runnerTemp, "payrollph-dl02-"));
  const file = join(dir, "three-employers.json");
  try { fn({ file, dir, runnerTemp }); } finally { rmSync(runnerTemp, { recursive: true, force: true }); }
}

test("DL-02 fixture reads a private regular file from runner-owned storage", () => {
  withFixture(({ file, runnerTemp }) => {
    const payload = { schema: "tenant-dl02-closure-three-employers-v1", attackers: [1, 2], victim: 3 };
    writeFileSync(file, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
    assert.deepEqual(readPrivateDl02Fixture(file, runnerTemp), payload);
  });
});

test("DL-02 fixture refuses a symlink to private credentials", () => {
  withFixture(({ file, dir, runnerTemp }) => {
    const target = join(dir, "target.json");
    writeFileSync(target, "{}", { mode: 0o600 });
    symlinkSync(target, file);
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp));
  });
});

test("DL-02 fixture refuses permissive or oversize files", () => {
  withFixture(({ file, runnerTemp }) => {
    writeFileSync(file, "{}", { mode: 0o600 });
    chmodSync(file, 0o644);
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp), /private/);
    chmodSync(file, 0o600);
    writeFileSync(file, "X".repeat(65537));
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp), /bounded/);
  });
});

test("DL-02 fixture refuses untrusted locations and directory substitution", () => {
  withFixture(({ file, dir, runnerTemp }) => {
    writeFileSync(file, "{}", { mode: 0o600 });
    assert.throws(() => readPrivateDl02Fixture("/tmp/arbitrary.json", runnerTemp), /private CI-generated/);
    assert.throws(() => readPrivateDl02Fixture(join(dir, "other.json"), runnerTemp), /private CI-generated/);
    const fakeDir = join(runnerTemp, "payrollph-dl02-symlink");
    symlinkSync(dir, fakeDir);
    assert.throws(() => readPrivateDl02Fixture(join(fakeDir, "three-employers.json"), runnerTemp), /symlink/);
  });
});

test("DL-02 fixture refuses untrusted root and permissive directories", () => {
  withFixture(({ file, dir, runnerTemp }) => {
    writeFileSync(file, "{}", { mode: 0o600 });
    assert.throws(() => readPrivateDl02Fixture(file, tmpdir()), /RUNNER_TEMP must not be/);
    chmodSync(dir, 0o755);
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp), /directory must be private/);
    chmodSync(dir, 0o700);
    chmodSync(runnerTemp, 0o777);
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp), /RUNNER_TEMP must not be/);
    chmodSync(runnerTemp, 0o700);
  });
});

test("DL-02 fixture refuses hard-linked credential files", () => {
  withFixture(({ file, dir, runnerTemp }) => {
    writeFileSync(file, "{}", { mode: 0o600 });
    linkSync(file, join(dir, "linked.json"));
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp), /hard links/);
  });
});

test("DL-02 reader cannot create a missing credential-bearing file", () => {
  withFixture(({ file, runnerTemp }) => {
    assert.equal(existsSync(file), false);
    assert.throws(() => readPrivateDl02Fixture(file, runnerTemp), { code: "ENOENT" });
    assert.equal(existsSync(file), false);
  });
});

test("DL-02 reader explicitly declares private mode for the CodeQL tempfile guard", () => {
  const source = readFileSync(new URL("../scripts/qa/tenant-dl02-fixture-reader.mjs", import.meta.url), "utf8");
  assert.match(source,
    /openSync\(file,\s*constants\.O_RDONLY \| constants\.O_NOFOLLOW \| constants\.O_NONBLOCK,\s*0o600\)/);
});
