import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("src/components/workspace/workforce-schedule-swap-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("workforce planner exposes schedule swap workflow", () => {
  assert.ok(planner.includes("WorkforceScheduleSwapPanel"));
  assert.ok(panel.includes("/api/workforce/schedule-swaps"));
});

test("schedule swap UI creates two-employee date-pair requests", () => {
  assert.ok(panel.includes("requesterEmployeeId"));
  assert.ok(panel.includes("counterpartyEmployeeId"));
  assert.ok(panel.includes("requesterWorkDate"));
  assert.ok(panel.includes("counterpartyWorkDate"));
  assert.ok(panel.includes('"create_request"'));
});

test("schedule swap UI exposes approve and reject decisions", () => {
  assert.ok(panel.includes('"decide_request"'));
  assert.ok(panel.includes('decide(swap.id, "approved")'));
  assert.ok(panel.includes('decide(swap.id, "rejected")'));
});

test("schedule swap UI preserves fail-closed approval messaging", () => {
  assert.ok(panel.includes("Approval revalidates both schedules"));
  assert.ok(panel.includes("approval fails instead of guessing"));
  assert.ok(panel.includes("requester cannot self-approve"));
});
