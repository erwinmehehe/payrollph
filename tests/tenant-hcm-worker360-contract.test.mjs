import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, AS_OF, SOURCE_PINS, gitBlobSha, verifyWorker360SourcePins,
  requireDisposableWorker360Env, assertOwnPage, assertOwnWorkerApi,
  assertDenied, assertNoForeignOrPrivateMarkers, assertUnchangedSql,
} from "../scripts/qa/tenant-hcm-worker360-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_HCM_WORKER360_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: ORIGIN, APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  HCM_WORKER_360_ENABLED: "true", HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
};
const actor = {
  label: "ATTA", org: { id: 11 }, marker: "TTBL-ATTA-fake",
  privateBank: "PRIVATE-BANK-ATTA", privateTax: "PRIVATE-TAX-ATTA",
  privateEventReason: "PRIVATE-NOTES-ATTA",
};
const victim = { label: "VICTIM", marker: "TTBL-VICTIM-fake" };
const employee = {
  id: 21, employeeNo: actor.marker, firstName: "Table",
  lastName: actor.marker, title: "Fictional", status: "Active",
  startDate: "2026-01-05",
};
const assignment = {
  id: 31, positionId: 32, assignmentType: "primary",
  effectiveFrom: "2026-01-01", effectiveUntil: null,
};
const events = [
  { id: 45, effectiveDate: "2026-07-12", eventType: "assignment", positionAssignmentId: 31 },
  { id: 40, effectiveDate: "2026-03-01", eventType: "hire", positionAssignmentId: 31 },
];
const payload = {
  tenantId: 11, employeeId: 21, asOfDate: AS_OF,
  observedAt: "2026-11-09T12:00:00.000Z",
  worker: {
    source: "employees", id: 21, employeeNo: employee.employeeNo,
    name: [employee.firstName, employee.lastName].join(" "),
    currentTitle: employee.title, currentStatus: employee.status,
    startedOn: employee.startDate,
  },
  primaryAssignment: {
    source: "position_assignments",
    selection: { status: "recorded", assignment },
  },
  employmentEvents: {
    source: "worker_employment_events",
    preview: { items: events, hasMore: false, partial: false, nextCursor: null },
  },
};
const response = (status = 200, body = payload, cache = "private, no-store") => ({
  status, json: body, text: JSON.stringify(body),
  headers: new Headers({ "Cache-Control": cache }),
});

