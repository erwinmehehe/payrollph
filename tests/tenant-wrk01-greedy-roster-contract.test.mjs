import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  METHOD, ENDPOINT, requireDisposableGreedyRoster,
  assertGreedyNoStore, assertNoGreedyLeak, assertOwnGreedyRoster,
  assertGreedyDenied, assertGreedySqlUnchanged,
} from "../scripts/qa/tenant-wrk01-greedy-roster-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_TABLE_PROFILE: "flagged-reads",
  TENANT_GREEDY_ROSTER_MODE: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test", DEMO_MODE: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WFM_GREEDY_ROSTER_ENABLED: "true",
  WFM_ROSTER_SCALE_RULES_ENABLED: "true",
  REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_TOKEN: "ci-worker-token-test-only",
};
const actor = {
  label: "ATTA", org: { id: 1 }, site: { id: 21 },
  worker: { id: 11 }, requirement: { id: 17 },
  workDate: "2026-11-04", headcount: 2,
};
const foreign = "TTBL-VICTIM-SENTINEL";
function success() {
  const json = {
    status: "review_required",
    automaticallyPublished: false,
    roster: [],
    unfilled: [1, 2].map(position => ({
      requirementId: 17,
      workDate: actor.workDate, position,
      reason: "site_ineligible",
      evidence: [{ code: "site_ineligible", candidates: 1 }],
    })),
    summary: {
      required: 2, existing: 0, suggested: 0, unfilled: 2,
      fairnessProjectedMinutes: [{
        employeeId: 11, scheduledMinutes: 0, unpopularShifts: 0,
      }],
    },
    source: {
      organizationId: 1, worksiteId: 21,
      startDate: actor.workDate, endDate: actor.workDate,
      slotCount: 1, candidateCount: 1,
      sourceVersion: "wfm-greedy-roster-v1",
    },
    boundary: "Suggestion only. No roster, payroll or funds were changed.",
  };
  return {
    status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": "no-store, max-age=0" }),
  };
}
function own(x) { return assertOwnGreedyRoster(x, actor, [foreign]); }

test("fail closed before any DB import: strict GitHub Actions disposable PG16/local host and worker/provider OFF", () => {
  assert.doesNotThrow(() => requireDisposableGreedyRoster(safe));
  for (const patch of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { NODE_ENV: "development" },
    { TENANT_SECOND_PASS_MODE: "regular" }, { TENANT_TABLE_PROFILE: "default" },
    { TENANT_GREEDY_ROSTER_MODE: "live" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require" },
    { SECURITY_SMOKE_URL: "https://other.example.com" },
    { SECURITY_SMOKE_URL: "http://localhost:3000" },
    { APP_BASE_URL: "https://payrollph.com" },
    { DEMO_MODE: "true" },
    { WFM_GREEDY_ROSTER_ENABLED: "false" },
    { WFM_ROSTER_SCALE_RULES_ENABLED: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_TOKEN: "prod" }, { NEON_API_KEY: "live" },
    { DATABASE_URL_DIRECT: "postgresql://live" },
    { PAYMONGO_SECRET_KEY: "live" }, { RESEND_API_KEY: "live" },
    { VERCEL_ENV: "production" },
  ]) {
    assert.throws(() => requireDisposableGreedyRoster({ ...safe, ...patch }),
      undefined, JSON.stringify(patch));
  }
});

test("own positive must be genuine SQL-bound staffing requirements, not a cached or empty 200", () => {
  own(success());
  const modifiers = [
    x => { x.status = 404; },
    x => { x.status = 409; },
    x => { x.json.source.organizationId = 3; },
    x => { x.json.source.worksiteId = 999; },
    x => { x.json.source.slotCount = 0; },
    x => { x.json.source.candidateCount = 0; },
    x => { x.json.source.sourceVersion = "unverified"; },
    x => { x.json.unfilled = []; },
    x => { x.json.unfilled[0].requirementId = 999; },
    x => { x.json.unfilled[0].reason = "no_workers"; },
    x => { x.json.unfilled[0].evidence[0].candidates = 0; },
    x => { x.json.summary.required = 0; },
    x => { x.json.summary.fairnessProjectedMinutes[0].employeeId = 999; },
    x => { x.json.roster.push({ employeeId: 3 }); },
    x => { x.json.automaticallyPublished = true; },
    x => { x.json.payroll = true; },
    x => { x.headers.delete("Cache-Control"); },
    x => { x.headers.set("Cache-Control", "public, no-store"); },
    x => { x.headers.set("Cache-Control", "no-store, max-age=180"); },
    x => { x.headers.set("X-Worker", foreign); },
    x => { x.text += foreign; },
  ];
  for (const mutate of modifiers) {
    const response = success();
    mutate(response);
    assert.throws(() => own(response));
  }
});

