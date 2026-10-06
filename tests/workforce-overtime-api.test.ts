import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");

test("overtime mutations use the standard sensitive-action security gates", () => {
  assert.ok(source.includes("enforceSameOriginMutation(request)"));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
  assert.ok(source.includes("enforceSensitiveActionRateLimit(request"));
});

test("overtime API enforces tenant and organization-unit scope", () => {
  assert.ok(source.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(source.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(source.includes("eq(overtimeRequests.organizationId, organizationId)"));
});

test("overtime decisions enforce four-eyes control", () => {
  assert.ok(source.includes("cannot be self-approved"));
  assert.ok(source.includes("OT_DECIDER_ROLES"));
  assert.ok(source.includes("requestedByUserId: user.id"));
  assert.ok(source.includes("requestedByUserId == null"));
  assert.ok(source.includes("predates stable requester identity tracking"));
  assert.ok(source.includes("requestedByUserId === input.userId"));
  assert.ok(source.includes("decidedByUserId: user.id"));
  assert.ok(source.includes("loadDecisionCandidates"));
  assert.ok(!source.includes("existing.requestedBy === user.name"));
});

test("overtime request kinds support pre-approval and emergency post-approval", () => {
  assert.ok(source.includes('"pre_approved"'));
  assert.ok(source.includes('"emergency_post_approval"'));
});

test("overtime request minutes are bounded and decisions are limited to approved or rejected", () => {
  assert.ok(source.includes("requestedMinutes > 1_440"));
  assert.ok(source.includes('["approved", "rejected"].includes(decision)'));
});
