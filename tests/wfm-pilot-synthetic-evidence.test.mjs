import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWfmTapResult } from "../scripts/lib/wfm-tap-summary.mjs";

const tap = ({ tests = 2, pass = tests, fail = 0, skipped = 0, cancelled = 0, todo = 0 } = {}) =>
  ["TAP version 13", "# tests " + tests, "# pass " + pass, "# fail " + fail,
    "# cancelled " + cancelled, "# skipped " + skipped, "# todo " + todo, ""].join("\n");

test("a normal non-skipped TAP subprocess can pass only as synthetic coverage", () => {
  const report = evaluateWfmTapResult({ exitCode: 0, output: tap() });
  assert.equal(report.passed, true);
  assert.equal(report.passedTests, 2);
});

test("a zero-exit process without any tests must fail closed", () => {
  const result = evaluateWfmTapResult({ exitCode: 0, output: tap({ tests: 0 }) });
  assert.equal(result.passed, false);
  assert.equal(result.failureKind, "zero-executed-tests");
});

test("missing TAP summary cannot turn a successful process into a scenario PASS", () => {
  const result = evaluateWfmTapResult({ exitCode: 0, output: "no TAP summary" });
  assert.equal(result.passed, false);
  assert.equal(result.failureKind, "tap-summary-missing");
});

test("skipped or todo work cannot count as completed mapped coverage", () => {
  for (const output of [
    tap({ tests: 2, pass: 1, skipped: 1 }),
    tap({ tests: 2, pass: 1, todo: 1 }),
    tap({ tests: 2, pass: 1, cancelled: 1 }),
  ]) {
    assert.equal(evaluateWfmTapResult({ exitCode: 0, output }).passed, false);
  }
});

test("nonzero exit or nonzero TAP failures block scenario PASS", () => {
  assert.equal(evaluateWfmTapResult({ exitCode: 1, output: tap() }).passed, false);
  assert.equal(evaluateWfmTapResult({ exitCode: 0, output: tap({ tests: 2, pass: 1, fail: 1 }) }).passed, false);
  assert.equal(evaluateWfmTapResult({ exitCode: null, output: tap(), processError: new Error("spawn failed") }).passed, false);
});
