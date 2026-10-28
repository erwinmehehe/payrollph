import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  requireDisposablePerformancePolicyEnv, reminderView, evidenceView,
  proveOwnedPerformanceRead, proveOwnPolicyTransition, assertTenantStateUnchanged,
} from "../scripts/qa/tenant-performance-governance-contract.mjs";

const good = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
};
const owner = {
  orgId: 11, ownerId: 21, ownerName: "TTBL-ATTA owner",
  cycleId: 31, cycleName: "TTBL-ATTA fictional review cycle",
  reminderPolicyId: 41, evidencePolicyId: 51,
  nextReminderDays: 5, nextEscalationDays: 9, nextRetentionYears: 9,
};
const date = new Date("2026-10-27T13:00:00Z");
const reminder = {
  id: 41, organizationId: 11, version: 1, enabled: true,
  reminderDaysBefore: 3, escalationDaysOverdue: 4,
  notifyManagerOnEmployeeItem: true, notifyPeopleAdminOnEscalation: true,
  createdAt: date, updatedAt: date, updatedByUserId: owner.ownerId,
  updatedByName: owner.ownerName,
};
const evidence = {
  id: 51, organizationId: 11, version: 1, retentionYears: 4,
  autoSealCompletedCycles: true, allowPostSealAmendments: true,
  createdAt: date, updatedAt: date, updatedByUserId: owner.ownerId,
  updatedByName: owner.ownerName,
};
const base = {
  org: [{ id: 11 }], staff: [{ id: 12 }], entities: [{ id: 13 }],
  cycles: [{ id: 31, organizationId: 11, name: owner.cycleName }],
  reminder: [reminder], reminderEvents: [],
  evidence: [evidence], evidenceEvents: [],
  tasks: [], seals: [], amendments: [], payroll: [], audit: [],
};
const ownResponse = {
  status: 200,
  json: {
    cycles: base.cycles, reminderPolicy: reminderView(reminder),
    evidencePolicy: evidenceView(evidence), seals: [],
    reminderSummary: { open: 0, overdue: 0, escalated: 0, resolved: 0 },
  },
};

function makeTransition(kind, before = base) {
  const after = structuredClone(before);
  const isReminder = kind === "reminder";
  const old = after[kind][0];
  const next = { ...old, version: old.version + 1,
    updatedByUserId: owner.ownerId, updatedByName: owner.ownerName,
    updatedAt: new Date(date.getTime() + 2000) };
  if (isReminder) Object.assign(next, {
    enabled: false, reminderDaysBefore: owner.nextReminderDays,
    escalationDaysOverdue: owner.nextEscalationDays,
    notifyManagerOnEmployeeItem: false,
    notifyPeopleAdminOnEscalation: false,
  });
  else Object.assign(next, {
    retentionYears: owner.nextRetentionYears,
    autoSealCompletedCycles: false, allowPostSealAmendments: false,
  });
  after[kind] = [next];
  const view = isReminder ? reminderView : evidenceView;
  const eventField = isReminder ? "reminderEvents" : "evidenceEvents";
  after[eventField] = [...before[eventField], {
    id: 61 + before[eventField].length, organizationId: 11,
    policyId: old.id, fromVersion: old.version, toVersion: next.version,
    beforeSnapshot: view(old), afterSnapshot: view(next),
    actorUserId: owner.ownerId, actorName: owner.ownerName,
  }];
  after.audit = [...before.audit, {
    id: 71 + before.audit.length, organizationId: 11,
    actor: owner.ownerName,
    action: isReminder ? "Performance action reminder policy updated"
      : "Performance evidence retention policy updated",
    resource: isReminder ? "Performance follow-through"
      : "Performance evidence",
    metadata: { fromVersion: old.version, toVersion: next.version, after: view(next) },
  }];
  const response = {
    status: 200,
    json: { [isReminder ? "reminderPolicy" : "evidencePolicy"]: view(next) },
  };
  return { after, response };
}

test("preflight refuses all unsafe flags, external hostnames, credentials and missing keys", () => {
  assert.doesNotThrow(() => requireDisposablePerformancePolicyEnv(good));
  for (const [name, value] of Object.entries(good)) {
    const unsafe = value === "false" ? "true" : "false";
    assert.throws(() => requireDisposablePerformancePolicyEnv({ ...good, [name]: unsafe }),
      /PERFORMANCE_POLICY_REFUSED/, "flipped " + name);
    assert.throws(() => requireDisposablePerformancePolicyEnv({ ...good, [name]: undefined }),
      /PERFORMANCE_POLICY_REFUSED/, "missing " + name);
  }
  for (const secret of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "STRIPE_SECRET_KEY"]) {
    assert.throws(() => requireDisposablePerformancePolicyEnv({
      ...good, [secret]: "live-credential",
    }), /PERFORMANCE_POLICY_REFUSED/, "live credential " + secret);
  }
});

