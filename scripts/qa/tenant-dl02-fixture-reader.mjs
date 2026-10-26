/** Read the CI-only credential fixture through one validated file descriptor. */
import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

const MAX_FIXTURE_BYTES = 64 * 1024;

export function readPrivateDl02Fixture(file) {
  assert.ok(typeof file === "string" &&
    /^\/tmp\/payrollph-dl02-[A-Za-z0-9_-]+\/three-employers\.json$/.test(file),
  "DL-02 fixture must be the private CI-generated file");
  // O_NOFOLLOW rejects a swapped final symlink. O_NONBLOCK avoids opening a
  // replaced FIFO indefinitely before the fstat regular-file check.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile(), "DL-02 fixture must be a regular file");
    assert.equal(stat.mode & 0o077, 0, "fixture cookies must stay private");
    assert.equal(stat.nlink, 1, "DL-02 fixture must not have hard links");
    if (typeof process.getuid === "function") {
      assert.equal(stat.uid, process.getuid(), "DL-02 fixture must belong to this process");
    }
    assert.ok(stat.size > 0 && stat.size <= MAX_FIXTURE_BYTES,
      "DL-02 fixture must be nonempty and bounded");
    // Read from the same descriptor whose type, owner, size and mode were
    // checked. Reopening by pathname here would reintroduce the TOCTOU race.
    const json = readFileSync(fd, "utf8");
    assert.ok(Buffer.byteLength(json) <= MAX_FIXTURE_BYTES, "DL-02 fixture exceeds size limit");
    return JSON.parse(json);
  } finally {
    closeSync(fd);
  }
}
