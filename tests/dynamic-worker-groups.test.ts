import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dynamicGroupClauseMatches,
  normalizeDynamicGroupCode,
  validDynamicWorkerGroupConditions,
  workerMatchesDynamicGroup,
} from "../src/lib/dynamic-worker-group-conditions";

test("dynamic groups match ALL worker attributes including verified skill arrays", () => {
  const context = {
    department: "Customer Support",
    location: "NCR",
    salary: 42_000,
    verifiedSkillCodes: ["zendesk", "night-support"],
    validCredentialCodes: ["data-privacy"],
  };
  const conditions = {
    version: 1 as const,
    all: [
      { field: "department", operator: "eq" as const, value: "Customer Support" },
      { field: "salary", operator: "gte" as const, value: 40_000 },
      { field: "verifiedSkillCodes", operator: "contains" as const, value: "night-support" },
    ],
    any: [],
  };

  assert.equal(validDynamicWorkerGroupConditions(conditions), true);
  assert.equal(workerMatchesDynamicGroup(conditions, context), true);
});

test("dynamic groups support ANY membership and array overlap", () => {
  const context = {
    location: "Central Luzon",
    validCredentialCodes: ["bls", "rn-license"],
  };
  const conditions = {
    version: 1 as const,
    all: [],
    any: [
      { field: "location", operator: "eq" as const, value: "NCR" },
      { field: "validCredentialCodes", operator: "in" as const, value: ["rn-license", "first-aid"] },
    ],
  };

  assert.equal(workerMatchesDynamicGroup(conditions, context), true);
  assert.equal(dynamicGroupClauseMatches(
    { field: "validCredentialCodes", operator: "in", value: ["rn-license"] },
    context,
  ), true);
  assert.equal(dynamicGroupClauseMatches(
    { field: "validCredentialCodes", operator: "eq", value: "rn-license" },
    context,
  ), true);
});

test("dynamic group definitions reject unknown fields and empty populations", () => {
  assert.equal(validDynamicWorkerGroupConditions({ version: 1, all: [], any: [] }), false);
  assert.equal(validDynamicWorkerGroupConditions({
    version: 1,
    all: [{ field: "bankAccount", operator: "exists" }],
    any: [],
  }), false);
});

test("dynamic group codes normalize to stable slugs", () => {
  assert.equal(normalizeDynamicGroupCode(" Night Shift / Support "), "night-shift-support");
});

test("dynamic groups are versioned, governed and snapshotted into automation context", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0082_dynamic_worker_groups.sql", "utf8");
  const api = readFileSync("src/app/api/dynamic-worker-groups/route.ts", "utf8");
  const automation = readFileSync("src/lib/automation.ts", "utf8");
  const panel = readFileSync("src/components/dynamic-worker-groups-panel.tsx", "utf8");
  const studio = readFileSync("src/components/automation-studio-panel.tsx", "utf8");

  assert.ok(schema.includes("export const dynamicWorkerGroups"));
  assert.ok(schema.includes('version: integer("version")'));
  assert.ok(migration.includes('"dynamic_worker_groups"'));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("Dynamic worker group updated"));
  assert.ok(api.includes("previewDynamicWorkerGroup"));
  assert.ok(api.includes("Disable dependent Automation Studio workflows"));
  assert.ok(api.includes("activeAutomationDependencyCount"));
  assert.ok(automation.includes("dynamicGroupMemberships: memberships"));
  assert.ok(automation.includes('value: "dynamicGroupCodes"'));
  assert.ok(panel.includes("DYNAMIC GROUPS · SUPERGROUPS"));
  assert.ok(panel.includes("LIVE MEMBERSHIP"));
  assert.ok(studio.includes("<DynamicWorkerGroupsPanel"));
  assert.ok(studio.includes("Select a live group"));
});
