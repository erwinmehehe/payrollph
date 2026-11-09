import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDIO_TRIAGE_ORIGIN, STUDIO_TRIAGE_ROUTE_SHA, gitBlobSha,
  requireDisposableStudioTriageEnv, assertOwnedCaseAck, assertDeniedTriage,
  assertUnchangedSnapshot, assertOwnAcknowledgementDelta,
} from "../scripts/qa/tenant-studio-triage-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_STUDIO_TRIAGE_PROOF: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: STUDIO_TRIAGE_ORIGIN, TRUSTED_APP_ORIGINS: STUDIO_TRIAGE_ORIGIN,
  SECURITY_SMOKE_URL: STUDIO_TRIAGE_ORIGIN, REQUIRE_PRIVILEGED_MFA: "true",
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const actor = {
  label: "ATTA", marker: "TTBL-ATTA-000001", org: { id: 11 },
  case: { id: 77 }, owner: { id: 4, name: "Fictional operator" },
};
const victim = {
  label: "VICTIM", marker: "TTBL-VICTIM-000099", org: { id: 99 },
  case: { id: 199 }, owner: { id: 99 },
};
const response = (status, json = null) => ({ status, json,
  text: JSON.stringify(json ?? { error: "Denied" }) });

function beforeAfter() {
  const oldCase = {
    id: actor.case.id, organizationId: actor.org.id,
    title: actor.marker + " attendance review case",
    status: "open", acknowledgedByUserId: null, acknowledgedByName: null,
    acknowledgedAt: null, updatedAt: "2026-11-09T00:00:00.000Z",
    sourceId: 88, evidence: { fictional: true },
  };
  const before = {
    automationOperationalCases: [oldCase], auditEvents: [],
    attendanceExceptionEvents: [{ id: 88, status: "open", message: actor.marker }],
    payrollRuns: [], automationRules: [], outbox: [], employees: [{ id: 100 }],
  };
  const after = JSON.parse(JSON.stringify(before));
  Object.assign(after.automationOperationalCases[0], {
    status: "acknowledged", acknowledgedByUserId: actor.owner.id,
    acknowledgedByName: actor.owner.name,
    acknowledgedAt: "2026-11-09T01:00:00.000Z", updatedAt: "2026-11-09T01:00:00.000Z",
  });
  after.auditEvents.push({ organizationId: actor.org.id,
    action: "Automation operations case acknowledge",
    metadata: { caseId: actor.case.id, sourceMutation: false,
      underlyingExecutionStatusUnchanged: true } });
  return { before, after };
}

test("PG16-only proof refuses remote providers, release flags and invalid identities", () => {
  assert.doesNotThrow(() => requireDisposableStudioTriageEnv(safe));
  for (const changed of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "production" },
    { TENANT_STUDIO_TRIAGE_PROOF: "live" },
    { DATABASE_URL: "postgresql://anything@remote.example.invalid/app_db" },
    { APP_BASE_URL: "https://site.invalid" },
    { TRUSTED_APP_ORIGINS: "https://site.invalid" },
    { SECURITY_SMOKE_URL: "https://site.invalid" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { DEMO_MODE: "true" }, { WORKER_ENABLED: "true" },
    { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYROLL_CALCULATION_HISTORY_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "bad" }, { XENDIT_SECRET_KEY: "bad" },
    { OPENAI_API_KEY: "bad" }, { RESEND_API_KEY: "bad" },
  ]) assert.throws(() => requireDisposableStudioTriageEnv({ ...safe, ...changed }),
    /STUDIO_TRIAGE_REFUSED/, JSON.stringify(changed));
});

test("only an actual owned, persisted acknowledgement counts as own success", () => {
  const full = response(200, { operationalCase: {
    id: actor.case.id, organizationId: actor.org.id, status: "acknowledged",
    acknowledgedByUserId: actor.owner.id, title: actor.marker + " attendance review case",
  }, sourceMutation: false, executionStatusUnchanged: true });
  assert.doesNotThrow(() => assertOwnedCaseAck(full, actor, [victim]));
  for (const failure of [
    response(200, { ok: true }),
    response(201, full.json),
    response(200, { ...full.json, operationalCase: { ...full.json.operationalCase, id: victim.case.id } }),
    response(200, { ...full.json, operationalCase: { ...full.json.operationalCase, organizationId: victim.org.id } }),
    response(200, { ...full.json, operationalCase: { ...full.json.operationalCase, status: "open" } }),
    response(200, { ...full.json, sourceMutation: true }),
    response(200, { ...full.json, operationalCase: { ...full.json.operationalCase, title: victim.marker } }),
  ]) assert.throws(() => assertOwnedCaseAck(failure, actor, [victim]));
});

test("foreign denial requires the correct HTTP code and zero private employer markers", () => {
  assert.doesNotThrow(() => assertDeniedTriage(response(403), 403, [actor, victim], "foreign"));
  assert.doesNotThrow(() => assertDeniedTriage(response(404), 404, [actor, victim], "foreign case"));
  assert.throws(() => assertDeniedTriage(response(200), 403, [victim], "fake denied"));
  assert.throws(() => assertDeniedTriage(response(403, {
    operationalCase: { id: victim.case.id }, error: "Forbidden" }), 403, [victim], "private object"));
  assert.throws(() => assertDeniedTriage(response(403, {
    error: "Forbidden: " + victim.marker }), 403, [victim], "private marker"));
  assert.throws(() => assertDeniedTriage({ status: 403,
    json: { error: "Forbidden" }, text: "\\u0054TBL-VICTIM-000099" },
    403, [victim], "escaped marker"));
});

test("acknowledgement must make one bounded case change and exactly one own audit row", () => {
  const { before, after } = beforeAfter();
  assert.doesNotThrow(() => assertOwnAcknowledgementDelta(before, after, actor));
  assert.throws(() => assertOwnAcknowledgementDelta(before, before, actor));
  const withoutAudit = structuredClone(after);
  withoutAudit.auditEvents = [];
  assert.throws(() => assertOwnAcknowledgementDelta(before, withoutAudit, actor));
  const crossOrgAudit = structuredClone(after);
  crossOrgAudit.auditEvents[0].organizationId = victim.org.id;
  assert.throws(() => assertOwnAcknowledgementDelta(before, crossOrgAudit, actor));
  const changedSource = structuredClone(after);
  changedSource.attendanceExceptionEvents[0].status = "resolved";
  assert.throws(() => assertOwnAcknowledgementDelta(before, changedSource, actor));
  const hiddenCaseChange = structuredClone(after);
  hiddenCaseChange.automationOperationalCases[0].sourceId = 99;
  assert.throws(() => assertOwnAcknowledgementDelta(before, hiddenCaseChange, actor));
  assert.doesNotThrow(() => assertUnchangedSnapshot(before, structuredClone(before), "victim"));
  assert.throws(() => assertUnchangedSnapshot(before, after, "victim mutation"));
});

test("route proof pin is an exact Git blob SHA, not a loose string match", () => {
  assert.match(STUDIO_TRIAGE_ROUTE_SHA, /^[0-9a-f]{40}$/);
  assert.equal(gitBlobSha(Buffer.from("tenant")), "34f104e42d3d8d71271e2fdebce48d513fca39e3");
  assert.notEqual(gitBlobSha(Buffer.from("tenant")), gitBlobSha(Buffer.from("tenant!")));
});
