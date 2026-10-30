import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// WRK-02 source-only defense-in-depth. Not a substitute for disposable
// PostgreSQL 16 signed-in own/victim HTTP proof or method-level coverage.
const FILES = {
  scenarios: "src/app/api/workforce-planning/scenarios/route.ts",
  executions: "src/app/api/workforce-planning/position-executions/route.ts",
  transfer: "src/app/api/workforce-planning/transfer/route.ts",
};
const source = Object.fromEntries(Object.entries(FILES)
  .map(([key, file]) => [key, readFileSync(file, "utf8")]));

function region(code, start, end) {
  const a = code.indexOf(start);
  const b = code.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Cannot isolate source region: " + start);
  return code.slice(a, b);
}

function hasGuards(code, required) {
  for (const guard of required) {
    assert.ok(code.includes(guard), "Final tenant/state write is missing: " + guard);
  }
}

function gitBlob(input) {
  const bytes = Buffer.from(input, "utf8");
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}

test("previously credited GET source prefixes are byte-for-byte preserved", () => {
  for (const [name, expected] of [
    ["scenarios", "90ab7ddfb9cbceb32101b687cc9ecdc64581c8e9"],
    ["executions", "e18416e827678a1e62a1e891201df027ba20c48e"],
  ]) {
    const beforePost = source[name].split("export async function POST(request: Request) {")[0];
    assert.equal(gitBlob(beforePost), expected, name + " GET/import/helper code changed");
  }
});

test("scenario submission revalidates tenant, unit scope, plan and hash under lock", () => {
  const code = source.scenarios;
  const fresh = region(code, "await tx.execute(sql`select id from workforce_planning_scenarios", "const [existing] = await tx.select().from(approvalChainInstances)");
  hasGuards(fresh, [
    "organization_id = ${scenario.organizationId} for update",
    "eq(workforcePlanningScenarios.organizationId, scenario.organizationId)",
    "!scenarioVisibleToAccess(fresh, access)",
    "fresh.planId !== scenario.planId",
    "fresh.scopeOrgUnitId !== scenario.scopeOrgUnitId",
    "fresh.worksiteId !== scenario.worksiteId",
    "fresh.snapshotHash !== scenario.snapshotHash",
    "SCENARIO_SUBMISSION_CONFLICT",
  ]);
  const submit = region(code, "const [updated] = await tx.update(workforcePlanningScenarios)", "return { scenario: updated, instance, task, step };");
  hasGuards(submit, [
    "eq(workforcePlanningScenarios.organizationId, scenario.organizationId)",
    "eq(workforcePlanningScenarios.status, \"draft\")",
    "eq(workforcePlans.organizationId, scenario.organizationId)",
    "eq(workforcePlans.status, linkedPlan.status)",
    "if (!linkedPlan) throw new Error(\"SCENARIO_SUBMISSION_CONFLICT\")",
    "if (!updatedPlan) throw new Error(\"SCENARIO_SUBMISSION_CONFLICT\")",
  ]);
  assert.ok(code.indexOf("if (!fresh || fresh.status") < code.indexOf("tx.insert(approvalChainInstances)"),
    "No approval instance may be inserted before the fresh authorization guard");
  assert.throws(() => hasGuards(submit.replace(
    "eq(workforcePlans.organizationId, scenario.organizationId)", ""),
  ["eq(workforcePlans.organizationId, scenario.organizationId)"]), /missing/);
});

test("position execution reopen, cancel and apply enforce employer and hash at final write", () => {
  const code = source.executions;
  const post = region(code, "export async function POST(request: Request)", "export async function PATCH(request: Request)");
  const patch = code.slice(code.indexOf("export async function PATCH(request: Request)"));
  const reopened = region(post, "const [reopened] = await db.update(workforcePlanPositionExecutions)", "await recordAuditEvent({");
  hasGuards(reopened, [
    "eq(workforcePlanPositionExecutions.id, existing.id)",
    "eq(workforcePlanPositionExecutions.organizationId, organizationId)",
    "eq(workforcePlanPositionExecutions.executionHash, executionHash)",
    "eq(workforcePlanPositionExecutions.status, \"cancelled\")",
    "if (!reopened) return Response.json(",
  ]);
  const cancelled = region(patch, "const [cancelled] = await db.update(workforcePlanPositionExecutions)", "await recordAuditEvent({");
  hasGuards(cancelled, [
    "eq(workforcePlanPositionExecutions.organizationId, execution.organizationId)",
    "eq(workforcePlanPositionExecutions.executionHash, execution.executionHash)",
    "eq(workforcePlanPositionExecutions.status, \"preview\")",
    "if (!cancelled) return Response.json(",
  ]);
  const fresh = region(patch, "const [freshExecution] = await tx.select()", "const [[plan], [baseline]]");
  hasGuards(fresh, [
    "eq(workforcePlanPositionExecutions.organizationId, execution.organizationId)",
    "freshExecution.planId !== execution.planId",
    "freshExecution.baselineId !== execution.baselineId",
    "freshExecution.baselineSnapshotHash !== execution.baselineSnapshotHash",
    "freshExecution.executionHash !== execution.executionHash",
    "POSITION_EXECUTION_STATE_CHANGED",
  ]);
  const applied = region(patch, "const [applied] = await tx.update(workforcePlanPositionExecutions)", "return { applied, resultEvidence };");
  hasGuards(applied, [
    "eq(workforcePlanPositionExecutions.organizationId, execution.organizationId)",
    "eq(workforcePlanPositionExecutions.executionHash, execution.executionHash)",
    "eq(workforcePlanPositionExecutions.status, \"preview\")",
    "if (!applied) throw new Error(\"POSITION_EXECUTION_ALREADY_DECIDED\")",
  ]);
  assert.throws(() => hasGuards(applied.replace(
    "eq(workforcePlanPositionExecutions.organizationId, execution.organizationId)", ""),
  ["eq(workforcePlanPositionExecutions.organizationId, execution.organizationId)"]), /missing/);
});

