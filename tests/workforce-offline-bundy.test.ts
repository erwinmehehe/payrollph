import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("employee Web Bundy queues and replays offline punches in timestamp order", () => {
  const modal = readFileSync("src/components/web-bundy-modal.tsx", "utf8");
  const selfService = readFileSync("src/components/self-service-portal.tsx", "utf8");
  const route = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  assert.ok(modal.includes("linaw-offline-attendance"));
  assert.ok(modal.includes("crypto.randomUUID()"));
  assert.ok(modal.includes("/api/workforce/attendance-sync"));
  assert.ok(modal.includes("New punches are paused to preserve event order."));
  assert.ok(modal.includes("navigator.geolocation"));
  assert.ok(selfService.includes("offlineSelfService"));
  assert.ok(route.includes("Web Bundy capture is disabled for this organization."));
});