test("strict disposable fictitious CI PG16 environment rejects live data and providers", () => {
  assert.doesNotThrow(() => requireDisposableWorker360Env(safe));
  const bad = [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "live" },
    { TENANT_HCM_WORKER360_PROOF: "live" },
    { DATABASE_URL: "postgresql://db.example.org/prod" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" },
    { APP_BASE_URL: "https://production.invalid" },
    { TRUSTED_APP_ORIGINS: "https://production.invalid" },
    { SECURITY_SMOKE_URL: "https://production.invalid" },
    { HCM_WORKER_360_ENABLED: "false" },
    { HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true" },
    { DEMO_MODE: "true" }, { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { EXACT_THIRTEENTH_CENTAVOS_ENABLED: "true" },
    { FINAL_PAY_SIGNED_REVIEW_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "bad" }, { XENDIT_SECRET_KEY: "bad" },
    { OPENAI_API_KEY: "bad" }, { MALWARE_SCAN_URL: "https://scanner.invalid" },
    { CRON_SECRET: "bad" }, { WORKER_TOKEN: "bad" },
  ];
  for (const variation of bad)
    assert.throws(() => requireDisposableWorker360Env({ ...safe, ...variation }),
      /WORKER360_REFUSED/, JSON.stringify(variation));
});

test("own worker API must carry exact persisted employee assignment and history", () => {
  assert.doesNotThrow(() => assertOwnWorkerApi(
    response(), actor, employee, assignment, events, [victim]));
  const altered = [
    response(200, { ...payload, tenantId: 12 }),
    response(200, { ...payload, employeeId: 99 }),
    response(200, { ...payload, worker: { ...payload.worker, id: 99 } }),
    response(200, { ...payload, worker: { ...payload.worker, name: victim.marker } }),
    response(200, { ...payload, worker: { ...payload.worker, employeeNo: "FICTITIOUS" } }),
    response(200, { ...payload, primaryAssignment: {
      ...payload.primaryAssignment, selection: {
        status: "recorded", assignment: { ...assignment, positionId: 999 },
      },
    } }),
    response(200, { ...payload, employmentEvents: {
      ...payload.employmentEvents, preview: {
        ...payload.employmentEvents.preview,
        items: [events[0], { ...events[1], id: 777 }],
      },
    } }),
    response(200, { ...payload, employmentEvents: {
      ...payload.employmentEvents, preview: {
        ...payload.employmentEvents.preview,
        items: [{ ...events[0], effectiveDate: "2027-01-01" }, events[1]],
      },
    } }),
    response(200, { ...payload, employmentEvents: {
      ...payload.employmentEvents, preview: { ...payload.employmentEvents.preview,
        hasMore: true, nextCursor: { id: 40, effectiveDate: "2026-03-01" } },
    } }),
    response(200, { ...payload, worker: { ...payload.worker, bankAccount: actor.privateBank } }),
    response(200, { ...payload, privateNote: actor.privateTax }),
    response(200, { ...payload, notes: actor.privateEventReason }),
    response(200, { ...payload, employerInfo: victim.marker }),
    response(200, payload, "public,max-age=60"),
    response(204, payload),
  ];
  for (const result of altered) assert.throws(() => assertOwnWorkerApi(
    result, actor, employee, assignment, events, [victim]));
});

test("same-employer second employee cannot inherit the first worker's history", () => {
  const second = { ...employee, id: 22, employeeNo: actor.marker + "-SECOND",
    lastName: actor.marker + "-SECOND" };
  const clean = {
    ...payload, employeeId: second.id,
    worker: { ...payload.worker, id: second.id, employeeNo: second.employeeNo,
      name: [second.firstName, second.lastName].join(" ") },
    primaryAssignment: { ...payload.primaryAssignment,
      selection: { status: "not_recorded", assignment: null } },
    employmentEvents: { ...payload.employmentEvents, preview: {
      items: [], hasMore: false, partial: false, nextCursor: null,
    } },
  };
  assert.doesNotThrow(() => assertOwnWorkerApi(
    response(200, clean), actor, second, null, [], [victim]));
  assert.throws(() => assertOwnWorkerApi(
    response(200, { ...clean, primaryAssignment: payload.primaryAssignment }),
    actor, second, null, [], [victim]));
});

test("SSR shell and denial controls cannot silently turn into fake success", () => {
  const html = {
    status: 200,
    text: "<h1>Worker 360</h1> Employer ID 11 Worker ID 21 organizationId=11",
  };
  assert.doesNotThrow(() => assertOwnPage(html, actor, employee, [victim]));
  assert.throws(() => assertOwnPage({ status: 200, text: "Worker 360" },
    actor, employee, [victim]));
  assert.throws(() => assertOwnPage({
    status: 200, text: html.text + " " + victim.marker,
  }, actor, employee, [victim]));
  assert.doesNotThrow(() => assertDenied(response(403, { error: "Denied" }),
    403, [actor, victim], "foreign"));
  assert.throws(() => assertDenied(response(200), 403, [actor, victim], "fake denial"));
  assert.throws(() => assertDenied(response(403, { worker: payload.worker }),
    403, [actor, victim], "exposed worker"));
  assert.throws(() => assertDenied(response(403, { note: victim.marker }),
    403, [actor, victim], "exposed marker"));
  assert.throws(() => assertNoForeignOrPrivateMarkers({
    text: actor.privateBank,
  }, [], actor, "private bank"));
  const unchanged = { employees: [{ id: 21 }], events: [{ id: 45 }], audit: [] };
  assert.doesNotThrow(() => assertUnchangedSql(
    unchanged, structuredClone(unchanged), "read"));
  assert.throws(() => assertUnchangedSql(
    unchanged, { ...unchanged, events: [] }, "write"));
});

test("exact source pins gate runtime authorization and worker-scoped SQL projections", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 14);
  assert.ok(Object.values(SOURCE_PINS).every(x => /^[0-9a-f]{40}$/.test(x)));
  assert.equal(gitBlobSha("tenant"), "34f104e42d3d8d71271e2fdebce48d513fca39e3");
  assert.notEqual(gitBlobSha("tenant"), gitBlobSha("tenant!"));
  if (process.env.CI === "true" || existsSync("src/app/hcm/worker-360/page.tsx"))
    assert.equal(verifyWorker360SourcePins(), true);
});
