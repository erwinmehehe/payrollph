import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEMAND_RECOVERY_METHODS, requireDisposableDemandRecovery,
  assertDemandDenial, assertBoundDemandRead, assertImmutableDemandSources,
} from "../scripts/qa/tenant-demand-governance-recovery-contract.mjs";
import { createRows } from "../scripts/qa/tenant-table-rows/read/demand-governance.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_TABLE_PROFILE: "allowlisted-reads",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test", DEMO_MODE: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WFM_OPERATIONAL_DEMAND_ENABLED: "true",
  WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "true",
  WFM_DEMAND_STAFFING_POLICIES_ENABLED: "true",
  TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/payrollph-tenant-allowlist-AbC123/fixture.json",
  WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "11,12,14",
  WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS: "11,12,14",
  WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS: "11,12,14",
};
const secretNames = [
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
];
const sha = "a".repeat(64);
const ctx = {
  orgId: 11, seeded: { id: 71, siteId: 41, hash: sha, sourceKey: "ttbl_att_a" },
  victim: { marker: "TTBL-VICTIM-private" }, forbiddenMarkers: ["TTBL-ATTB-private"],
};
const sqlIssue = { id: 71, organizationId: 11, worksiteId: 41,
  sourceKey: ctx.seeded.sourceKey, snapshotSha256: sha };
const sqlPolicy = { id: 71, organizationId: 11, worksiteId: 41,
  contentSha256: sha, status: "draft" };
const mock = (kind) => {
  const row = kind === "issued" ? {
    id: 71, organizationId: 11, worksiteId: 41, sourceKey: ctx.seeded.sourceKey,
    snapshotSha256: sha, integrity: "matches_issued_hash",
    snapshot: { scope: { organizationId: 11, worksiteId: 41 } },
  } : {
    id: 71, organizationId: 11, worksiteId: 41, contentSha256: sha,
    status: "draft", approvalIntegrity: "matches_hash", approvalReceiptSha256: null,
  };
  const json = kind === "issued" ? { readOnly: true, issued: [row] }
    : { readOnly: true, policies: [row] };
  return { status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "cache-control": "private, no-store" }) };
};
const denial = status => {
  const json = { error: "Unavailable for this employer." };
  return { status, json, text: JSON.stringify(json), headers: new Headers() };
};

test("two genuine current-main GAP methods, no blanket credit or shared-row edit", () => {
  assert.deepEqual(DEMAND_RECOVERY_METHODS, [
    "GET workforce/demand-observations/issued", "GET workforce/demand-staffing/policies",
  ]);
  const rows = createRows({ assert });
  assert.deepEqual(rows.map(row => row.key), DEMAND_RECOVERY_METHODS);
  for (const row of rows) {
    assert.equal(row.profile, "allowlisted-reads");
    assert.equal(row.status ?? 200, 200);
    assert.equal(row.deny ?? 403, 403);
    for (const key of ["seed", "query", "foreignQuery", "prove"]) {
      assert.equal(typeof row[key], "function");
    }
  }
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const key of DEMAND_RECOVERY_METHODS) {
    const [method, route] = key.split(" ");
    const found = Object.values(manifest.allApiRouteFiles).find(x => x.route === route);
    assert.equal(found?.methods?.find(x => x.name === method)?.status, "GAP");
    assert.equal(found?.methods?.find(x => x.name === method)?.testedBy, null);
  }
});

test("strict pre-import boundary accepts only fake allowlisted PG16 GitHub CI shape", () => {
  assert.equal(requireDisposableDemandRecovery(safe), undefined);
  for (const [key, value] of Object.entries(safe)) {
    assert.throws(() => requireDisposableDemandRecovery({ ...safe, [key]: undefined }),
      /DEMAND_RECOVERY_REFUSED|AssertionError/, key);
    assert.throws(() => requireDisposableDemandRecovery({ ...safe, [key]: "danger" }),
      /DEMAND_RECOVERY_REFUSED|AssertionError/, key);
  }
});

