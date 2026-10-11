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
  const writeAt = patch.indexOf("tx.update(provisioningTasks)");
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

test("offboarding checklist cannot bypass IT app revocation or asset recovery", () => {
  const route = readFileSync("src/app/api/provisioning/route.ts", "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH("));
  const itGuard = patch.indexOf('if (done && target.kind === "offboarding")');
  const write = patch.indexOf("db.update(provisioningTasks)");
  assert.ok(itGuard > 0 && itGuard < write, "IT evidence must be checked before task completion");
  for (const expected of [
    'target.title.startsWith("Revoke email")',
    "itAccessGrants.organizationId, target.organizationId",
    "itAccessGrants.employeeId, target.employeeId",
    'grant.state !== "revoked"',
    'target.title.startsWith("Recover laptop")',
    "itManagedDevices.organizationId, target.organizationId",
    "itManagedDevices.employeeId, target.employeeId",
    "assets.organizationId, target.organizationId",
    "assets.employeeId, target.employeeId",
    "Assigned company equipment is outstanding",
    "App access is not fully revoked",
  ]) {
    assert.ok(patch.includes(expected), "Missing original offboarding safety gate: " + expected);
  }
});

test("task updates lock employee scope and recheck it before writing", () => {
  const source = readFileSync("src/app/api/provisioning/route.ts", "utf8");
  const patch = source.slice(source.indexOf("export async function PATCH("));
  const precheck = patch.indexOf("assertScope(access, employee.orgUnitId)");
  const begin = patch.indexOf("const result = await db.transaction(async (tx) => {");
  const lock = patch.indexOf("for share");
  const lockedEmployee = patch.indexOf("const [freshEmployee] = await tx.select(");
  const rescope = patch.indexOf("assertScope(access, freshEmployee.orgUnitId)");
  const write = patch.indexOf("tx.update(provisioningTasks)");
  assert.ok(precheck >= 0 && begin > precheck && lock > begin &&
    lockedEmployee > lock && rescope > lockedEmployee && write > rescope);
  assert.ok(patch.includes("where id = ${employeeId} and organization_id = ${organizationId} for share"));
  assert.ok(patch.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(patch.includes("code: \"PROVISIONING_WORKER_UNIT_CHANGED\""));
  assert.ok(patch.includes("status: 409"));
  assert.ok(patch.includes("recordAuditEvent({"));
});

test("provisioning callers using PATCH must send tenant and employee context", () => {
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
  assert.ok(callers.length > 0, "A checklist client should use provisioning");
  let mutationCallers = 0;
  for (const caller of callers) {
    // Read-only callers may query the endpoint without a PATCH body.
    // Fail closed on an unreviewed mutation in a source file.
    if (caller.content.includes('method: "PATCH"') || caller.content.includes("method: 'PATCH'")) {
      mutationCallers++;
      assert.ok(caller.content.includes(
        'JSON.stringify({ id: task.id, organizationId, employeeId, done })',
      ), "Review the new scoped PATCH contract for " + caller.path);
    }
  }
  assert.ok(mutationCallers >= 1, "No scoped provisioning PATCH caller located");
});
