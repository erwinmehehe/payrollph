/** Read the CI-only credential fixture from a private runner-owned directory. */
import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const MAX_FIXTURE_BYTES = 64 * 1024;
const PRIVATE_DIRECTORY = /^payrollph-dl02-[A-Za-z0-9_-]+$/;

function assertProcessOwner(stat, label) {
  if (typeof process.getuid === "function") {
    assert.equal(stat.uid, process.getuid(), label + " must belong to this process");
  }
}

/** Refuse globally writable /tmp and any other untrusted fixture root. */
export function assertPrivateDl02RunnerTemp(runnerTemp) {
  assert.ok(typeof runnerTemp === "string" && isAbsolute(runnerTemp),
    "DL-02 requires an absolute RUNNER_TEMP directory");
  const root = resolve(runnerTemp);
  const stat = lstatSync(root);
  assert.ok(stat.isDirectory(), "DL-02 RUNNER_TEMP must be a real directory");
  assert.equal(stat.mode & 0o022, 0, "DL-02 RUNNER_TEMP must not be group/other writable");
  assertProcessOwner(stat, "DL-02 RUNNER_TEMP");
  return root;
}

export function readPrivateDl02Fixture(file, runnerTemp = process.env.RUNNER_TEMP) {
  const root = assertPrivateDl02RunnerTemp(runnerTemp);
  assert.ok(typeof file === "string" && isAbsolute(file),
    "DL-02 fixture must be the private CI-generated file");
  const dir = dirname(file);
  assert.ok(basename(file) === "three-employers.json" &&
    dirname(dir) === root && PRIVATE_DIRECTORY.test(basename(dir)) &&
    join(dir, "three-employers.json") === file,
  "DL-02 fixture must be the private CI-generated file");
  const dirStat = lstatSync(dir);
  assert.ok(dirStat.isDirectory(), "DL-02 fixture directory must not be a symlink");
  assert.equal(dirStat.mode & 0o077, 0, "DL-02 fixture directory must be private");
  assertProcessOwner(dirStat, "DL-02 fixture directory");
  // O_NOFOLLOW rejects a swapped final symlink; O_NONBLOCK avoids blocking on
  // an unexpected FIFO. Read from the same verified descriptor, never reopen.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile(), "DL-02 fixture must be a regular file");
    assert.equal(stat.mode & 0o077, 0, "fixture cookies must stay private");
    assert.equal(stat.nlink, 1, "DL-02 fixture must not have hard links");
    assertProcessOwner(stat, "DL-02 fixture");
    assert.ok(stat.size > 0 && stat.size <= MAX_FIXTURE_BYTES,
      "DL-02 fixture must be nonempty and bounded");
    const json = readFileSync(fd, "utf8");
    assert.ok(Buffer.byteLength(json) <= MAX_FIXTURE_BYTES, "DL-02 fixture exceeds size limit");
    return JSON.parse(json);
  } finally {
    closeSync(fd);
  }
}
