import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/schedules/route.ts", "utf8");

test("workforce schedule mutations use the standard security gates", () => {
  assert.ok(source.includes("enforceSameOriginMutation(request)"));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
  assert.ok(source.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(source.includes("PEOPLE_ADMIN_ROLES"));
});

test("workforce schedule API enforces employee scope and tenant-owned work locations", () => {
  assert.ok(source.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(source.includes("eq(orgUnits.organizationId, organizationId)"));
  assert.ok(source.includes("Work location does not belong to this organization."));
  assert.ok(source.includes("Scoped People administrators cannot assign work outside their organization unit."));
  assert.ok(source.includes("Scoped People administrators cannot override work outside their organization unit."));
});

test("reusable shift and pattern definitions require company-wide access", () => {
  assert.ok(source.includes("Organization-wide shift definitions require company-wide People access."));
  assert.ok(source.includes("Organization-wide schedule patterns require company-wide People access."));
});

test("schedule preview resolves through the deterministic workforce resolver", () => {
  assert.ok(source.includes("resolveDailySchedule({"));
  assert.ok(source.includes("employeeId and date (YYYY-MM-DD) are both required for schedule preview."));
});
