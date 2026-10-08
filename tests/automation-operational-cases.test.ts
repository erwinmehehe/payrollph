import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  operationalReviewPolicyBlocks,
  operationalReviewSourceId,
  operationalReviewTriggerAllowed,
  validOperationalReviewType,
} from "../src/lib/automation-operational-cases";
import {
  normalizeAutomationActions,
  SAFE_FAILED_STEP_RETRY_ACTIONS,
  simulateAutomationImpact,
  validateAutomationActionTrigger,
} from "../src/lib/automation";

const read = (path: string) => readFileSync(path, "utf8");

test("governed operations actions accept only matching authoritative trigger families", () => {
  const rows = [
    ["coverage_recovery", "coverage.gap_approaching", "openShiftId"],
    ["timesheet_escalation", "timesheet.cutoff_approaching", "timesheetId"],
    ["attendance_resolution", "attendance.exception_aging", "attendanceExceptionId"],
    ["payroll_readiness", "payroll.pay_date_approaching", "payrollRunId"],
    ["statutory_followup", "government.remittance_due", "complianceActionTaskId"],
  ] as const;

  for (const [caseType, trigger, field] of rows) {
    assert.equal(validOperationalReviewType(caseType), true);
    assert.equal(operationalReviewTriggerAllowed(caseType, trigger), true);
    assert.equal(operationalReviewSourceId(caseType, { [field]: 12 }), 12);
    assert.equal(operationalReviewTriggerAllowed(caseType, "payroll.released"), false);
    const actions = normalizeAutomationActions([{
      type: "prepare_operational_review",
      caseType,
      reason: "Review and reconcile authoritative evidence manually.",
    }]);
    assert.ok(actions, `normalize ${caseType}`);
    assert.equal(validateAutomationActionTrigger(trigger, actions!), null);
    assert.match(
      validateAutomationActionTrigger("payroll.released", actions!) ?? "",
      /requires its matching authoritative/,
    );
  }
  assert.equal(validOperationalReviewType("payroll_release"), false);
  assert.equal(validOperationalReviewType("roster_auto_publish"), false);
});

test("operational cases reject missing, forged or non-integer source evidence", () => {
  assert.equal(operationalReviewSourceId("coverage_recovery", { openShiftId: "123" }), null);
  assert.equal(operationalReviewSourceId("coverage_recovery", { openShiftId: 0 }), null);
  assert.equal(operationalReviewSourceId("coverage_recovery", { openShiftId: -7 }), null);
  assert.equal(operationalReviewSourceId("coverage_recovery", { openShiftId: 1.5 }), null);
  assert.equal(operationalReviewSourceId("coverage_recovery", { openShiftId: 99 }), 99);

  assert.ok(operationalReviewPolicyBlocks({
    caseType: "coverage_recovery",
    trigger: "coverage.gap_approaching",
    context: {},
  }).some((row) => row.includes("authoritative openShiftId")));

  assert.ok(operationalReviewPolicyBlocks({
    caseType: "timesheet_escalation",
    trigger: "timesheet.cutoff_approaching",
    context: { timesheetId: 2 },
    employeeId: 4,
  }).some((row) => row.includes("exact source version")));

  assert.ok(operationalReviewPolicyBlocks({
    caseType: "attendance_resolution",
    trigger: "attendance.exception_aging",
    context: { attendanceExceptionId: 7 },
    employeeId: null,
  }).some((row) => row.includes("employee-scoped")));

  assert.deepEqual(operationalReviewPolicyBlocks({
    caseType: "timesheet_escalation",
    trigger: "timesheet.cutoff_approaching",
    context: { timesheetId: 12, timesheetVersion: 2 },
    employeeId: 8,
  }), []);
});

test("Impact Preview blocks missing authoritative WFM evidence before publishing", () => {
  const actions = normalizeAutomationActions([{
    type: "prepare_operational_review",
    caseType: "coverage_recovery",
    reason: "Review only active open shifts in the governed WFM workspace.",
  }]);
  assert.ok(actions);
  const missing = simulateAutomationImpact({
    trigger: "coverage.gap_approaching",
    conditions: { version: 1, all: [], any: [] },
    actions: actions!,
    events: [{ eventKey: "coverage-without-source", context: {} }],
  });
  assert.equal(missing.authoritativePolicyBlocks, 1);
  assert.equal(missing.samples[0]?.policyBlocks.length, 1);
  const valid = simulateAutomationImpact({
    trigger: "coverage.gap_approaching",
    conditions: { version: 1, all: [], any: [] },
    actions: actions!,
    events: [{ eventKey: "coverage-source-42", context: { openShiftId: 42 } }],
  });
  assert.equal(valid.authoritativePolicyBlocks, 0);
  assert.equal(valid.projectedSteps, 1);
});

test("operational review execution reads authoritative tenant rows and only inserts audited cases", () => {
  const source = read("src/lib/automation-operational-cases.ts");
  const engine = read("src/lib/automation.ts");
  for (const entity of [
    "openShifts.organizationId",
    "workforceTimesheets.organizationId",
    "attendanceExceptionEvents.organizationId",
    "payrollRuns.organizationId",
    "complianceActionTasks.organizationId",
  ]) assert.ok(source.includes(entity), `missing tenant guard ${entity}`);
  assert.ok(source.includes('eq(complianceActionTasks.sourceType, "statutory_remittance")'));
  assert.ok(source.includes('row.status === "open"'));
  assert.ok(source.includes('row.status !== "Released"'));
  assert.ok(source.includes("source.employeeId !== input.employeeId"));
  assert.ok(source.includes("source.sourceVersion !== input.context.timesheetVersion"));
  assert.ok(source.includes("tx.insert(automationOperationalCases)"));
  assert.ok(source.includes(".onConflictDoNothing().returning()"));
  assert.ok(source.includes("tx.insert(auditEvents)"));
  assert.ok(source.includes("changesAppliedAutomatically: false"));
  assert.equal(source.includes("tx.update(payrollRuns)"), false);
  assert.equal(source.includes("tx.update(openShifts)"), false);
  assert.equal(source.includes("tx.update(workforceTimesheets)"), false);
  assert.equal(source.includes("tx.update(complianceActionTasks)"), false);
  assert.ok(engine.includes('action.type === "prepare_operational_review"'));
  assert.ok(engine.includes("prepareOperationalReviewCase({"));
});

