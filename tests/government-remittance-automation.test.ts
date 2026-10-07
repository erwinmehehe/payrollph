import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const automation = readFileSync("src/lib/automation.ts", "utf8");
const remittance = readFileSync("src/lib/statutory-remittance-actions.ts", "utf8");

test("government.remittance_due is live rather than planned", () => {
  const liveStart = automation.indexOf("export const AUTOMATION_LIVE_TRIGGERS");
  const plannedStart = automation.indexOf("export const AUTOMATION_PLANNED_TRIGGERS");
  const live = automation.slice(liveStart, plannedStart);
  const planned = automation.slice(
    plannedStart,
    automation.indexOf("export function automationTriggerIsLive", plannedStart),
  );

  assert.ok(live.includes('"government.remittance_due"'));
  assert.equal(planned.includes('"government.remittance_due"'), false);
});

test("remittance due automation remains legal-entity scoped", () => {
  assert.ok(remittance.includes("loadStatutoryRemittanceState(organizationId, legalEntityId)"));
  assert.ok(remittance.includes("const sourcePrefix = `legal-entity:${legalEntityId}:`"));
  assert.ok(remittance.includes("legalEntityId,"));
  assert.ok(remittance.includes("legalEntityCode: state.legalEntity.code"));
  assert.ok(remittance.includes("legalEntityName: state.legalEntity.displayName"));
});

test("due events reuse the persistent compliance action queue and only fire for due states", () => {
  assert.ok(remittance.includes("complianceActionTasks"));
  assert.ok(remittance.includes("automationCandidates"));
  assert.ok(remittance.includes("isRemittanceDueAutomationAlert"));
  assert.ok(remittance.includes('alert.id.startsWith("coverage:")'));
  assert.ok(remittance.includes('alert.title.endsWith("remittance is due soon")'));
  assert.ok(remittance.includes('alert.title.endsWith("remittance is overdue")'));
});

test("new, reopened, and warning-to-overdue phases are independently idempotent", () => {
  assert.ok(remittance.includes("if (inserted.length > 0)"));
  assert.ok(remittance.includes("if (reopenedRows.length > 0)"));
  assert.ok(remittance.includes("escalationEpisode: current.escalationEpisode + 1"));
  assert.ok(remittance.includes("severityChanged && isRemittanceDueAutomationAlert(alert)"));
  assert.ok(remittance.includes(
    "government-remittance-due:${legalEntityId}:${candidate.taskId}:${candidate.escalationEpisode}:${candidate.alert.tone}",
  ));
  assert.ok(remittance.includes('trigger: "government.remittance_due"'));
});

test("remittance due context exposes deterministic routing fields", () => {
  for (const field of [
    "statutoryAgency",
    "applicableMonth",
    "daysUntilDue",
    "remittanceAlertTone",
    "complianceActionTaskId",
  ]) {
    assert.ok(automation.includes(`value: "${field}"`), `missing condition field ${field}`);
    assert.ok(remittance.includes(`${field}:`), `missing event context field ${field}`);
  }
});

test("automation remains downstream of authoritative remittance synchronization", () => {
  const transactionEnd = remittance.indexOf("\n  });\n\n  let automationEvents");
  const automationCall = remittance.indexOf('trigger: "government.remittance_due"');
  assert.ok(transactionEnd > 0);
  assert.ok(automationCall > transactionEnd);
  assert.ok(remittance.includes("automationErrors += 1"));
  assert.ok(remittance.includes("queueStatutoryComplianceEscalations"));
});
