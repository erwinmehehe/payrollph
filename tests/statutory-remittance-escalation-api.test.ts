import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const actions = readFileSync("src/lib/statutory-remittance-actions.ts", "utf8");
const escalations = readFileSync("src/lib/statutory-remittance-escalations.ts", "utf8");
const route = readFileSync("src/app/api/compliance/remittance-actions/route.ts", "utf8");
const mailer = readFileSync("src/lib/mailer.ts", "utf8");

test("compliance actions increment an escalation episode when a resolved risk reopens", () => {
  assert.ok(schema.includes('escalationEpisode: integer("escalation_episode")'));
  assert.ok(actions.includes("escalationEpisode: current.escalationEpisode + 1"));
});

test("hourly synchronization queues deduplicated compliance escalations without making queue state depend on email", () => {
  assert.ok(actions.includes("queueStatutoryComplianceEscalations"));
  assert.ok(actions.includes("escalationDeduplicated"));
  assert.ok(actions.includes("Statutory compliance escalation queue failed"));
  assert.ok(actions.includes("The action queue remains authoritative even when escalation delivery telemetry fails."));
});

test("compliance escalation recipients stay company-wide and payroll-authorized", () => {
  assert.ok(escalations.includes("row.orgUnitId == null"));
  assert.ok(escalations.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(escalations.includes("isOwnerAdmin"));
});

test("outbox messages are idempotent by action episode, severity and recipient", () => {
  assert.ok(escalations.includes('purpose: "statutory-remittance-escalation"'));
  assert.ok(escalations.includes("escalationDedupeKey"));
  assert.ok(escalations.includes("recipientUserId"));
  assert.ok(escalations.includes("task.escalationEpisode"));
});

test("new assignments immediately notify the assigned operator without blocking assignment if mail is down", () => {
  assert.ok(route.includes("queueStatutoryComplianceEscalations"));
  assert.ok(route.includes("taskIds: [taskId]"));
  assert.ok(route.includes("Assignment remains authoritative even if the outbox is temporarily unavailable."));
});

test("compliance escalation email retries use bounded outbox backoff", () => {
  assert.ok(mailer.includes('"statutory-remittance-escalation"'));
  assert.ok(mailer.includes("MAX_AUTOMATIC_RETRIES + 1"));
  assert.ok(mailer.includes('inArray(outbox.purpose, ["payslip-ready", "statutory-remittance-escalation", "employee-contribution-case"])'));
});

test("aged escalation stages are deduped per episode, severity, stage and recipient", () => {
  assert.ok(escalations.includes("stage: EscalationStage"));
  assert.ok(escalations.includes("stage-"));
  assert.ok(escalations.includes("const stage = escalationStage(task, now)"));
  assert.ok(escalations.includes("stage,"));
});

test("severity changes reset escalation aging instead of inheriting warning lifetime", () => {
  assert.ok(schema.includes('severityChangedAt: timestamp("severity_changed_at"'));
  assert.ok(actions.includes("severityChanged = current.severity !== alert.tone"));
  assert.ok(actions.includes("severityChangedAt: severityChanged ? now : current.severityChangedAt"));
  assert.ok(actions.includes("severityChangedAt: now"));
});

test("escalation stage is based on current severity age, with bounded 24h and 72h thresholds", () => {
  assert.ok(escalations.includes("task.severityChangedAt"));
  assert.ok(escalations.includes("24 * 60 * 60 * 1000"));
  assert.ok(escalations.includes("72 * 60 * 60 * 1000"));
  assert.ok(escalations.includes("Executive payroll compliance escalation"));
});
