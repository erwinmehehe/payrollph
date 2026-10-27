/**
 * Pure, fail-closed evidence contracts for the isolated performance policy
 * tenant test. Only fictional localhost PostgreSQL 16 + production-mode HTTP
 * can count; this module grants no coverage credits.
 */
import assert from "node:assert/strict";

const REQUIRED = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
});
export function requireDisposablePerformancePolicyEnv(env = process.env) {
  for (const [key, value] of Object.entries(REQUIRED)) {
    assert.equal(env[key], value, "PERFORMANCE_POLICY_REFUSED: " + key + " must be disposable");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY"]) {
    assert.ok(!env[key], "PERFORMANCE_POLICY_REFUSED: live external provider credential " + key);
  }
}

export function reminderView(row) {
  return {
    version: row.version,
    enabled: row.enabled,
    reminderDaysBefore: row.reminderDaysBefore,
    escalationDaysOverdue: row.escalationDaysOverdue,
    notifyManagerOnEmployeeItem: row.notifyManagerOnEmployeeItem,
    notifyPeopleAdminOnEscalation: row.notifyPeopleAdminOnEscalation,
  };
}
export function evidenceView(row) {
  return {
    version: row.version,
    retentionYears: row.retentionYears,
    autoSealCompletedCycles: row.autoSealCompletedCycles,
    allowPostSealAmendments: row.allowPostSealAmendments,
  };
}

export function proveOwnedPerformanceRead(response, employer, expected) {
  assert.equal(response?.status, 200, "real own company-wide GET must return 200");
  assert.ok(response.json && typeof response.json === "object");
  assert.ok(Array.isArray(response.json.cycles) && response.json.cycles.length === 1,
    "nonempty owned performance cycle required; an empty successful GET is not proof");
  assert.equal(response.json.cycles[0].id, employer.cycleId);
  assert.equal(response.json.cycles[0].organizationId, employer.orgId);
  assert.equal(response.json.cycles[0].name, employer.cycleName);
  assert.equal(expected.reminder.length, 1);
  assert.equal(expected.evidence.length, 1);
  assert.deepEqual(response.json.reminderPolicy, reminderView(expected.reminder[0]),
    "actual GET reminder policy must match persisted own tenant");
  assert.deepEqual(response.json.evidencePolicy, evidenceView(expected.evidence[0]),
    "actual GET retention policy must match persisted own tenant");
  assert.deepEqual(response.json.seals, [], "fictional fixture has no sealed evidence");
  assert.deepEqual(response.json.reminderSummary,
    { open: 0, overdue: 0, escalated: 0, resolved: 0 });
}

export function assertTenantStateUnchanged(before, after, reason) {
  assert.deepEqual(after, before, reason + ": real protected tenant and audit state must be unchanged");
}

const PROTECTED = Object.freeze([
  "org", "staff", "entities", "cycles", "reminder", "reminderEvents",
  "evidence", "evidenceEvents", "tasks", "seals", "amendments",
  "payroll", "audit",
]);

export function proveOwnPolicyTransition(before, after, employer, kind, response) {
  assert.ok(["reminder", "evidence"].includes(kind), "only separately scoped policy actions allowed");
  assert.equal(response?.status, 200, "own company policy PATCH must return 200");
  const policyField = kind === "reminder" ? "reminderPolicy" : "evidencePolicy";
  const eventsField = kind === "reminder" ? "reminderEvents" : "evidenceEvents";
  const view = kind === "reminder" ? reminderView : evidenceView;
  const old = before[kind]?.[0], updated = after[kind]?.[0];
  assert.ok(old && updated, "real pre-existing own policy row is required");
  assert.equal(before[kind].length, 1);
  assert.equal(after[kind].length, 1);
  assert.equal(old.id, employer[kind + "PolicyId"]);
  assert.equal(updated.id, old.id);
  assert.equal(updated.organizationId, employer.orgId);
  assert.equal(updated.version, old.version + 1, "actual persisted policy must advance by one");
  assert.deepEqual(updated.createdAt, old.createdAt, "creation timestamp must remain immutable");
  assert.equal(updated.updatedByUserId, employer.ownerId);
  assert.equal(updated.updatedByName, employer.ownerName);
  assert.ok(updated.updatedAt instanceof Date &&
    updated.updatedAt.getTime() >= old.updatedAt.getTime());
  if (kind === "reminder") {
    assert.deepEqual(view(updated), {
      version: old.version + 1, enabled: false,
      reminderDaysBefore: employer.nextReminderDays,
      escalationDaysOverdue: employer.nextEscalationDays,
      notifyManagerOnEmployeeItem: false,
      notifyPeopleAdminOnEscalation: false,
    });
  } else {
    assert.deepEqual(view(updated), {
      version: old.version + 1, retentionYears: employer.nextRetentionYears,
      autoSealCompletedCycles: false, allowPostSealAmendments: false,
    });
  }
  assert.deepEqual(response.json?.[policyField], view(updated),
    "HTTP success body must identify the actual saved policy");

  for (const key of PROTECTED) {
    if (key !== kind && key !== eventsField && key !== "audit") {
      assert.deepEqual(after[key], before[key],
        kind + " must never change unrelated tenant table " + key);
    }
  }
  assert.equal(after[eventsField].length, before[eventsField].length + 1,
    "one immutable policy event per update");
  assert.deepEqual(after[eventsField].slice(0, -1), before[eventsField],
    "prior policy event rows must be unchanged");
  const event = after[eventsField].at(-1);
  assert.equal(event.organizationId, employer.orgId);
  assert.equal(event.policyId, old.id);
  assert.equal(event.fromVersion, old.version);
  assert.equal(event.toVersion, updated.version);
  assert.equal(event.actorUserId, employer.ownerId);
  assert.equal(event.actorName, employer.ownerName);
  assert.deepEqual(event.beforeSnapshot, view(old));
  assert.deepEqual(event.afterSnapshot, view(updated));

  assert.equal(after.audit.length, before.audit.length + 1,
    "one actor-attributed audit row must accompany each policy update");
  assert.deepEqual(after.audit.slice(0, -1), before.audit,
    "old audit rows must be preserved");
  const audit = after.audit.at(-1);
  assert.equal(audit.organizationId, employer.orgId);
  assert.equal(audit.actor, employer.ownerName);
  assert.equal(audit.action, kind === "reminder"
    ? "Performance action reminder policy updated"
    : "Performance evidence retention policy updated");
  assert.equal(audit.resource, kind === "reminder"
    ? "Performance follow-through" : "Performance evidence");
  assert.deepEqual(audit.metadata,
    { fromVersion: old.version, toVersion: updated.version, after: view(updated) });
}
