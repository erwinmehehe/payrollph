import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseEscalationRecipients,
  escalationDedupeKey,
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
