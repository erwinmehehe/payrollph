import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePullQueue, formatQueueSummary } from "../scripts/pr-queue-policy.mjs";

const pr = (number, draft = true, date = "2026-10-" + String(number % 20 + 1).padStart(2, "0") + "T00:00:00Z") =>
  ({ number, draft, created_at: date });
const add = (filename) => ({ filename, status: "added" });
const files = (...prs) => Object.fromEntries(prs.map((x) => [x.number, []]));

test("up to three review-ready PRs can proceed through the review queue", () => {
  const list = [pr(681, false), pr(667, false), pr(668, false), pr(686, true)];
  const result = evaluatePullQueue(list, files(...list), 681);
  assert.equal(result.ready.length, 3);
  assert.deepEqual(result.failures, []);
  assert.equal(result.currentDraft, false);
});

test("a fourth ready PR is blocked, but draft staging remains available", () => {
  const list = [pr(681, false), pr(667, false), pr(668, false), pr(686, false)];
  const result = evaluatePullQueue(list, files(...list), 686);
  assert.equal(result.ready.length, 4);
  assert.match(result.failures.join(" "), /exceeds 3 PRs/);
  list[3].draft = true;
  assert.deepEqual(evaluatePullQueue(list, files(...list), 686).failures, []);
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

test("summary records review-ready pressure without implying merge approval", () => {
  const list = [pr(681, false), pr(667, false), pr(668, false)];
  const summary = formatQueueSummary(evaluatePullQueue(list, files(...list), 681), 681);
  assert.match(summary, /Review-ready: 3 \/ 3/);
  assert.match(summary, /Independent reviewer/);
  assert.match(summary, /This gate is read-only/);
});