test("employee transfer atomically matches employer, assignment, unit and target position", () => {
  const code = source.transfer;
  hasGuards(region(code, "const [targetIncumbent]", "const [currentAssignment]"), [
    "eq(positionAssignments.positionId, targetPosition.id)",
    "eq(positionAssignments.organizationId, organizationId)",
  ]);
  const tx = region(code, "const result = await db.transaction", "await recordAuditEvent({");
  const closed = region(tx, "const [closed] = await tx.update(positionAssignments)", "const [newAssignment]");
  hasGuards(closed, [
    "eq(positionAssignments.id, currentAssignment.id)",
    "eq(positionAssignments.organizationId, organizationId)",
    "eq(positionAssignments.employeeId, employeeId)",
    "eq(positionAssignments.positionId, currentPosition.id)",
    "isNull(positionAssignments.effectiveUntil)",
    "if (!closed) throw new Error(\"POSITION_TRANSFER_CONFLICT\")",
  ]);
  const originalPosition = region(tx, "const [openedCurrent] = await tx.update(positions)", "const [filledTarget]");
  hasGuards(originalPosition, [
    "eq(positions.id, currentPosition.id)",
    "eq(positions.organizationId, organizationId)",
    "eq(positions.status, currentPosition.status)",
    "if (!openedCurrent) throw new Error(\"POSITION_TRANSFER_CONFLICT\")",
  ]);
  const target = region(tx, "const [filledTarget] = await tx.update(positions)", "const [updatedEmployee]");
  hasGuards(target, [
    "eq(positions.id, targetPosition.id)",
    "eq(positions.organizationId, organizationId)",
    "eq(positions.orgUnitId, targetPosition.orgUnitId)",
    "eq(positions.status, targetPosition.status)",
    "if (!filledTarget) throw new Error(\"POSITION_TRANSFER_CONFLICT\")",
  ]);
  const worker = region(tx, "const [updatedEmployee] = await tx.update(employees)", "await tx.insert(workerEmploymentEvents)");
  hasGuards(worker, [
    "eq(employees.id, employeeId)",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.status, \"Active\")",
    "eq(employees.orgUnitId, employee.orgUnitId)",
    "if (!updatedEmployee) throw new Error(\"POSITION_TRANSFER_CONFLICT\")",
  ]);
  hasGuards(tx, [
    'if (error instanceof Error && error.message === "POSITION_TRANSFER_CONFLICT") return null;',
    'if (!result) {',
    'status: 409',
  ]);
  assert.ok(code.indexOf('if (!result) {') < code.indexOf('action: "Employee transferred between positions"'),
    "Denied transfer must not emit audit/automation side effects");
  assert.throws(() => hasGuards(closed.replace(
    "eq(positionAssignments.organizationId, organizationId)", ""),
  ["eq(positionAssignments.organizationId, organizationId)"]), /missing/);
});

test("this source-only WRK-02 slice earns zero manifest credits", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const statuses = [
    [FILES.scenarios, ["GET", "POST", "PATCH"]],
    [FILES.executions, ["GET", "POST", "PATCH"]],
    [FILES.transfer, ["POST"]],
  ];
  for (const [path, names] of statuses) {
    const entry = manifest.allApiRouteFiles[path];
    assert.deepEqual(entry.methods.map(method => method.name), names, path + " method inventory changed");
    for (const method of entry.methods) {
      if (method.name === "GET") {
        assert.equal(method.status, "COVERED", path + " old GET proof retained");
        assert.equal(method.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
      } else {
        assert.equal(method.status, "GAP", path + " does not gain proof credit");
        assert.equal(method.testedBy, null);
        assert.equal(method.reviewedUncertified?.kind, "wrk02-planning-write-boundaries-source-only-zero-credit");
        assert.equal(method.reviewedUncertified?.coverageCredits, 0);
        assert.equal(method.reviewedUncertified?.exactHeadPg16Http, "NOT_RUN");
        assert.equal(method.reviewedUncertified?.independentSecurityReview, "PENDING");
        assert.equal(method.reviewedUncertified?.productionCertified, false);
      }
    }
  }
});
