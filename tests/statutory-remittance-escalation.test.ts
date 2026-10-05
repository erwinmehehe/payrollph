import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseEscalationRecipients,
  escalationDedupeKey,
  escalationStage,
  escalationSubject,
} from "../src/lib/statutory-remittance-escalations";

const recipients = [
  { userId: 1, name: "Owner One", email: "owner@example.com", role: "owner" },
  { userId: 2, name: "Admin Two", email: "admin@example.com", role: "admin" },
  { userId: 3, name: "Payroll Three", email: "payroll@example.com", role: "payroll" },
  { userId: 4, name: "Bookkeeper Four", email: "books@example.com", role: "bookkeeper" },
];

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    organizationId: 9,
    sourceType: "statutory_remittance",
    sourceKey: "batch:41",
    agency: "SSS",
    applicableMonth: "2026-09",
    severity: "warning",
    severityChangedAt: new Date("2026-10-25T00:00:00Z"),
    escalationEpisode: 1,
    title: "SSS remittance is due soon",
    detail: "Due in five days.",
    dueDate: "2026-10-31",
    status: "open",
    assignedToUserId: null,
    assignedToName: null,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    acknowledgedByName: null,
    firstDetectedAt: new Date("2026-10-25T00:00:00Z"),
    lastDetectedAt: new Date("2026-10-25T00:00:00Z"),
    resolvedAt: null,
    createdAt: new Date("2026-10-25T00:00:00Z"),
    updatedAt: new Date("2026-10-25T00:00:00Z"),
    ...overrides,
  } as any;
}

test("assigned warning goes only to the assigned payroll operator", () => {
  const selected = chooseEscalationRecipients(
    task({ assignedToUserId: 3, assignedToName: "Payroll Three" }),
    recipients,
  );
  assert.deepEqual(selected.map((row) => row.userId), [3]);
});

test("unassigned warning falls back to owner and admin", () => {
  const selected = chooseEscalationRecipients(task(), recipients);
  assert.deepEqual(selected.map((row) => row.userId).sort(), [1, 2]);
});

test("critical action notifies assignee plus owner/admin fallback", () => {
  const selected = chooseEscalationRecipients(
    task({
      severity: "danger",
      assignedToUserId: 3,
      assignedToName: "Payroll Three",
    }),
    recipients,
  );
  assert.deepEqual(selected.map((row) => row.userId).sort(), [1, 2, 3]);
});

test("resolved and informational actions do not email", () => {
  assert.deepEqual(
    chooseEscalationRecipients(task({ status: "resolved" }), recipients),
    [],
  );
  assert.deepEqual(
    chooseEscalationRecipients(task({ severity: "info" }), recipients),
    [],
  );
});

test("dedupe key stays stable within one episode but changes on severity or reopen", () => {
  const base = {
    organizationId: 9,
    taskId: 41,
    episode: 1,
    severity: "warning",
    stage: 1,
    recipientUserId: 3,
  };
  assert.equal(escalationDedupeKey(base), escalationDedupeKey(base));
  assert.notEqual(
    escalationDedupeKey(base),
    escalationDedupeKey({ ...base, severity: "danger" }),
  );
  assert.notEqual(
    escalationDedupeKey(base),
    escalationDedupeKey({ ...base, episode: 2 }),
  );
});


test("escalation stage advances only at bounded 24h and 72h thresholds", () => {
  const changed = new Date("2026-10-01T00:00:00Z");
  const baseTask = task({ severityChangedAt: changed });

  assert.equal(escalationStage(baseTask, new Date("2026-10-01T23:59:59Z")), 1);
  assert.equal(escalationStage(baseTask, new Date("2026-10-02T00:00:00Z")), 2);
  assert.equal(escalationStage(baseTask, new Date("2026-10-03T23:59:59Z")), 2);
  assert.equal(escalationStage(baseTask, new Date("2026-10-04T00:00:00Z")), 3);
});

test("resolved and informational actions have no escalation stage", () => {
  assert.equal(escalationStage(task({ status: "resolved" })), 0);
  assert.equal(escalationStage(task({ severity: "info" })), 0);
});

test("stage is part of the outbox dedupe key so follow-ups can send once per threshold", () => {
  const base = {
    organizationId: 9,
    taskId: 41,
    episode: 1,
    severity: "danger",
    recipientUserId: 1,
  };
  assert.notEqual(
    escalationDedupeKey({ ...base, stage: 1 }),
    escalationDedupeKey({ ...base, stage: 2 }),
  );
  assert.notEqual(
    escalationDedupeKey({ ...base, stage: 2 }),
    escalationDedupeKey({ ...base, stage: 3 }),
  );
});

test("24h warning follow-up includes owner/admin even when assigned", () => {
  const selected = chooseEscalationRecipients(
    task({ assignedToUserId: 3, assignedToName: "Payroll Three" }),
    recipients,
    2,
  );
  assert.deepEqual(selected.map((row) => row.userId).sort(), [1, 2, 3]);
});

test("72h subject is explicitly executive escalation", () => {
  assert.match(
    escalationSubject(task({ severity: "danger" }), 3),
    /Executive critical payroll compliance/,
  );
});


test("warning lifetime does not cause immediate executive escalation after severity becomes critical", () => {
  const longLived = task({
    severity: "danger",
    firstDetectedAt: new Date("2026-09-20T00:00:00Z"),
    severityChangedAt: new Date("2026-10-05T00:00:00Z"),
  });

  assert.equal(
    escalationStage(longLived, new Date("2026-10-05T06:00:00Z")),
    1,
  );
  assert.equal(
    escalationStage(longLived, new Date("2026-10-06T00:00:00Z")),
    2,
  );
});
