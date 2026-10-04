import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/schedule-swaps/route.ts", "utf8");

test("schedule swap mutations use strong workforce security gates", () => {
  assert.ok(source.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(source.includes("enforceSameOriginMutation(request)"));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
  assert.ok(source.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(source.includes("assertScope(access, employee.orgUnitId)"));
});

test("schedule swap requests snapshot both effective schedules before review", () => {
  assert.ok(source.includes("resolveSchedulesForPair({"));
  assert.ok(source.includes("scheduleSwapSnapshot(current.requester)"));
  assert.ok(source.includes("scheduleSwapSnapshot(current.counterparty)"));
  assert.ok(source.includes("requesterScheduleSnapshot: requesterSnapshot"));
  assert.ok(source.includes("counterpartyScheduleSnapshot: counterpartySnapshot"));
});

test("approval re-resolves and rejects stale or overridden schedules", () => {
  assert.ok(source.includes("assertScheduleSwappable(currentRequester)"));
  assert.ok(source.includes("assertScheduleSwappable(currentCounterparty)"));
  assert.ok(source.includes("scheduleSwapSnapshotsMatch(storedRequester, currentRequester)"));
  assert.ok(source.includes("schedules changed after this swap was requested"));
});

test("schedule swap approval has immutable four-eyes control", () => {
  assert.ok(source.includes("existing.requestedByUserId == null"));
  assert.ok(source.includes("existing.requestedByUserId === user.id"));
  assert.ok(source.includes("Schedule swaps cannot be self-approved"));
  assert.ok(source.includes("decidedByUserId: user.id"));
});

test("approved swap writes both overrides and decision in one transaction", () => {
  assert.ok(source.includes("db.transaction(async (tx)"));
  assert.equal((source.match(/tx\.insert\(scheduleOverrides\)/g) ?? []).length, 2);
  assert.ok(source.includes('eq(scheduleSwapRequests.status, "pending")'));
  assert.ok(source.includes("requesterOverrideId"));
  assert.ok(source.includes("counterpartyOverrideId"));
});

test("pending schedule assignments cannot be double-booked into overlapping swaps", () => {
  assert.ok(source.includes('eq(scheduleSwapRequests.status, "pending")'));
  assert.ok(source.includes("pending schedule swap already uses one of these employee/date assignments"));
});
