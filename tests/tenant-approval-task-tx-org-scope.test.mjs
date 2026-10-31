import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
const qa = readFileSync("scripts/qa/tenant-approval-task-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-approval-task-http.yml", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

function scopedWrite(entity, idPattern, source = route) {
  // Evaluate every update site, not a broad regex that could skip an added
  // unscoped write or accidentally match a later update's WHERE predicate.
  const marker = "await tx.update(" + entity + ")";
  const parts = source.split(marker);
  assert.equal(parts.length, 2, "Expected exactly one final " + entity + " update");
  const statement = parts[1].split(";")[0];
  assert.ok(statement.includes(".set("), entity + " must set the decision state");
  const whereIndex = statement.indexOf(".where(and(");
  assert.ok(whereIndex >= 0, entity + " must use a conjunctive SQL WHERE");
  const predicate = statement.slice(whereIndex);
  assert.ok(idPattern.test(predicate), entity + " write must bind its real ID");
  assert.ok(
    predicate.includes("eq(" + entity + ".organizationId, task.organizationId)"),
    entity + " write must bind the authenticated task employer in the same SQL statement",
  );
}


test("approval task and linked money/workforce writes repeat scoped employer predicate in SQL", () => {
  assert.match(route, /export async function PATCH\(/);
  assert.match(route, /enforceSameOriginMutation\(request\)/);
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /eq\(userOrganizations\.active, true\)/);
  assert.match(route, /assertMembership\(sessionUser\.id, task\.organizationId\)/);
  assert.match(route, /db\.transaction\(async \(tx\)/);
  scopedWrite("approvalTasks", /eq\(approvalTasks\.id, taskId\)/);
  scopedWrite("payrollRuns", /eq\(payrollRuns\.id, payrollRunId\)/);
  scopedWrite("automationExecutions", /eq\(automationExecutions\.waitingApprovalTaskId, taskId\)/);
  scopedWrite("workforcePlanningScenarios", /eq\(workforcePlanningScenarios\.id, workforceScenarioApproval\.scenarioId\)/);
  scopedWrite("workforcePlans", /eq\(workforcePlans\.id, scenarioRow\.planId\)/);
  assert.match(route, /eq\(workforcePlans\.organizationId, task\.organizationId\)/);
  assert.match(route, /eq\(workforcePlanningScenarios\.organizationId, task\.organizationId\)/);
  assert.match(route, /eq\(payrollRuns\.organizationId, task\.organizationId\)/);
  assert.match(route, /eq\(approvalTasks\.organizationId, task\.organizationId\)/);
  assert.match(route, /eq\(automationExecutions\.organizationId, task\.organizationId\)/);
});

test("scope contract fails closed for an added unscoped update and a removed employer guard", () => {
  const id = /eq\(approvalTasks\.id, taskId\)/;
  const extra = route + '\nawait tx.update(approvalTasks).set({ status }).where(and(eq(approvalTasks.id, taskId)));';
  assert.throws(() => scopedWrite("approvalTasks", id, extra), /exactly one final approvalTasks update/);

  const guard = "eq(approvalTasks.organizationId, task.organizationId),";
  assert.ok(route.includes(guard), "The original guard must exist before mutation");
  const unsafe = route.replace(guard, "");
  assert.throws(() => scopedWrite("approvalTasks", id, unsafe),
    /authenticated task employer in the same SQL statement/);
});

test("prior real three-employer PATCH HTTP proof is reused without claiming a new coverage credit", () => {
  for (const marker of [
    "requireDisposableApprovalTask()",
    "for (const [attacker, peer] of [[a, b], [b, a]])",
    'const ownedA = await decision(aTask, a.cookie, "Declined"',
    'const ownedB = await decision(bTask, b.cookie, "Approved")',
    "assertUnchanged(baseline.get(victim.org.id), await snapshot(victim.org.id)",
    "coverageCredits: 0, independentlyAccepted: false",
  ]) assert.ok(qa.includes(marker), "Existing PG16 proof missing: " + marker);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-approval-task-http\.mjs/);
  const entry = manifest.allApiRouteFiles["src/app/api/approvals/[id]/route.ts"];
  assert.equal(entry.methods.length, 1);
  assert.equal(entry.methods[0].name, "PATCH");
  assert.equal(entry.methods[0].status, "GAP");
  assert.equal(entry.methods[0].testedBy, null,
    "Existing generic-task proof does not cover all approval-linked payroll/HCM sources");
});