test("reject real provider credentials and any worker, money, hosted or broad feature target", () => {
  for (const key of secretNames) {
    assert.throws(() => requireDisposableDemandRecovery({ ...safe, [key]: "live-secret" }),
      /DEMAND_RECOVERY_REFUSED/, key);
  }
  for (const bad of [
    { DATABASE_URL: "postgresql://somehost.example.com/main" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" },
    { SECURITY_SMOKE_URL: "https://production.example.com" },
    { TENANT_TABLE_PROFILE: "default" }, { WORKER_ENABLED: "true" },
    { CENTRAL_SCHEDULER_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "false" },
    { TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/unsafe.json" },
    { WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS: "11,12" },
    { WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "*" },
  ]) assert.throws(() => requireDisposableDemandRecovery({ ...safe, ...bad }));
});

test("issued own GET is tied to real SQL ID, employer, worksite, hash and private cache", () => {
  assert.equal(assertBoundDemandRead("issued", mock("issued"), ctx, sqlIssue).id, 71);
});

test("unapproved staffing policy GET binds SQL row and does not counterfeit approval", () => {
  assert.equal(assertBoundDemandRead("policy", mock("policy"), ctx, sqlPolicy).status, "draft");
});

test("tampered response and source rows cannot be reused as another employer's proof", () => {
  for (const kind of ["issued", "policy"]) {
    const persisted = kind === "issued" ? sqlIssue : sqlPolicy;
    for (const change of [
      x => { x.response.json[kind === "issued" ? "issued" : "policies"][0].id = 999; },
      x => { x.response.json[kind === "issued" ? "issued" : "policies"][0].organizationId = 14; },
      x => { x.response.json[kind === "issued" ? "issued" : "policies"][0].worksiteId = 140; },
      x => { x.response.json[kind === "issued" ? "issued" : "policies"][0]
        [kind === "issued" ? "snapshotSha256" : "contentSha256"] = "b".repeat(64); },
      x => { x.persisted.organizationId = 14; },
      x => { x.persisted.id = 72; },
      x => { x.response.json[kind === "issued" ? "issued" : "policies"].length = 0; },
      x => { x.response.json[kind === "issued" ? "issued" : "policies"][0]
        [kind === "issued" ? "integrity" : "approvalIntegrity"] = "source_review"; },
      x => { x.response.headers = new Headers({ "cache-control": "public" }); },
      x => { x.response.headers = new Headers({ "x-tenant-debug": ctx.victim.marker }); },
      x => { x.ctx.orgId = 12; },
    ]) {
      const x = { response: mock(kind), persisted: structuredClone(persisted),
        ctx: structuredClone(ctx) };
      change(x);
      x.response.text = JSON.stringify(x.response.json);
      assert.throws(() => assertBoundDemandRead(kind, x.response, x.ctx, x.persisted));
    }
  }
});

test("foreign, forged, invalid and excluded responses require bounded 400/401/403/404", () => {
  for (const code of [400, 401, 403, 404]) {
    assert.equal(assertDemandDenial(denial(code), code, [ctx.victim.marker]), undefined);
  }
  for (const wrong of [
    { ...denial(403), status: 200 },
    { ...denial(403), json: { issued: [{ id: 71 }] } },
    { ...denial(403), text: '{"error":"TTBL-VICTIM-private"}' },
    { ...denial(403), headers: new Headers({ "x-owner": ctx.victim.marker }) },
  ]) assert.throws(() => assertDemandDenial(wrong, 403, [ctx.victim.marker]));
});

test("complete source/audit snapshots reject even one changed row", () => {
  const before = { issues: [{ id: 1, hash: sha }], policies: [{ id: 2, status: "draft" }],
    staffingEvents: [], audit: [], payroll: [], membership: [{ id: 4, active: true }] };
  assert.equal(assertImmutableDemandSources(before, structuredClone(before), "victim"), undefined);
  for (const key of Object.keys(before)) {
    const altered = structuredClone(before);
    altered[key].push({ id: 999 });
    assert.throws(() => assertImmutableDemandSources(before, altered, key));
  }
});

test("route source retains active employer, real worksite, role, policy and hash guards", () => {
  const issued = readFileSync("src/app/api/workforce/demand-observations/issued/route.ts", "utf8");
  const policy = readFileSync("src/app/api/workforce/demand-staffing/policies/route.ts", "utf8");
  for (const [source, text] of [
    [issued, "issuedDemandPilotAllowed(organizationId)"],
    [issued, "getAccess(user.id, organizationId)"],
    [issued, "scopedWorksite(organizationId, worksiteId, access)"],
    [issued, "fetchIssuedDemandForecasts({ organizationId, worksiteId })"],
    [policy, "staffingPolicyPilotAllowed(organizationId"],
    [policy, "getAccess(user.id,organizationId)"],
    [policy, "verifiedSite(organizationId,worksiteId,access)"],
    [policy, "readStaffingPolicies({"],
  ]) assert.ok(source.includes(text), "route tenant gate changed: " + text);
  const source = readFileSync(
    "scripts/qa/tenant-demand-governance-recovery-http.mjs", "utf8");
  for (const text of [
    "readAllowlistPreseed", "workforceDemandForecastIssues",
    "workforceDemandForecastScores", "workforceDemandStaffingPolicies",
    "workforceDemandStaffingPolicyEvents", "workforceDemandObservationRevisions",
    "assertImmutableDemandSources(", "rolePolicies", "stolen-worksite",
    "genuine victim higher-ID job-profile selector",
    "all own, victim, foreign, forged and negative GETs",
  ]) assert.ok(source.includes(text), "supplemental real PG16 proof missing: " + text);
});
