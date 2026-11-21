import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AssuranceFinding } from "../src/lib/payroll-assurance";
import { CRITICAL_RELEASE_FLAGS, criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import {
  buildPayrollOperationsBrief, buildHrOperationsBrief, modelSafeOperationsSnapshot,
  operationsCopilotEnabled, operationsCopilotAiAllowed, OPERATIONS_COPILOT_PREVIEW_LIMIT,
} from "../src/lib/operations-copilot";

const consent = {
  OPERATIONS_COPILOT_READONLY_ENABLED: "true",
  OPERATIONS_COPILOT_MODEL_ENABLED: "true",
  OPENAI_AUTOMATION_DRAFT_ENABLED: "true",
  OPENAI_API_KEY: "fictional-placeholder-never-used",
  OPENAI_AUTOMATION_DPA_CONFIRMED: "true",
  OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED: "true",
  OPENAI_AUTOMATION_NOTICE_CONFIRMED: "true",
  OPENAI_AUTOMATION_APPROVED_ORG_IDS: "17",
};

test("both sensitive pilot gates are registered with accountable release owners", () => {
  for (const name of ["operationsCopilotReadonly", "operationsCopilotModel"] as const) {
    const gate = CRITICAL_RELEASE_FLAGS[name];
    assert.ok(gate.owner && gate.risk && gate.approval);
    assert.equal(criticalReleaseFlagEnabled(name, {}), false);
    assert.equal(criticalReleaseFlagEnabled(name, { [gate.env]: "true" }), true);
  }
});

test("read-only and external AI are independent default-off tenant gates", () => {
  assert.equal(operationsCopilotEnabled({}), false);
  assert.equal(operationsCopilotEnabled({ OPERATIONS_COPILOT_READONLY_ENABLED: "TRUE" }), false);
  assert.equal(operationsCopilotAiAllowed(17, consent), true);
  assert.equal(operationsCopilotAiAllowed(99, consent), false);
  assert.equal(operationsCopilotAiAllowed(17, { ...consent, OPERATIONS_COPILOT_MODEL_ENABLED: "false" }), false);
  assert.equal(operationsCopilotAiAllowed(17, { ...consent, OPENAI_AUTOMATION_DPA_CONFIRMED: undefined }), false);
  assert.equal(operationsCopilotAiAllowed(17, { ...consent, OPENAI_AUTOMATION_NOTICE_CONFIRMED: undefined }), false);
  assert.equal(operationsCopilotAiAllowed(17, { ...consent, OPERATIONS_COPILOT_READONLY_ENABLED: undefined }), false);
});

const fictionalFindings: AssuranceFinding[] = [
  { code: "MATERIAL_NET_VARIANCE", severity: "medium", blocking: false,
    title: "PRIVATE PERSON NAME", detail: "BANK ACCOUNT 9988776655", employeeId: 432123, current: 888888 },
  { code: "MISSING_BANK_DETAILS", severity: "high", blocking: true,
    title: "PRIVATE PERSON NAME", detail: "BANK ACCOUNT 9988776655", employeeId: 432123 },
  { code: "MATERIAL_NET_VARIANCE", severity: "high", blocking: false,
    title: "PRIVATE PERSON NAME", detail: "BANK ACCOUNT 9988776655", employeeId: 432123 },
];

test("payroll triage groups only authoritative codes, preserves blockers and never echoes PII", () => {
  const before = structuredClone(fictionalFindings);
  const brief = buildPayrollOperationsBrief({ organizationId: 17, runId: 39, findings: fictionalFindings });
  assert.equal(brief.area, "payroll");
  assert.equal(brief.signals.length, 2);
  assert.equal(brief.signals[0].key, "MISSING_BANK_DETAILS");
  assert.equal(brief.signals[0].priority, "high");
  assert.equal(brief.signals[1].count, 2);
  assert.equal(brief.metrics.find(m => m.key === "blocking")?.value, 1);
  assert.equal(brief.metrics.find(m => m.key === "high")?.value, 2);
  assert.equal(brief.previewTruncated, false);
  assert.deepEqual(fictionalFindings, before, "source finding objects must not be mutated");

  const response = JSON.stringify(brief);
  const external = JSON.stringify(modelSafeOperationsSnapshot(brief));
  for (const secret of ["PRIVATE PERSON NAME", "9988776655", "432123", "888888"]) {
    assert.equal(response.includes(secret), false, "private source data leaked into the response");
    assert.equal(external.includes(secret), false, "private source data leaked into external snapshot");
  }
  assert.ok(brief.signals.every(item => item.sourceUrl.includes("organizationId=17")));
  assert.ok(!external.includes('"organizationId"'));
  assert.ok(!external.includes('"runId"'));
});

test("invalid payroll scope and codes fail closed; zero findings never certify release", () => {
  assert.throws(() => buildPayrollOperationsBrief({ organizationId: 17, runId: 0, findings: [] }), /COPILOT_INVALID_SCOPE/);
  assert.throws(() => buildPayrollOperationsBrief({
    organizationId: 17, runId: 39,
    findings: [{ ...fictionalFindings[0], code: "PRIVATE\nPROMPT_INJECTION" }],
  }), /COPILOT_INVALID_SOURCE_FINDING/);
  const empty = buildPayrollOperationsBrief({ organizationId: 17, runId: 39, findings: [] });
  assert.equal(empty.metrics[0].value, 0);
  assert.match(empty.caution, /not a payroll approval/);
});

const hrRows = [
  { id: 55, organizationId: 17, status: "open", caseType: "timesheet_escalation", ownerUserId: 12,
    dueAt: null, overdue: false, title: "PRIVATE HR TITLE", detail: "MEDICAL HISTORY SECRET" },
  { id: 56, organizationId: 17, status: "acknowledged", caseType: "payroll_readiness", ownerUserId: null,
    dueAt: "2026-11-20T10:00:00.000Z", overdue: true, title: "PRIVATE HR TITLE", detail: "MEDICAL HISTORY SECRET" },
];

test("HR triage uses existing cases, explicit full-queue totals, and no private case text", () => {
  const rows = structuredClone(hrRows);
  const brief = buildHrOperationsBrief({
    organizationId: 17, cases: rows,
    totals: { totalOpen: 7, overdue: 3, unassigned: 2 },
  });
  assert.equal(brief.area, "hr");
  assert.equal(brief.signals[0].key, "case:56");
  assert.equal(brief.signals[0].priority, "high");
  assert.equal(brief.metrics[0].value, 7);
  assert.equal(brief.metrics[1].value, 3);
  assert.equal(brief.previewTruncated, true);
  assert.deepEqual(rows, hrRows);
  const response = JSON.stringify(brief);
  const external = JSON.stringify(modelSafeOperationsSnapshot(brief));
  for (const secret of ["MEDICAL HISTORY SECRET", "PRIVATE HR TITLE"]) assert.ok(!response.includes(secret));
  for (const privateValue of ["case:55", "case:56", "MEDICAL HISTORY SECRET", "PRIVATE HR TITLE", "organizationId"]) {
    assert.ok(!external.includes(privateValue), "external HR snapshot must have counts only");
  }
  assert.deepEqual(modelSafeOperationsSnapshot(brief).focusKeys, ["overdue", "unassigned", "open"]);
});

test("HR scope checks reject foreign, duplicate, tampered, and inconsistent case data", () => {
  const setup = { organizationId: 17, totals: { totalOpen: 2, overdue: 1, unassigned: 1 } };
  assert.throws(() => buildHrOperationsBrief({ ...setup, cases: [{ ...hrRows[0], organizationId: 99 }] }), /COPILOT_INVALID_QUEUE_ROW/);
  assert.throws(() => buildHrOperationsBrief({ ...setup, cases: [hrRows[0], hrRows[0]] }), /COPILOT_INVALID_QUEUE_ROW/);
  assert.throws(() => buildHrOperationsBrief({ ...setup, cases: [{ ...hrRows[0], status: "resolved" }] }), /COPILOT_INVALID_QUEUE_ROW/);
  assert.throws(() => buildHrOperationsBrief({ ...setup, totals: { totalOpen: 0, overdue: 1, unassigned: 0 }, cases: [] }), /COPILOT_INVALID_QUEUE_TOTALS/);
  assert.throws(() => buildHrOperationsBrief({ ...setup, cases: [{ ...hrRows[0], dueAt: "not-a-date" }] }), /COPILOT_INVALID_QUEUE_ROW/);
});

test("long HR queues are visibly bounded while true counts remain intact", () => {
  const cases = Array.from({ length: OPERATIONS_COPILOT_PREVIEW_LIMIT + 1 }, (_, i) => ({
    id: i + 1, organizationId: 17, status: "open", caseType: "payroll_readiness",
    ownerUserId: 12, dueAt: null, overdue: false,
  }));
  const brief = buildHrOperationsBrief({
    organizationId: 17, cases, totals: { totalOpen: 96, overdue: 0, unassigned: 0 },
  });
  assert.equal(brief.signals.length, OPERATIONS_COPILOT_PREVIEW_LIMIT);
  assert.equal(brief.signalsShown, OPERATIONS_COPILOT_PREVIEW_LIMIT);
  assert.equal(brief.signalTypesOrCases, 96);
  assert.equal(brief.previewTruncated, true);
});

test("API and page independently enforce authorization, source scope and zero side effects", () => {
  const route = readFileSync("src/app/api/operations-copilot/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/operations-copilot/page.tsx", "utf8");
  const model = readFileSync("src/lib/operations-copilot-ai.ts", "utf8");
  for (const guard of [
    "operationsCopilotEnabled()", "getSessionUser()", "assertOrganizationRole",
    "assertOrganizationUnitAccess", "findPayrollRunForMember",
    "requireRunEmployer", "access?.companyWide", "WHERE organization_id = $1",
    "enforceSameOriginMutation", "requireSensitiveActionMfa", "enforceSensitiveActionRateLimit",
  ]) assert.ok(route.includes(guard), "missing API gate: " + guard);
  assert.ok(route.includes('status IN (\'open\', \'acknowledged\')'));
  assert.ok(route.includes("source.run.legalEntityId !== run.legalEntityId"));
  assert.ok(page.includes("assertOrganizationRole") && page.includes("assertOrganizationUnitAccess"));
  assert.ok(page.includes("operationsCopilotEnabled()"));
  assert.ok(model.includes("modelSafeOperationsSnapshot(brief)"));
  assert.ok(model.includes("operationsCopilotAiAllowed(brief.organizationId)"));
  assert.ok(!route.includes("drainPayrollQueue") && !route.includes("db.update(") && !route.includes("db.insert("));
  assert.ok(!model.includes("employeeId") || model.includes("Employee IDs, case IDs"));
});
