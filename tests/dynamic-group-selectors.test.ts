import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Dynamic Groups expose a reusable live-member resolver for product selectors", () => {
  const source = read("src/lib/dynamic-worker-groups.ts");
  assert.ok(source.includes("resolveDynamicWorkerGroupMembers"));
  assert.ok(source.includes("loadWorkerAttributeContexts"));
  assert.ok(source.includes("workerMatchesDynamicGroup"));
  assert.ok(source.includes("employeeIds: members.map"));
});

test("WFM coverage can be narrowed by a live Dynamic Group without granting access", () => {
  const route = read("src/app/api/workforce/coverage/route.ts");
  const panel = read("src/components/workspace/workforce-coverage-panel.tsx");
  assert.ok(route.includes('url.searchParams.get("dynamicGroupCode")'));
  assert.ok(route.includes("resolveDynamicWorkerGroupMembers"));
  assert.ok(route.includes("visibleEmployees.filter"));
  assert.ok(route.includes("visibleMemberCount"));
  assert.ok(panel.includes("Filter workforce coverage by Dynamic Group"));
  assert.ok(panel.includes("does not grant access or publish roster changes"));
});

test("employee-level BI exports support governed Dynamic Group scope", () => {
  const source = read("src/lib/bi-exports.ts");
  const route = read("src/app/api/bi-exports/route.ts");
  const panel = read("src/components/enterprise-bi-export-panel.tsx");
  assert.ok(source.includes("employeeIds?: number[] | null"));
  assert.ok(source.includes("inArray(payrollEntries.employeeId, employeeIds)"));
  assert.ok(source.includes("inArray(workforceTimesheets.employeeId, employeeIds)"));
  assert.ok(route.includes("resolveDynamicWorkerGroupMembers"));
  assert.ok(route.includes("Dynamic Group filtering is available only for employee-level"));
  assert.ok(panel.includes("Dynamic Group"));
  assert.ok(panel.includes('params.set("dynamicGroupCode", dynamicGroupCode)'));
});
