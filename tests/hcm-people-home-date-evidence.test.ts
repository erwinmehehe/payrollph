import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hcmHomeSourceTimestamp, projectHcmDecisions, projectOperationalCases, projectPeopleFollowUps } from "../src/lib/hcm-people-home-projection";

const decision = { id: 1, processType: "hire", stepType: "review" as const, makerBlocked: true };
const followUp = { id: "separation:1", employeeId: 2, category: "separation" as const, priority: "review" as const, page: "Separation" as const };

test("date-only, unzoned and impossible source values never become SLA deadlines", () => {
  for (const dueAt of [
    "2026-10-10", "2026-10-10T09:00:00", "2026-02-29T09:00:00Z",
    "2026-02-31T09:00:00+08:00", "2026-10-10T24:00:00Z",
    "2026-10-10T09:60:00Z", "2026-10-10T09:00:60Z", "10/10/2026", "",
  ]) {
    const items = [projectHcmDecisions(11, [{ ...decision, dueAt }])[0],
      projectOperationalCases(11, [{ id: 2, status: "open", dueAt }])[0]];
    for (const item of items) {
      assert.equal(item.dueAt, null, "reject ambiguous or impossible deadline " + dueAt);
      assert.equal(item.incompleteEvidence, true);
    }
  }
});

test("missing timestamps remain unknown without changing maker-checker state", () => {
  const item = projectHcmDecisions(11, [{ ...decision, dueAt: null }])[0];
  assert.equal(item.incompleteEvidence, true);
  assert.equal(item.status, "blocked_self_review");
  assert.equal(item.dueAt, null);
  assert.equal(projectOperationalCases(11, [{ id: 1, status: "acknowledged", dueAt: null }])[0].incompleteEvidence, true);
});

test("invalid milestones are not normalized into another payroll or employment date", () => {
  for (const dueDate of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-10-10T00:00:00Z", null]) {
    const item = projectPeopleFollowUps(11, [{ ...followUp, dueDate }])[0];
    assert.equal(item.sourceDate, null);
    assert.equal(item.dueAt, null);
    assert.equal(item.incompleteEvidence, true);
  }
});

test("valid leap dates remain date-only and zoned timestamps preserve their source", () => {
  for (const dueAt of ["2024-02-29T09:00:00Z", "2026-10-10T00:30:00+08:00", "2026-10-10T23:30:00-05:00", "2026-10-10T09:00:00.123Z"]) {
    const item = projectHcmDecisions(11, [{ ...decision, dueAt }])[0];
    assert.equal(item.dueAt, dueAt);
    assert.equal(item.incompleteEvidence, false);
    assert.equal(item.sourceDate, null);
  }
  const item = projectPeopleFollowUps(11, [{ ...followUp, dueDate: "2024-02-29" }])[0];
  assert.equal(item.sourceDate, "2024-02-29");
  assert.equal(item.dueAt, null);
  assert.equal(item.incompleteEvidence, false);
});


test("database Date values are accepted but missing and invalid instants stay unknown", () => {
  assert.equal(hcmHomeSourceTimestamp(new Date("2026-10-10T00:30:00+08:00")), "2026-10-09T16:30:00.000Z");
  assert.equal(hcmHomeSourceTimestamp(new Date(NaN)), null);
  assert.equal(hcmHomeSourceTimestamp(null), null);
  assert.equal(hcmHomeSourceTimestamp("2026-02-31T09:00:00Z"), null);
  assert.equal(hcmHomeSourceTimestamp("2026-10-10"), null);
});

test("server cannot normalize malformed source timestamps before the shared guard", () => {
  const source = readFileSync("src/lib/hcm-people-home-server.ts", "utf8");
  const start = source.indexOf("function sourceTimestamp(");
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start);
  const adapter = source.slice(start, end);
  assert.match(adapter, /return hcmHomeSourceTimestamp\(value\)/);
  assert.doesNotMatch(adapter, /new Date|Date\.parse/);
});
