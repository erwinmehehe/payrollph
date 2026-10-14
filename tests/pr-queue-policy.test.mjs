import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePullQueue, formatQueueSummary, reportQueueOutcome } from "../scripts/pr-queue-policy.mjs";

const pr = (number, draft = true, date = "2026-10-" + String(number % 20 + 1).padStart(2, "0") + "T00:00:00Z") =>
  ({ number, draft, created_at: date });
const add = (filename) => ({ filename, status: "added" });
const files = (...prs) => Object.fromEntries(prs.map((x) => [x.number, []]));

test("review-ready status is reported without a numerical cap", () => {
  const list = [pr(681, false), pr(667, false), pr(668, false), pr(686, true)];
  const result = evaluatePullQueue(list, files(...list), 681);
  assert.equal(result.ready.length, 3);
  assert.deepEqual(result.failures, []);
  assert.equal(result.currentDraft, false);
});

test("four or more review-ready PRs do not block an unrelated safe PR", () => {
  const list = [pr(681, false), pr(667, false), pr(668, false), pr(686, false),
    pr(687, false), pr(688, false)];
  const result = evaluatePullQueue(list, files(...list), 686);
  assert.equal(result.ready.length, 6);
  assert.deepEqual(result.failures, []);
  list[3].draft = true;
  const stillSafe = evaluatePullQueue(list, files(...list), 686);
  assert.equal(stillSafe.ready.length, 5);
  assert.equal(stillSafe.currentDraft, true);
  assert.deepEqual(stillSafe.failures, []);
});

test("migration prefix collisions still block with more than three review-ready PRs", () => {
  const list = [
    pr(667, false, "2026-10-08T09:00:00Z"),
    pr(686, false, "2026-10-09T09:00:00Z"),
    pr(687, false), pr(688, false), pr(689, false),
  ];
  const by = files(...list);
  by[667] = [add("drizzle/0100_compensation_automation_intents.sql")];
  by[686] = [add("drizzle/0100_saas_selfserve_recurring_billing.sql")];
  const result = evaluatePullQueue(list, by, 686);
  assert.equal(result.ready.length, 5);
  assert.equal(result.currentCollisions.length, 1);
  assert.match(result.failures.join(" "), /Migration 0100 is already claimed by #667/);
  assert.equal(result.failures.length, 1);
});

test("later SQL 0100 claim is blocked by older canonical migration train", () => {
  const list = [pr(667, true, "2026-10-08T09:00:00Z"), pr(686, true, "2026-10-09T09:00:00Z")];
  const by = {
    667: [add("drizzle/0100_compensation_automation_intents.sql")],
    686: [add("drizzle/0100_saas_selfserve_recurring_billing.sql")],
  };
  const newer = evaluatePullQueue(list, by, 686);
  assert.equal(newer.currentCollisions.length, 1);
  assert.equal(newer.currentCollisions[0].reservedBy, 667);
  assert.match(newer.failures[0], /already claimed by #667/);
  const older = evaluatePullQueue(list, by, 667);
  assert.deepEqual(older.failures, []);
});

test("conflicting filename for same prefix in one PR is also blocked", () => {
  const list = [pr(686)];
  const result = evaluatePullQueue(list, {
    686: [add("drizzle/0106_billing.sql"), add("drizzle/0106_other.sql")],
  }, 686);
  assert.equal(result.currentCollisions.length, 1);
  assert.match(result.failures[0], /Migration 0106/);
});

test("migration rename into an occupied prefix counts as a competing claim", () => {
  const list = [pr(667, true, "2026-10-01T00:00:00Z"), pr(686, true, "2026-10-09T00:00:00Z")];
  const result = evaluatePullQueue(list, {
    667: [add("drizzle/0100_compensation.sql")],
    686: [{ status: "renamed", filename: "drizzle/0100_billing.sql" }],
  }, 686);
  assert.equal(result.currentCollisions.length, 1);
});

test("stacked incremental PRs with distinct SQL numbers do not collide", () => {
  const list = [pr(667), pr(673), pr(682)];
  const result = evaluatePullQueue(list, {
    667: [add("drizzle/0100_compensation.sql"), add("drizzle/0101_underpayment.sql")],
    673: [add("drizzle/0104_work_items.sql")],
    682: [add("drizzle/0105_ess.sql")],
  }, 682);
  assert.equal(result.collisions.length, 0);
  assert.deepEqual(result.failures, []);
});

test("modified (not newly claimed) migrations remain the SQL history guard's job", () => {
  const list = [pr(667), pr(686)];
  const result = evaluatePullQueue(list, {
    667: [add("drizzle/0100_compensation.sql")],
    686: [{ filename: "drizzle/0100_compensation.sql", status: "modified" }],
  }, 686);
  assert.deepEqual(result.failures, []);
});

test("missing PR and missing file evidence fail closed", () => {
  const list = [pr(667), pr(686)];
  assert.throws(() => evaluatePullQueue(list, { 667: [] }, 686), /Missing changed-file evidence/);
  assert.throws(() => evaluatePullQueue(list, files(...list), 999), /missing from the open PR list/);
});

test("summary reports review-ready count without implying merge approval", () => {
  const list = [pr(681, false), pr(667, false), pr(668, false)];
  const summary = formatQueueSummary(evaluatePullQueue(list, files(...list), 681), 681);
  assert.match(summary, /Review-ready PR count \(informational; no cap\): 3/);
  assert.match(summary, /Independent reviewer/);
  assert.match(summary, /This gate is read-only/);
});

test("queue diagnostics explain current PR failures in job stdout", () => {
  const list = [pr(862, true, "2026-10-12T02:19:06Z"), pr(865, true, "2026-10-12T02:52:30Z")];
  const by = {
    862: [add("drizzle/0115_workflow_frontend_requests.sql")],
    865: [add("drizzle/0115_inline_first_payroll_journey.sql")],
  };
  const result = evaluatePullQueue(list, by, 865);
  const output = [];
  assert.equal(reportQueueOutcome(result, 865, value => output.push(value)), true);
  assert.match(output.join(""), /PR under check: #865/);
  assert.match(output.join(""), /Migration 0115 is already claimed by #862/);
  assert.match(output.join(""), /Outcome: BLOCKED/);

  const passing = evaluatePullQueue(list, {862: [], 865: by[865]}, 865);
  const passingOutput = [];
  assert.equal(reportQueueOutcome(passing, 865, value => passingOutput.push(value)), false);
  assert.match(passingOutput.join(""), /Outcome: PASS/);
});
