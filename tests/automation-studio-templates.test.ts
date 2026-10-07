import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Automation Studio ships stable versioned governed workflow templates", () => {
  const source = read("src/lib/automation-templates.ts");
  for (const id of [
    "people-new-hire-core-onboarding",
    "people-promotion-control-check",
    "people-separation-access-offboarding",
    "workforce-blocking-attendance-exception",
    "compliance-contribution-discrepancy",
    "compliance-government-remittance-due",
  ]) {
    assert.ok(source.includes(`id: "${id}"`), `missing template ${id}`);
  }
  assert.ok(source.includes("version: 1"));
  assert.ok(source.includes("automationTriggerIsLive"));
  assert.ok(source.includes("validAutomationConditions"));
  assert.ok(source.includes("normalizeAutomationActions"));
  assert.ok(source.includes("validateAutomationActionTrigger"));
});

test("starter templates remain tenant-neutral and cannot silently post payroll money", () => {
  const source = read("src/lib/automation-templates.ts");
  assert.equal(source.includes('type: "assign_permission_set"'), false);
  assert.equal(source.includes('type: "assign_benefit"'), false);
  assert.equal(source.includes('type: "request_payroll_adjustment"'), false);
  assert.equal(source.includes('recipient: "custom"'), false);
});

test("separation template keeps access shutdown behind an approval gate", () => {
  const source = read("src/lib/automation-templates.ts");
  const start = source.indexOf('id: "people-separation-access-offboarding"');
  const end = source.indexOf('id: "workforce-blocking-attendance-exception"');
  const template = source.slice(start, end);
  const approval = template.indexOf('type: "approval_gate"');
  const revoke = template.indexOf('type: "revoke_sessions"');
  const deactivate = template.indexOf('type: "deactivate_access"');
  assert.ok(approval >= 0);
  assert.ok(revoke > approval);
  assert.ok(deactivate > revoke);
});

test("using a template creates only a version-governed draft", () => {
  const api = read("src/app/api/automation-studio/route.ts");
  const start = api.indexOf('action === "create-from-template"');
  const end = api.indexOf('action === "save-rule"', start);
  const block = api.slice(start, end);
  assert.ok(block.includes("getAutomationWorkflowTemplate"));
  assert.ok(block.includes("saveAutomationRuleDraft"));
  assert.ok(block.includes("templateId: template.id"));
  assert.ok(block.includes("templateVersion: template.version"));
  assert.equal(block.includes("publishAutomationRuleDraft"), false);
  assert.ok(block.includes("instantiated as draft"));
});

test("template catalog is exposed as metadata rather than raw executable definitions", () => {
  const api = read("src/app/api/automation-studio/route.ts");
  const start = api.indexOf("templates: AUTOMATION_WORKFLOW_TEMPLATES.map");
  const end = api.indexOf("})),\n    },", start);
  const mapping = api.slice(start, end);
  assert.ok(mapping.includes("id: template.id"));
  assert.ok(mapping.includes("version: template.version"));
  assert.ok(mapping.includes("conditionCount"));
  assert.ok(mapping.includes("actionCount"));
  assert.equal(mapping.includes("actions: template.actions"), false);
  assert.equal(mapping.includes("conditions: template.conditions"), false);
});

test("Automation Studio UI labels template use as draft-only", () => {
  const ui = read("src/components/automation-studio-panel.tsx");
  assert.ok(ui.includes("WORKFLOW TEMPLATES"));
  assert.ok(ui.includes("creates an unpublished draft"));
  assert.ok(ui.includes('action: "create-from-template"'));
  assert.ok(ui.includes("Create draft"));
  assert.ok(ui.includes("Review it before publishing"));
});