test("private no-store allows Next.js normalization but rejects public or stale reuse", () => {
  for (const value of ["private, no-store", "no-store", "no-store, max-age=0"]) {
    assert.doesNotThrow(() => assertGreedyNoStore(new Headers({
      "Cache-Control": value,
    })));
  }
  for (const value of ["private, max-age=0", "no-cache",
    "public, no-store", "no-store, max-age=10",
    "no-store, s-maxage=0", "no-store, immutable",
    "no-store, stale-while-revalidate=1", "no-storex"]) {
    assert.throws(() => assertGreedyNoStore(new Headers({
      "Cache-Control": value,
    })));
  }
});

test("denials must not include roster source, foreign PII markers or victim audit", () => {
  const response = {
    status: 403, json: { error: "Authorized manager required." },
    text: '{"error":"Authorized manager required."}', headers: new Headers(),
  };
  assertGreedyDenied(response, 403, [foreign]);
  for (const variant of [
    { ...response, status: 404 },
    { ...response, json: { error: "Denied", unfilled: [] } },
    { ...response, json: { error: "Denied", source: { organizationId: 3 } } },
    { ...response, text: response.text + foreign },
    { ...response, headers: new Headers({ "X-Tenant": foreign }) },
  ]) assert.throws(() => assertGreedyDenied(variant, 403, [foreign]));
  assert.doesNotThrow(() => assertNoGreedyLeak(success(), [foreign]));
  assertGreedySqlUnchanged({ audit: [], runs: [] }, { audit: [], runs: [] }, "victim");
  assert.throws(() => assertGreedySqlUnchanged(
    { audit: [], runs: [] }, { audit: [], runs: [23] }, "victim"));
});

test("live tenant manifest remains GAP, with no guessed proof credits", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles[
    "src/app/api/workforce/greedy-roster/route.ts"];
  assert.equal(entry.route, "workforce/greedy-roster");
  assert.equal(METHOD, "GET workforce/greedy-roster");
  assert.equal(ENDPOINT, "/api/workforce/greedy-roster");
  const method = entry.methods.find(x => x.name === "GET");
  assert.equal(method.status, "GAP");
  assert.equal(method.testedBy, null);
});

test("focused CI actually runs same-method PostgreSQL/localhost source, forged and immutable controls", () => {
  const script = readFileSync(
    "scripts/qa/tenant-wrk01-greedy-roster-http.mjs", "utf8");
  const workflow = readFileSync(
    ".github/workflows/tenant-wrk01-greedy-roster-http.yml", "utf8");
  const route = readFileSync(
    "src/app/api/workforce/greedy-roster/route.ts", "utf8");
  const server = readFileSync(
    "src/lib/workforce-greedy-roster-server.ts", "utf8");
  assert.ok(script.indexOf("requireDisposableGreedyRoster();") >= 0 &&
    script.indexOf("requireDisposableGreedyRoster();") <
    script.indexOf('import("../../src/db/index.ts")'),
  "the strict gate must execute before any database import");
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
    'seedEmployer("VICTIM"', "staffingRequirements",
    "employeeWorksiteAssignments", "decision: \"deny\"",
    "assertOwnGreedyRoster", "assertGreedyDenied", "assertAllUnchanged",
    "victim.requirement.id", "secondUnitMarker", "managerSession",
    "employeeSession", "active: false", "originals.get(actor.org.id)",
    "payrollEntries", "auditEvents", "forged", "stolen higher-ID worksite",
  ]) assert.ok(script.includes(marker), "missing source proof anchor: " + marker);
  for (const marker of [
    "postgres:16", "tenant-table-env.mjs flagged-reads",
    "WFM_GREEDY_ROSTER_ENABLED=true", "WFM_ROSTER_SCALE_RULES_ENABLED=true",
    "npm run db:push", "apply-isolated-baseline.mjs",
    "node --test tests/tenant-wrk01-greedy-roster-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-wrk01-greedy-roster-http.mjs",
  ]) assert.ok(workflow.includes(marker), "missing executable GH Actions step " + marker);
  for (const marker of [
    "assertOrganizationRole", "getAccess", "getSessionUser",
    "previewEmployerGreedyRoster", "criticalReleaseFlagEnabled",
  ]) assert.ok(route.includes(marker), "source auth proof missing " + marker);
  for (const marker of [
    "eq(worksites.organizationId,organizationId)",
    "eq(staffingRequirements.organizationId,organizationId)",
    "eq(employees.organizationId,organizationId)",
    "organizationId,worksiteId,startDate,endDate",
    "planGreedyRoster",
  ]) assert.ok(server.includes(marker),
    "source must remain employer-scoped before solving: " + marker);
});
