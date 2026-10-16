import assert from "node:assert/strict";
import test from "node:test";
import { aggregateNavSweep } from "../scripts/nav-sweep-run-all-roles.mjs";

const manifest = { roles: [
  { role: "hr", pages: ["People", "Leave"] },
  { role: "employee", pages: ["employee-home"] },
] };

function roleResult(spec) {
  const results = [1280, 390].flatMap(viewport =>
    spec.pages.map(page => ({
      role: spec.role, viewport, page, result: "PASS", elapsedMs: 12,
      findings: [], screenshot: null, skippedControls: 0, skippedExamples: [],
    })));
  return { role: spec.role, exitStatus: 0, signal: null, error: null,
    report: { syntheticOnly: true, productionDataUsed: false,
      injectedFailure: false, results, total: results.length,
      passed: results.length, failed: 0 } };
}

const clean = () => manifest.roles.map(roleResult);
const tally = outcomes => aggregateNavSweep(manifest, outcomes);

test("full two-role, two-viewport route inventory is green only when all observed", () => {
  const report = tally(clean());
  assert.equal(report.expectedSlots, 6);
  assert.equal(report.total, 6);
  assert.equal(report.passed, 6);
  assert.equal(report.failed, 0);
  assert.ok(report.results.every(row => row.result === "PASS"));
});

test("missing last fictional role is a failure, never an incomplete green", () => {
  const report = tally([clean()[0]]);
  assert.equal(report.expectedSlots, 6);
  assert.equal(report.passed, 4);
  assert.ok(report.failed >= 2);
  assert.ok(report.results.some(x => x.role === "employee" &&
    x.page === "employee-home" && x.viewport === 390 && x.result === "FAIL"));
});

test("one omitted viewport is a coverage failure", () => {
  const entries = clean();
  entries[1].report.results.pop();
  entries[1].report.total--;
  entries[1].report.passed--;
  const report = tally(entries);
  assert.ok(report.failed > 0);
  assert.ok(report.results.some(x => x.role === "employee" &&
    x.viewport === 390 && x.result === "FAIL"));
});

test("a dead Chromium subprocess fails even if its report claims every page passed", () => {
  const entries = clean();
  entries[1].exitStatus = null;
  entries[1].signal = "SIGKILL";
  assert.ok(tally(entries).results.some(x => x.page === "SWEEP_INFRASTRUCTURE"));
});

test("duplicate route results and extra roles cannot inflate success", () => {
  const entries = clean();
  entries[0].report.results.push(entries[0].report.results[0]);
  entries[0].report.total++;
  entries[0].report.passed++;
  entries.push({ role: "other", exitStatus: 0, report: entries[0].report });
  const report = tally(entries);
  assert.equal(report.expectedSlots, 6);
  assert.ok(report.failed >= 2);
});

test("malformed or injected-negative-test payload is rejected", () => {
  const entries = clean();
  entries[0].report.injectedFailure = true;
  entries[1].report.syntheticOnly = false;
  const report = tally(entries);
  assert.ok(report.failed >= 2);
});

test("real browser finding stays red and is not hidden by role sharding", () => {
  const entries = clean();
  entries[0].report.results[0].result = "FAIL";
  entries[0].report.results[0].findings = [
    { kind: "navigation", detail: "HTTP 500 GET /app" },
  ];
  entries[0].report.passed--;
  entries[0].report.failed++;
  const report = tally(entries);
  assert.ok(report.results.some(x => x.page === "People" &&
    x.result === "FAIL" && x.findings[0].detail.includes("500")));
  assert.ok(report.failed > 0);
});