test("GET proof demands populated and persisted own policies and cycle", () => {
  assert.doesNotThrow(() => proveOwnedPerformanceRead(ownResponse, owner, base));
  for (const changes of [
    { ...owner, orgId: 999 }, { ...owner, cycleId: 999 },
    { ...owner, cycleName: "VICTIM CYCLE" },
  ]) assert.throws(() => proveOwnedPerformanceRead(ownResponse, changes, base));
  assert.throws(() => proveOwnedPerformanceRead({
    ...ownResponse, json: { ...ownResponse.json, cycles: [] },
  }, owner, base));
  assert.throws(() => proveOwnedPerformanceRead({
    ...ownResponse, json: {
      ...ownResponse.json, reminderPolicy: { ...ownResponse.json.reminderPolicy, version: 999 },
    },
  }, owner, base));
  assert.throws(() => proveOwnedPerformanceRead({
    ...ownResponse, json: {
      ...ownResponse.json, evidencePolicy: { ...ownResponse.json.evidencePolicy, retentionYears: 999 },
    },
  }, owner, base));
});

test("real reminder policy write must update saved actor, version, event and audit", () => {
  const { after, response } = makeTransition("reminder");
  assert.doesNotThrow(() => proveOwnPolicyTransition(base, after, owner, "reminder", response));
  assert.throws(() => proveOwnPolicyTransition(base, base, owner, "reminder", response),
    "HTTP 200 without actual persisted change is never accepted");
  const missingAudit = structuredClone(after);
  missingAudit.audit = [];
  assert.throws(() => proveOwnPolicyTransition(base, missingAudit, owner, "reminder", response));
  const wrongActor = structuredClone(after);
  wrongActor.reminder[0].updatedByUserId = 999;
  assert.throws(() => proveOwnPolicyTransition(base, wrongActor, owner, "reminder", response));
  const badEvent = structuredClone(after);
  badEvent.reminderEvents[0].organizationId = 999;
  assert.throws(() => proveOwnPolicyTransition(base, badEvent, owner, "reminder", response));
  const badPayroll = structuredClone(after);
  badPayroll.payroll.push({ id: 777 });
  assert.throws(() => proveOwnPolicyTransition(base, badPayroll, owner, "reminder", response));
});

test("real evidence policy write rejects false positive, wrong events and collateral", () => {
  const { after, response } = makeTransition("evidence");
  assert.doesNotThrow(() => proveOwnPolicyTransition(base, after, owner, "evidence", response));
  assert.throws(() => proveOwnPolicyTransition(base, base, owner, "evidence", response));
  const wrongEvidence = structuredClone(after);
  wrongEvidence.evidence[0].retentionYears = 99;
  assert.throws(() => proveOwnPolicyTransition(base, wrongEvidence, owner, "evidence", response));
  const badAudit = structuredClone(after);
  badAudit.audit[0].metadata.toVersion = 50;
  assert.throws(() => proveOwnPolicyTransition(base, badAudit, owner, "evidence", response));
  const badPrevious = structuredClone(after);
  badPrevious.reminder[0].version = 6;
  assert.throws(() => proveOwnPolicyTransition(base, badPrevious, owner, "evidence", response));
  const badEvent = structuredClone(after);
  badEvent.evidenceEvents[0].actorUserId = 999;
  assert.throws(() => proveOwnPolicyTransition(base, badEvent, owner, "evidence", response));
});

test("snapshots reject any real tenant business/audit change after denied operations", () => {
  assert.doesNotThrow(() => assertTenantStateUnchanged(base, structuredClone(base), "denied"));
  const changed = structuredClone(base);
  changed.cycles[0].name = "foreign";
  assert.throws(() => assertTenantStateUnchanged(base, changed, "denied"));
});

test("the proof does not grant method credit or change production authorization", () => {
  const route = readFileSync("src/app/api/performance/follow-through-governance/route.ts", "utf8");
  const runner = readFileSync("scripts/qa/tenant-performance-governance-http.mjs", "utf8");
  assert.match(route, /assertOrganizationRole/);
  assert.match(route, /PEOPLE_ADMIN_ROLES/);
  assert.match(route, /performanceActionReminderPolicies/);
  assert.match(route, /performanceEvidencePolicies/);
  assert.match(route, /requireSensitiveActionMfa/);
  assert.match(route, /expectedVersion !== currentVersion/);
  assert.ok(runner.indexOf("requireDisposablePerformancePolicyEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
  "disposable guard must run before importing any app/DB code");
  for (const requirement of [
    "assertTenantStateUnchanged", "proveOwnPolicyTransition",
    "foreignPatchDenials", "forgedCycleDenials", "roleDenials",
    "staleVersionDenials", "coverageCredits: 0",
  ]) assert.ok(runner.includes(requirement), requirement);
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const routeRecord = Object.values(manifest.allApiRouteFiles)
    .find(x => x.route === "performance/follow-through-governance");
  assert.equal(routeRecord?.methods?.find(x => x.name === "PATCH")?.status, "GAP",
    "this incomplete action-only proof may not grant method-level coverage");
});
