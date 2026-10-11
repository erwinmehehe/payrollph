import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseScopedProvisioningMutation } from "../src/lib/scoped-provisioning-mutation";

const valid = { id: 77, organizationId: 5, employeeId: 81, done: false };

test("provisioning accepts only explicit numeric employer, employee, task and boolean state", () => {
  assert.deepEqual(parseScopedProvisioningMutation(valid), valid);
  assert.deepEqual(parseScopedProvisioningMutation({ ...valid, done: true }),
    { ...valid, done: true });
  for (const bad of [
    null, undefined, "", 5, [], {}, { id: 77, done: true },
    { ...valid, id: null }, { ...valid, id: "77" }, { ...valid, id: -2 },
    { ...valid, id: 0 }, { ...valid, id: 1.2 },
    { ...valid, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, organizationId: null }, { ...valid, organizationId: "5" },
    { ...valid, organizationId: 0 }, { ...valid, organizationId: Number.NaN },
    { ...valid, employeeId: null }, { ...valid, employeeId: "81" },
    { ...valid, employeeId: 0 }, { ...valid, employeeId: Number.POSITIVE_INFINITY },
    { ...valid, done: "false" }, { ...valid, done: "true" },
    { ...valid, done: 0 }, { ...valid, done: 1 }, { ...valid, done: null },
  ]) {
    assert.equal(parseScopedProvisioningMutation(bad), null,
      "Malformed writes must fail before tenant authorization: " + JSON.stringify(bad));
  }
});

test("provisioning PATCH checks employer and worker in selection, worker read, and update", () => {
  const route = readFileSync("src/app/api/provisioning/route.ts", "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH("));
  assert.ok(patch.includes("enforceSameOriginMutation(request)"));
  assert.ok(patch.includes("parseScopedProvisioningMutation(body)"));
  const parseAt = patch.indexOf("const mutation = parseScopedProvisioningMutation(body)");
  const lookupAt = patch.indexOf("const [target] = await db.select(");
  const deniedAt = patch.indexOf("assertOrganizationRole(");
  const writeAt = patch.indexOf("db.update(provisioningTasks)");
  assert.ok(parseAt >= 0 && lookupAt > parseAt && deniedAt > lookupAt && writeAt > deniedAt);
  const taskLookup = patch.slice(lookupAt, deniedAt);
  for (const condition of [
    "eq(provisioningTasks.id, id)",
    "eq(provisioningTasks.organizationId, organizationId)",
    "eq(provisioningTasks.employeeId, employeeId)",
  ]) {
    assert.ok(taskLookup.includes(condition), "task lookup missing: " + condition);
    assert.ok(patch.slice(writeAt).includes(condition), "task write missing: " + condition);
  }
  assert.ok(patch.includes("eq(employees.id, target.employeeId)"));
  assert.ok(patch.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(patch.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(patch.includes("recordAuditEvent({"));
  assert.ok(patch.includes("organizationId: row.organizationId"));
});

test("checklist submits the selected employer and employee before mutation", () => {
  const board = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  assert.ok(board.includes('body: JSON.stringify({ id: task.id, organizationId, employeeId, done })'));
  assert.ok(board.includes("payload.organizationId !== organizationId"));
  assert.ok(board.includes("payload.employeeId !== employeeId"));
  assert.ok(board.includes("payload.kind !== \"onboarding\""));
  assert.ok(board.includes("setSnapshotStale(true)"));
  assert.ok(board.includes("mutationInFlight.current"));
  assert.ok(board.includes("await onRefresh()"));
});

test("all source call sites send explicitly bound employer and employee IDs", () => {
  // Search the checked-out application source (not a hand-maintained list).
  // If another client calls this endpoint, this test must force a contract
  // review before a rollout can silently break that client.
  const callers: Array<{ path: string; content: string }> = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (entry.isFile() && [".ts", ".tsx", ".js", ".jsx"].some((ext) => entry.name.endsWith(ext))) {
        const content = readFileSync(path, "utf8");
        if (content.includes("/api/provisioning") && content.includes("fetch(")) {
          callers.push({ path, content });
        }
      }
    }
  }
  scan("src");
  assert.ok(callers.length > 0, "At least one onboarding client should use provisioning");
  for (const caller of callers) {
    const matches = caller.content.match(/fetch\(\s*["'\x60]\/api\/provisioning/g) ?? [];
    for (const match of matches) {
      assert.ok(caller.content.includes(
        'JSON.stringify({ id: task.id, organizationId, employeeId, done })',
      ), "Review the new employer/worker mutation contract for " + caller.path + ": " + match);
    }
  }
});
