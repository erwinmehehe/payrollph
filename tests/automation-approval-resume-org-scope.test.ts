import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Source-contract checks (same style as tenant-approval-task-tx-org-scope.test.mjs): they read the
 * code and fail if the employer binding or the stuck-run recovery is removed. They do NOT execute the
 * function against a database, so they prove structure, not behavior.
 */
const engine = readFileSync("src/lib/automation.ts", "utf8");
const route = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");

function resumeBody() {
  const start = engine.indexOf("export async function resumeAutomationExecutionFromApproval(");
  const end = engine.indexOf("export async function runAutomationEvent(", start);
  assert.ok(start >= 0 && end > start, "resume function must exist");
  return engine.slice(start, end);
}

test("resume requires a valid employer and binds it in the lookup and both guarded writes", () => {
  const body = resumeBody();
  assert.match(body, /organizationId: number;/, "input must declare the employer");
  assert.match(body, /Number\.isSafeInteger\(input\.organizationId\) \|\| input\.organizationId <= 0/);
  const scoped = body.match(/eq\(automationExecutions\.organizationId, input\.organizationId\)/g) ?? [];
  // lookup select, declined update, claim update, failure-recovery update
  assert.equal(scoped.length, 4, "lookup and every write must bind the employer");
  // Every db.select/db.update statement in the function carries the employer binding.
  const statements = body.split(/await db\.(?:select|update)\(/).slice(1);
  assert.equal(statements.length, 4);
  for (const statement of statements) {
    const upToNext = statement.split(/\n  (?:if|const|return|try|\}|throw)/)[0] + statement.slice(0, 700);
    assert.ok(upToNext.includes("eq(automationExecutions.organizationId, input.organizationId)"), "unscoped statement: " + statement.slice(0, 80));
  }
});

test("the lookup is not by approval task id alone", () => {
  const body = resumeBody();
  const select = body.slice(body.indexOf("db.select()"), body.indexOf(".limit(1)"));
  assert.ok(select.includes("waitingApprovalTaskId"));
  assert.ok(select.includes("organizationId"), "approval task id alone is not an employer boundary");
  assert.ok(select.includes('"waiting_approval"'));
});

test("a failure after the claim marks the run failed instead of leaving it in_progress", () => {
  const body = resumeBody();
  const claimAt = body.indexOf('status: "in_progress"');
  const tryAt = body.indexOf("try {", claimAt);
  assert.ok(claimAt >= 0 && tryAt > claimAt, "advance must run inside try after the claim");
  const catchBody = body.slice(body.indexOf("} catch (error) {", tryAt));
  assert.ok(catchBody.includes('status: "failed"'));
  assert.ok(catchBody.includes('eq(automationExecutions.status, "in_progress")'), "only an in_progress run may be failed");
  assert.ok(catchBody.includes("throw error;"), "the caller must still see the error (engine_error)");
});

test("the only caller passes the approval task's own employer", () => {
  const call = route.slice(route.indexOf("resumeAutomationExecutionFromApproval({"));
  const args = call.slice(0, call.indexOf("});"));
  assert.ok(args.includes("organizationId: task.organizationId"));
  assert.equal((route.match(/resumeAutomationExecutionFromApproval\(\{/g) ?? []).length, 1);
});
