import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("coverage manager UI offers the review-only smart draft and both planning priorities", () => {
  const page = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  assert.match(page, /planSmartRecoveryDraft\(/);
  assert.match(page, /Maximize coverage/);
  assert.match(page, /Balance planned hours/);
  assert.match(page, /Conflicts avoided/);
  assert.match(page, /stage_recovery_plan/);
  assert.match(page, /Stage for approval/);
});

test("recovery plan stage validates trusted shift overlap and headcount before database writes", () => {
  const route = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
  const start = route.indexOf('if (action === "stage_recovery_plan")');
  assert.ok(start > 0);
  const tail = route.slice(start);
  const validator = tail.indexOf("recoveryProposalConflict(assignments.map(");
  const committed = tail.indexOf("const staged = await db.transaction(");
  assert.ok(validator > 0 && committed > validator);
  assert.match(tail.slice(0, committed), /requiredHeadcount/);
  assert.match(tail.slice(0, committed), /startDate: addDays\(workDate, -1\)/);
  assert.match(tail.slice(0, committed), /endDate: addDays\(workDate, 1\)/);
  assert.match(tail.slice(0, committed), /RECOVERY_EXISTING_SCHEDULE_OVERLAP/);
  assert.match(tail.slice(0, committed), /requireSensitiveActionMfa\(user\)/);
  assert.match(route, /enforceSameOriginMutation\(request\)/);
});

test("preview, staging, and source management preserve separate roles", () => {
  const route = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
  assert.match(route, /assertOrganizationRole/);
  assert.match(route, /assertScope\(access, employee\.orgUnitId\)/);
  assert.match(route, /loadEmployeeWfmEligibility/);
  assert.match(route, /employeeSiteEligibility/);
  assert.match(route, /approvedLeaveConflictForShift/);
  assert.match(route, /await recordAuditEvent\(/);
});

test("manager queue stays read-only and links to existing scoped WFM workflows", () => {
  const page = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  assert.match(page, /buildWfmManagerActionQueue\(/);
  assert.match(page, /data-wfm-manager-queue/);
  for (const id of ["wfm-smart-recovery", "wfm-roster-readiness", "wfm-claims", "wfm-labor-variance"]) {
    assert.ok(page.includes('id="' + id + '"'), id);
  }
  assert.match(page, /Open the relevant review workflow/);
  const engine = readFileSync("src/lib/workforce-manager-actions.ts", "utf8");
  assert.doesNotMatch(engine, /db\.insert|db\.update|db\.delete|fetch\(/);
});
