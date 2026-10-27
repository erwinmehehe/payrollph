/**
 * Independent POST /api/workforce-planning/allocations tenant proof contracts.
 * Synthetic PG16 / localhost Next only; no production, payroll or coverage credit.
 */
import assert from "node:assert/strict";

const SAFE_ENV = Object.freeze({
  CI: "true", GITHUB_ACTIONS: "true",
  NODE_ENV: "production", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
});

export function requireDisposablePlanningEnv(env = process.env) {
  for (const [key, expected] of Object.entries(SAFE_ENV)) {
    assert.equal(env[key], expected, "WFP_ALLOCATION_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "STRIPE_SECRET_KEY", "SMTP_PASSWORD",
  ]) {
    assert.ok(!env[key], "WFP_ALLOCATION_REFUSED: provider credential " + key);
  }
  assert.notEqual(env.HCM_ENTERPRISE_PLAN_GATE_ENABLED, "true",
    "WFP_ALLOCATION_REFUSED: advanced paid plan gate may not be activated for synthetic proof");
}

export function assertNoStateChange(before, after, reason) {
  assert.deepEqual(after, before, reason + ": every protected business and audit row must stay unchanged");
}

export function assertOwnedPlanningRead(response, employer, snapshot) {
  assert.equal(response.status, 200, "own authenticated planning GET must succeed");
  assert.ok(response.json && typeof response.json === "object");
  assert.equal(response.json.access?.companyWide, true);
  assert.equal(response.json.access?.canManageAllocations, true);
  assert.ok(Array.isArray(snapshot.allocations) && snapshot.allocations.length >= 1,
    "persisted allocation positive cannot be empty");
  assert.ok(Array.isArray(response.json.allocations));
  assert.equal(response.json.allocations.length, snapshot.allocations.length);
  for (const saved of snapshot.allocations) {
    const row = response.json.allocations.find(value => value.id === saved.id);
    assert.ok(row, "real seeded allocation must be returned by HTTP: " + saved.id);
    assert.equal(row.organizationId, employer.orgId);
    assert.equal(row.planId, employer.planId);
    assert.equal(row.orgUnitId, saved.orgUnitId);
    assert.equal(row.headcountCeiling, saved.headcountCeiling);
    assert.equal(row.annualBudgetCeiling, saved.annualBudgetCeiling);
    assert.ok(row.orgUnitName.includes(employer.marker));
  }
  assert.ok(Array.isArray(response.json.submissions));
  assert.equal(response.json.submissions.length, snapshot.submissions.length);
  for (const saved of snapshot.submissions) {
    const row = response.json.submissions.find(value => value.id === saved.id);
    assert.ok(row, "real persisted manager draft must be visible to its employer");
    assert.equal(row.organizationId, employer.orgId);
    assert.equal(row.planId, employer.planId);
    assert.equal(row.allocationId, saved.allocationId);
    assert.equal(row.status, saved.status);
    assert.equal(row.rationale, saved.rationale);
  }
}

const UNCHANGED = Object.freeze([
  "organization", "entities", "units", "staff", "payProfiles", "plans",
  "scenarios", "payroll", "punches",
]);

function auditDelta(before, after, actor, action, resource, metadata) {
  assert.equal(after.audits.length, before.audits.length + 1,
    "one actual actor-bound audit row must be inserted");
  assert.deepEqual(after.audits.slice(0, -1), before.audits,
    "existing audit business fields must remain intact");
  const row = after.audits.at(-1);
  assert.equal(row.organizationId, actor.orgId);
  assert.equal(row.actor, actor.ownerName);
  assert.equal(row.action, action);
  assert.equal(row.resource, resource);
  assert.deepEqual(row.metadata, metadata);
}

function assertOtherTables(before, after, except) {
  for (const key of UNCHANGED) {
    assert.deepEqual(after[key], before[key], key + " changed during planning-only POST");
  }
  assert.deepEqual(after[except === "allocations" ? "submissions" : "allocations"],
    before[except === "allocations" ? "submissions" : "allocations"],
    "other planning row type must not be touched");
}

export function assertOwnAllocationCreated(before, after, employer, response) {
  assert.equal(response.status, 201, "real own allocation POST must return 201");
  assertOtherTables(before, after, "allocations");
  assert.equal(after.allocations.length, before.allocations.length + 1,
    "one real inserted top-down allocation required");
  assert.deepEqual(after.allocations.slice(0, before.allocations.length), before.allocations,
    "seeded allocations cannot be modified by creation");
  const row = after.allocations.at(-1);
  assert.equal(response.json?.allocation?.id, row.id);
  assert.equal(row.organizationId, employer.orgId);
  assert.equal(row.planId, employer.planId);
  assert.equal(row.orgUnitId, employer.newUnitId);
  assert.equal(row.headcountCeiling, employer.headcount);
  assert.equal(row.annualBudgetCeiling, employer.budget.toFixed(2));
  assert.equal(row.notes, employer.notes);
  assert.equal(row.createdByUserId, employer.ownerId);
  assert.equal(row.updatedByUserId, employer.ownerId);
  assert.equal(response.json.allocation.organizationId, employer.orgId);
  assert.equal(response.json.allocation.orgUnitId, employer.newUnitId);
  assert.equal(response.json.allocation.annualBudgetCeiling, employer.budget.toFixed(2));
  auditDelta(before, after, employer, "Workforce plan allocation saved",
    employer.planName + " · " + employer.newUnitName,
    { allocationId: row.id, planId: employer.planId, orgUnitId: employer.newUnitId,
      headcountCeiling: employer.headcount, annualBudgetCeiling: employer.budget });
  return row.id;
}

export function assertOwnManagerDraftCreated(before, after, employer, allocationId, response) {
  assert.equal(response.status, 201, "real own manager draft POST must return 201");
  assertOtherTables(before, after, "submissions");
  assert.equal(after.submissions.length, before.submissions.length + 1,
    "one real manager draft row required");
  assert.deepEqual(after.submissions.slice(0, before.submissions.length), before.submissions,
    "existing manager draft records may not be overwritten");
  const row = after.submissions.at(-1);
  assert.equal(response.json?.submission?.id, row.id);
  assert.equal(row.organizationId, employer.orgId);
  assert.equal(row.planId, employer.planId);
  assert.equal(row.orgUnitId, employer.newUnitId);
  assert.equal(row.allocationId, allocationId);
  assert.equal(row.status, "draft");
  assert.equal(row.version, 1);
  assert.equal(row.createdByUserId, employer.ownerId);
  assert.equal(row.requestedHeadcount, employer.requestHeadcount);
  assert.equal(row.requestedAnnualBudget, employer.requestBudget.toFixed(2));
  assert.equal(row.rationale, employer.rationale);
  assert.equal(row.allocationSnapshot?.allocationId, allocationId);
  assert.equal(row.allocationSnapshot?.orgUnitId, employer.newUnitId);
  assert.equal(row.allocationSnapshot?.headcountCeiling, employer.headcount);
  assert.equal(row.allocationSnapshot?.annualBudgetCeiling, employer.budget);
  assert.equal(row.allocationSnapshot?.planBudget, employer.planBudget);
  assert.equal(response.json.submission.organizationId, employer.orgId);
  auditDelta(before, after, employer, "Workforce manager request drafted",
    employer.planName + " · org unit #" + employer.newUnitId + " · v1",
    { submissionId: row.id, allocationId, planId: employer.planId,
      orgUnitId: employer.newUnitId, requestedHeadcount: employer.requestHeadcount,
      requestedAnnualBudget: employer.requestBudget });
  return row.id;
}