test("dead letters preserve step evidence and require manual disposition without replay", () => {
  const source = read("src/lib/automation-operational-cases.ts");
  const route = read("src/app/api/automation-studio/route.ts");
  const panel = read("src/components/automation-studio-panel.tsx");
  assert.ok(source.includes("createExecutionDeadLetter"));
  assert.ok(source.includes('caseType: "execution_dead_letter"'));
  assert.ok(source.includes("manualReviewRequired: true"));
  assert.ok(source.includes("actionsReplayed: false"));
  assert.ok(source.includes("latestStep.status !== \"failed\""));
  assert.ok(source.includes("before a new automation can complete"));
  assert.ok(route.includes('action === "quarantine-execution-step"'));
  assert.ok(route.includes("latestExecutionSteps(execution.result)"));
  assert.ok(route.includes('step.status === "failed"'));
  assert.ok(route.includes('action === "triage-operational-case"'));
  assert.ok(route.includes('transition === "resolve"'));
  assert.ok(route.includes("operationalReviewSourceResolved"));
  assert.ok(route.includes("underlying authoritative WFM/payroll/compliance source is still open"));
  assert.ok(route.includes("tx.insert(auditEvents)"));
  assert.ok(route.includes("underlyingExecutionStatusUnchanged: true"));
  assert.ok(panel.includes("Quarantine failed step"));
  assert.ok(panel.includes("Manual WFM/payroll recovery queue"));
  assert.ok(panel.includes("Record resolution"));
  assert.ok(panel.includes("Reopen"));
});

test("failed-step recovery uses an explicit safe allowlist and a transaction-scoped lock", () => {
  for (const action of [
    "assign_permission_set", "assign_benefit", "revoke_sessions",
    "deactivate_access", "prepare_operational_review",
  ]) assert.equal(SAFE_FAILED_STEP_RETRY_ACTIONS.has(action), true);

  for (const blocked of [
    "request_approval", "request_payroll_adjustment",
    "create_task", "create_onboarding_checklist",
    "assign_schedule", "generate_document", "send_email",
    "send_slack_message", "webhook",
  ]) assert.equal(SAFE_FAILED_STEP_RETRY_ACTIONS.has(blocked), false);

  const engine = read("src/lib/automation.ts");
  assert.ok(engine.includes("pg_advisory_xact_lock"));
  assert.ok(engine.includes("db.transaction(async (tx) => {"));
  assert.ok(engine.includes("!SAFE_FAILED_STEP_RETRY_ACTIONS.has(step.type)"));
  assert.ok(engine.includes('deadLetter?.status === "open"'));
  assert.ok(engine.includes('deadLetter?.status === "resolved"'));
  assert.ok(engine.includes('quarantines.some((letter) => letter.status !== "acknowledged")'));
  assert.ok(engine.includes("latestBusinessStepResults(result)"));
  assert.ok(engine.includes("retryAttempt: true"));
  const api = read("src/app/api/automation-studio/route.ts");
  assert.ok(api.includes("SAFE_FAILED_STEP_RETRY_ACTIONS.has"));
});

test("review-case templates and UI are usable without automatic payroll or WFM mutation", () => {
  const templates = read("src/lib/automation-templates.ts");
  const ui = read("src/components/automation-studio-panel.tsx");
  const route = read("src/app/api/automation-studio/route.ts");
  for (const id of [
    "wfm-coverage-recovery-review",
    "wfm-timesheet-cutoff-escalation",
    "wfm-attendance-exception-sla-review",
    "payroll-pay-date-readiness-review",
    "compliance-remittance-operational-followup",
  ]) assert.ok(templates.includes(id));
  assert.ok(ui.includes("OPERATIONAL_REVIEW_BY_TRIGGER"));
  assert.ok(ui.includes('row.type === "prepare_operational_review"'));
  assert.ok(ui.includes("Underlying issue must be resolved in its governed workspace first."));
  assert.ok(route.includes("operationalCases: cases"));
  assert.ok(route.includes("caseCounts:"));
  for (const guard of [
    "enforceSameOriginMutation(request)",
    "requireSensitiveActionMfa(user)",
    "enforceSensitiveActionRateLimit",
    "publicDemoMutationDenied",
    "assertStudioAdmin",
  ]) assert.ok(route.includes(guard));
});

test("migration, schema, fresh baseline and legacy upgrades match and remain optional on old tenants", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0096_automation_operational_cases.sql");
  const baseline = read("drizzle/baseline.sql");
  const compat = read("src/lib/core-schema-compat.ts");
  for (const file of [schema, migration, baseline, compat]) {
    for (const part of [
      "automation_operational_cases",
      "automation_operations_source_case_unique",
      "automation_operations_dead_letter_step_unique",
      "automation_operations_status_check",
      "automation_operations_dead_letter_shape_check",
    ]) assert.ok(file.includes(part), `missing ${part}`);
  }
  assert.ok(compat.includes("to_regclass('automation_executions')"));
  assert.ok(compat.includes("to_regclass('employees')"));
  assert.ok(compat.includes("to_regclass('users')"));
});
