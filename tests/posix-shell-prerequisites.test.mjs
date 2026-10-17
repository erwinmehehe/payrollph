import assert from "node:assert/strict";
import test from "node:test";
import { posixShellTestSkipReason } from "./helpers/posix-shell-prerequisites.mjs";

test("Windows skips shell-only fixtures without invoking bash or jq", () => {
  let invoked = false;
  const reason = posixShellTestSkipReason({
    platform: "win32", needsJq: true,
    probe: () => { invoked = true; throw new Error("should not launch a subprocess"); },
  });
  assert.match(reason, /Windows/);
  assert.equal(invoked, false);
});

test("missing jq skips jq-dependent fixtures, not bash-only syntax checks", () => {
  const calls = [];
  const probe = (binary) => {
    calls.push(binary);
    return binary === "jq" ? { error: Object.assign(new Error("absent"), { code: "ENOENT" }), status: null }
      : { status: 0 };
  };
  assert.equal(posixShellTestSkipReason({ platform: "linux", ci: false, probe }), false);
  const reason = posixShellTestSkipReason({ platform: "linux", ci: false, needsJq: true, probe });
  assert.match(reason, /jq available on PATH/);
  assert.deepEqual(calls, ["bash", "bash", "jq"]);
});

test("healthy POSIX requirements execute; broken bash is not silently accepted", () => {
  const ok = () => ({ status: 0 });
  assert.equal(posixShellTestSkipReason({ platform: "linux", ci: false, needsJq: true, probe: ok }), false);
  assert.match(posixShellTestSkipReason({
    platform: "linux", ci: false,
    probe: () => ({ status: 1 }),
  }), /bash available on PATH/);
});

test("POSIX CI never hides a missing bash or jq behind a fixture skip", () => {
  const missing = () => ({ error: Object.assign(new Error("not installed"), { code: "ENOENT" }), status: null });
  assert.equal(posixShellTestSkipReason({
    platform: "linux", ci: true, probe: missing,
  }), false);
  const jqOnlyMissing = (binary) => binary === "jq" ? missing() : { status: 0 };
  assert.equal(posixShellTestSkipReason({
    platform: "linux", ci: true, needsJq: true, probe: jqOnlyMissing,
  }), false);
  // Native Windows cannot run Bash fixtures; Windows-only skip remains explicit.
  assert.match(posixShellTestSkipReason({
    platform: "win32", ci: true, needsJq: true, probe: missing,
  }), /Windows/);
});
