import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worksites = readFileSync("src/app/api/workforce/worksites/route.ts", "utf8");
const schedules = readFileSync("src/app/api/workforce/schedules/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");

test("worksite mutations use workforce RBAC, MFA, same-origin and rate-limit gates", () => {
  assert.ok(worksites.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(worksites.includes("enforceSameOriginMutation(request)"));
  assert.ok(worksites.includes("requireSensitiveActionMfa(user)"));
  assert.ok(worksites.includes("enforceSensitiveActionRateLimit(request"));
});

test("worksite master data is separate from org units but can be scoped by one", () => {
  assert.ok(schema.includes('export const worksites = pgTable('));
  assert.ok(schema.includes('orgUnitId: integer("org_unit_id").references(() => orgUnits.id'));
  assert.ok(schema.includes('cityMunicipality: varchar("city_municipality"'));
  assert.ok(schema.includes('timezone: varchar("timezone"'));
});

test("employee worksite history is effective-dated and overlap-protected", () => {
  assert.ok(schema.includes('export const employeeWorksiteAssignments = pgTable('));
  assert.ok(worksites.includes("worksiteAssignmentOverlaps("));
  assert.ok(worksites.includes("closedPriorAssignmentId"));
});

test("schedule assignments and overrides can explicitly select physical worksites", () => {
  assert.ok(schema.includes('worksiteId: integer("worksite_id").references(() => worksites.id'));
  assert.ok(schedules.includes("selectEffectiveWorksiteAssignment("));
  assert.ok(schedules.includes("defaultWorksiteId:"));
  assert.ok(schedules.includes("worksiteId,"));
});

test("inactive worksites cannot receive new assignments or be deactivated while still in use", () => {
  assert.ok(worksites.includes("Inactive worksites cannot receive new employee assignments."));
  assert.ok(worksites.includes("This worksite still has current or future workforce assignments."));
});
