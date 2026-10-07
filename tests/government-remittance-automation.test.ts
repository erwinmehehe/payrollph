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

test("remittance due automation reuses the persistent compliance action queue", () => {
  assert.ok(remittance.includes("complianceActionTasks"));
  assert.ok(remittance.includes("automationCandidates"));
  assert.ok(remittance.includes("isRemittanceDueAutomationAlert"));
  assert.ok(remittance.includes('alert.id.startsWith("coverage:")'));
  assert.ok(remittance.includes('alert.title.endsWith("remittance is due soon")'));
  assert.ok(remittance.includes('alert.title.endsWith("remittance is overdue")'));
});

test("remittance due events emit only for newly opened or reopened episodes", () => {
  assert.ok(remittance.includes("if (inserted.length > 0)"));
  assert.ok(remittance.includes("if (reopenedRows.length > 0)"));
  assert.ok(remittance.includes("escalationEpisode: current.escalationEpisode + 1"));
  assert.ok(remittance.includes(
    "government-remittance-due:${candidate.taskId}:${candidate.escalationEpisode}",
  ));
  assert.ok(remittance.includes('trigger: "government.remittance_due"'));
});

test("remittance due automation context supports compliance routing conditions", () => {
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

test("automation failures never invalidate the authoritative compliance action sync", () => {
  assert.ok(remittance.includes('status: "engine_error"'));
  assert.ok(remittance.includes("Government remittance automation failed."));
  assert.ok(remittance.includes("queueStatutoryComplianceEscalations"));
  assert.ok(remittance.includes("missingOrganization: false"));
});
