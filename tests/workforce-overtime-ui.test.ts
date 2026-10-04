import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("src/components/workspace/workforce-overtime-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("workforce planner exposes the overtime authorization workflow", () => {
  assert.ok(planner.includes("WorkforceOvertimePanel"));
  assert.ok(panel.includes("/api/workforce/overtime"));
});

test("OT UI supports pre-approval and emergency post-approval", () => {
  assert.ok(panel.includes('value="pre_approved"'));
  assert.ok(panel.includes('value="emergency_post_approval"'));
  assert.ok(panel.includes('"create_request"'));
});

test("OT UI exposes independent approve and reject actions", () => {
  assert.ok(panel.includes('"decide_request"'));
  assert.ok(panel.includes('decide(request.id, "approved")'));
  assert.ok(panel.includes('decide(request.id, "rejected")'));
});

test("OT UI preserves the wage entitlement safety message", () => {
  assert.ok(panel.includes("Authorization and entitlement stay separate"));
  assert.ok(panel.includes("validated legally payable overtime is still calculated"));
  assert.ok(panel.includes("requester cannot self-approve"));
});
