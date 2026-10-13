import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scheduler admin heartbeat route is session and membership restricted", () => {
  const route = readFileSync("src/app/api/jobs/admin-status/route.ts", "utf8");
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /assertMembership\(user\.id, organizationId\)/);
  assert.match(route, /getAccess\(user\.id, organizationId\)/);
  assert.match(route, /access\?\.companyWide/);
  assert.match(route, /\["owner", "admin"\]\.includes\(access\.role\)/);
  assert.match(route, /evaluateSchedulerLiveness/);
  assert.match(route, /lastRanMinutesAgo/);
  assert.doesNotMatch(route, /tickScheduler\(/);
  assert.doesNotMatch(route, /ownerToken/);
});

test("banner only appears for owner/admin, company-wide Overview and updates with workspace context", () => {
  const shell = readFileSync("src/components/workspace/shell.tsx", "utf8");
  assert.match(shell, /data\.access\?\.companyWide/);
  assert.match(shell, /\["owner", "admin"\]\.includes\(data\.access\.role\)/);
  assert.match(shell, /page === "Overview"/);
  assert.match(shell, /SchedulerAdminBanner organizationId=\{data\.selectedOrganization\.id\}/);
  const banner = readFileSync("src/components/workspace/scheduler-admin-banner.tsx", "utf8");
  assert.match(banner, /Scheduler last ran /);
  assert.match(banner, /AbortController/);
  assert.match(banner, /clearInterval/);
  // Disabled-by-design is ordinary informational state; only unexpected
  // scheduler failures must announce themselves to screen readers as alerts.
  assert.match(banner, /const disabled = health\.state === "scheduler-disabled"/);
  assert.match(banner, /const alert = !health\.ok && !disabled/);
  assert.match(banner, /role=\{alert \? "alert" : "status"\}/);
  assert.match(banner, /Scheduler is disabled \(development mode\)/);
});
