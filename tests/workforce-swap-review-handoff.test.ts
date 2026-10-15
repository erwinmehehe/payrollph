import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  scheduleSwapDraftPreflight,
  swapDecisionReadiness,
  type ScheduleSwapReviewItem,
} from "../src/lib/workforce-swap-review-handoff";

const swap = (overrides: Partial<ScheduleSwapReviewItem> = {}): ScheduleSwapReviewItem => ({
  id: 41, organizationId: 9,
  requesterEmployeeId: 3, requesterWorkDate: "2026-10-15",
  counterpartyEmployeeId: 4, counterpartyWorkDate: "2026-10-16",
  requestedByUserId: 17, status: "pending", ...overrides,
});
const draft = (overrides: Record<string, unknown> = {}) => ({
  organizationId: 9, requesterEmployeeId: 3, counterpartyEmployeeId: 4,
  requesterWorkDate: "2026-10-15", counterpartyWorkDate: "2026-10-16",
  reason: "Coverage exchange", authorizedEmployeeIds: [3, 4, 5],
  pendingSnapshot: [] as ScheduleSwapReviewItem[] | null, ...overrides,
});

test("the requester cannot see a usable self-approval or rejection control", () => {
  const v = swapDecisionReadiness(swap(), 9, 17);
  assert.deepEqual([v.canDecide, v.code], [false, "same_requester"]);
  assert.match(v.detail, /different authorized workforce manager/);
  const other = swapDecisionReadiness(swap(), 9, 18);
  assert.equal(other.canDecide, true);
  assert.equal(other.code, "ready_for_server_check");
  assert.match(other.detail, /Server checks/);
});

test("legacy missing requester and invalid reviewer identity fail closed", () => {
  for (const requester of [null, 0, -5]) {
    const result = swapDecisionReadiness(swap({requestedByUserId: requester}), 9, 18);
    assert.equal(result.canDecide, false);
    assert.equal(result.code, "missing_requester");
  }
  for (const reviewer of [null, undefined, 0, -1, Number.NaN]) {
    const result = swapDecisionReadiness(swap(), 9, reviewer);
    assert.equal(result.canDecide, false);
    assert.equal(result.code, "reviewer_unknown");
  }
  assert.equal(swapDecisionReadiness(swap({organizationId: 10}), 9, 18).code, "out_of_scope");
  assert.equal(swapDecisionReadiness(swap({status: "approved"}), 9, 18).code, "finalized");
});

test("preflight recognizes either side of a pending assignment, including reversed roles", () => {
  for (const existing of [
    swap(),
    swap({requesterEmployeeId: 4, requesterWorkDate: "2026-10-16",
      counterpartyEmployeeId: 3, counterpartyWorkDate: "2026-10-15"}),
    swap({requesterEmployeeId: 5, requesterWorkDate: "2026-10-16",
      counterpartyEmployeeId: 3, counterpartyWorkDate: "2026-10-15"}),
    swap({requesterEmployeeId: 4, requesterWorkDate: "2026-10-16",
      counterpartyEmployeeId: 5, counterpartyWorkDate: "2026-10-17"}),
  ]) {
    const preflight = scheduleSwapDraftPreflight(draft({pendingSnapshot: [existing]}));
    assert.equal(preflight.canSubmit, false);
    assert.equal(preflight.state, "blocked");
    assert.equal(preflight.conflictRequestId, 41);
  }
});

test("other employer, completed and different-date swaps cannot produce false collisions", () => {
  const payload = [
    swap({organizationId: 10}),
    swap({status: "rejected"}),
    swap({requesterWorkDate: "2026-10-20", counterpartyWorkDate: "2026-10-21"}),
  ];
  const result = scheduleSwapDraftPreflight(draft({pendingSnapshot: payload}));
  assert.equal(result.state, "ready");
  assert.equal(result.canSubmit, true);
  assert.equal(result.conflictRequestId, null);
  assert.match(result.detail, /server independently validates/);
});

test("missing or stale pending list is unverified rather than proof of no conflicts", () => {
  const result = scheduleSwapDraftPreflight(draft({pendingSnapshot: null}));
  assert.equal(result.state, "unverified");
  assert.equal(result.canSubmit, true);
  assert.match(result.detail, /could not be checked locally/);
});

test("preflight rejects bad choices, forged roster IDs, dates and reasons", () => {
  const scenarios = [
    {requesterEmployeeId: 0},
    {requesterEmployeeId: 4},
    {counterpartyEmployeeId: 900},
    {requesterWorkDate: "2026-02-30"},
    {counterpartyWorkDate: "2026-13-03"},
    {counterpartyWorkDate: "not a date"},
    {reason: "  "},
    {reason: "x".repeat(241)},
    {organizationId: 0},
  ];
  for (const value of scenarios) {
    const result = scheduleSwapDraftPreflight(draft(value));
    assert.equal(result.canSubmit, false, JSON.stringify(value));
    assert.ok(result.state === "incomplete" || result.state === "blocked", JSON.stringify(value));
  }
});

test("swap manager UI uses source-only preflight and independent reviewer handoff without new endpoints", () => {
  const panel = readFileSync("src/components/workspace/workforce-schedule-swap-panel.tsx", "utf8");
  const route = readFileSync("src/app/api/workforce/schedule-swaps/route.ts", "utf8");
  const helper = readFileSync("src/lib/workforce-swap-review-handoff.ts", "utf8");
  assert.match(panel, /scheduleSwapDraftPreflight\(/);
  assert.match(panel, /swapDecisionReadiness\(/);
  assert.match(panel, /data\.user\?\.id/);
  assert.match(panel, /decisionNote/);
  assert.match(panel, /maxLength=\{240\}/);
  assert.match(panel, /const decisionScopeKey = JSON\.stringify\(\[scopeKey, reviewerUserId\]\)/);
  assert.match(panel, /currentDrafts\.scopeKey !== decisionScopeKey/);
  assert.match(panel, /scopeKey/);
  assert.match(panel, /data-swaps-review-readiness/);
  assert.match(panel, /server/i);
  assert.ok(route.includes("requestedByUserId === user.id"));
  assert.ok(route.includes("existing.requestedByUserId == null"));
  assert.ok(route.includes("const decisionNote = String(body.decisionNote"));
  for (const forbidden of ["fetch(", "db.insert(", "db.update(", "db.delete(", "process.env"]) {
    assert.ok(!helper.includes(forbidden), "Preflight helper cannot execute " + forbidden);
  }
});
