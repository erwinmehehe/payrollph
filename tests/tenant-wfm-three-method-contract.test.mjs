import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  WFM_THREE_METHODS, ROSTER_PREVIEW_ENDPOINT,
  requireDisposableWfmThreeMethods,
  assertOwnedRosterPreview, assertDeniedRosterPreview,
  assertRosterPreviewImmutable,
} from "../scripts/qa/tenant-wfm-three-method-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true",
  CI: "true",
  NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_TABLE_PROFILE: "flagged-reads",
  TENANT_GREEDY_ROSTER_MODE: "fictional-only",
  TENANT_WFM_THREE_METHOD_MODE: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
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

const own = {
  active: true, maxDailyMinutes: 620, maxRollingSevenDayMinutes: 2880,
  minRestBetweenShiftsMinutes: 660, ordinaryDailyMinutes: 480,
  approvedOvertimeCapMinutes: 0, enforcementMode: "block",
};
function response(json, status = 200, directives = "private, no-store") {
  return {
    status, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": directives }),
  };
}
function positive() {
  return response({
    ruleFindings: [], guardrailIssues: [], blocked: false,
    canOverrideCodes: [], policy: { ...own },
    message: "Preview only. No shift, payroll entry or approval was created.",
  });
}

test("three exact WFM methods have independently traceable provisional credits, no duplicates", () => {
  assert.equal(ROSTER_PREVIEW_ENDPOINT, "/api/workforce/roster-rules/preview");
  assert.deepEqual(WFM_THREE_METHODS, [
    "GET workforce/demand-staffing/policies",
    "GET workforce/greedy-roster",
    "POST workforce/roster-rules/preview",
  ]);
  const manifest = JSON.parse(readFileSync(
    new URL("../scripts/qa/tenant-isolation-coverage-manifest.json", import.meta.url), "utf8"));
  for (const method of WFM_THREE_METHODS) {
    const [verb, route] = method.split(" ");
    const file = "src/app/api/" + route + "/route.ts";
    const entry = manifest.allApiRouteFiles[file];
    assert.ok(entry, "manifest must contain exact route: " + file);
    const record = entry.methods.filter(m => m.name === verb);
    assert.equal(record.length, 1, "exact single method in canonical inventory");
    assert.equal(record[0].status, "COVERED",
      "only source-pinned, independently reviewable PostgreSQL proof may support provisional credit");
    assert.equal(record[0].testedBy?.workflowRunId, 41293308290);
    assert.equal(record[0].testedBy?.verifiedPrHeadSha, "a5c70e563580c5ab9cb6d8db7610f3950148a27e");
    assert.equal(record[0].testedBy?.independentSecurityReview, "PENDING");
    assert.equal(record[0].testedBy?.productionCertified, false);
  }
});

test("fail-closed fictional-only CI, worker-off, provider-off and localhost guard", () => {
  assert.doesNotThrow(() => requireDisposableWfmThreeMethods(safe));
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { TENANT_WFM_THREE_METHOD_MODE: undefined },
    { TENANT_WFM_THREE_METHOD_MODE: "live" },
    { TENANT_TABLE_PROFILE: "allowlisted-reads" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example.com/app_db" },
    { DATABASE_URL_DIRECT: "postgresql://shared.example" },
    { NEON_API_KEY: "fake-but-disallowed" },
    { SECURITY_SMOKE_URL: "https://payroll.example.test" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "disallowed" },
    { WFM_ROSTER_SCALE_RULES_ENABLED: "false" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
  ]) {
    assert.throws(() => requireDisposableWfmThreeMethods({ ...safe, ...patch }),
      "must refuse unsafe env change: " + JSON.stringify(patch));
  }
});

test("own POST must be populated source-bound SQL policy, never status 200 empty", () => {
  assert.doesNotThrow(() => assertOwnedRosterPreview(positive(), own, ["REAL-VICTIM-MARKER"]));
  for (const changed of [
    response({ ...positive().json, policy: { ...own, maxDailyMinutes: 720 } }),
    response({ ...positive().json, policy: null }),
    response({ ...positive().json, ruleFindings: null }),
    response({ ...positive().json, message: "Shift published" }),
    response({ ...positive().json }, 409),
    response({ ...positive().json }, 200, "public, max-age=3600"),
  ]) {
    assert.throws(() => assertOwnedRosterPreview(changed, own, ["REAL-VICTIM-MARKER"]));
  }
  const leak = positive();
  leak.text += " REAL-VICTIM-MARKER";
  assert.throws(() => assertOwnedRosterPreview(leak, own, ["REAL-VICTIM-MARKER"]));
});

test("foreign/missing and role denials must not leak source, SQL or false success", () => {
  assert.doesNotThrow(() =>
    assertDeniedRosterPreview(response({ error: "Employee outside authorized scope." }, 403),
      403, ["PRIVATE-VICTIM"]));
  for (const wrong of [
    response({ error: "Forbidden" }, 200),
    response({ error: "Forbidden", policy: { ...own } }, 403),
    response({ error: "SELECT * FROM employees" }, 403),
    response({ error: "PRIVATE-VICTIM" }, 403),
    response({ error: "node_modules/driver" }, 403),
    response({ message: "No worker" }, 403),
  ]) {
    assert.throws(() => assertDeniedRosterPreview(wrong, 403, ["PRIVATE-VICTIM"]));
  }
});

test("source route boundaries and dedicated two-profile executable workflow remain explicit", () => {
  function source(path) {
    return readFileSync(new URL("../" + path, import.meta.url), "utf8");
  }
  const policy = source("src/app/api/workforce/demand-staffing/policies/route.ts");
  const greedy = source("src/app/api/workforce/greedy-roster/route.ts");
  const preview = source("src/app/api/workforce/roster-rules/preview/route.ts");
  const workflow = source(".github/workflows/tenant-wfm-three-method-http.yml");
  const runner = source("scripts/qa/tenant-wfm-three-method-post-http.mjs");
  for (const marker of [
    "assertOrganizationRole", "getAccess", "verifiedSite",
    "eq(jobProfiles.organizationId,organizationId)", "readStaffingPolicies",
  ]) assert.ok(policy.includes(marker), "policy GET must retain " + marker);
  for (const marker of [
    "assertOrganizationRole", "getAccess", "previewEmployerGreedyRoster",
    "criticalReleaseFlagEnabled",
  ]) assert.ok(greedy.includes(marker), "greedy GET must retain " + marker);
  for (const marker of [
    "assertOrganizationRole", "assertScope", "getAccess", "requireSensitiveActionMfa",
    "eq(employees.organizationId,organizationId)",
    "eq(worksites.organizationId,organizationId)",
    "eq(shiftDefinitions.organizationId,organizationId)",
    "checkWfmRosterPublish",
  ]) assert.ok(preview.includes(marker), "POST scope must retain " + marker);
  for (const marker of [
    "postgres:16", "allowlisted-reads", "flagged-reads",
    "tenant-wrk01-greedy-roster-http.mjs",
    "tenant-wfm-three-method-post-http.mjs",
    "tenant-demand-approved-policy-get-http.mjs",
    "tenant-table-allowlist-bootstrap.mjs",
    "TENANT_WFM_THREE_METHOD_MODE=fictional-only",
    "persist-credentials: false",
  ]) assert.ok(workflow.includes(marker), "CI must execute or constrain " + marker);
  for (const marker of [
    "assertOwnedRosterPreview", "assertDeniedRosterPreview",
    "assertUnchanged(baseline", "assertUnchanged(revokedBaseline",
    "foreignEmployee.text", "foreignSite.text", "foreignShift.text",
    "seedEmployer", "randomUUID", "requireDisposableWfmThreeMethods",
  ]) assert.ok(runner.includes(marker), "real SQL/HTTP runner must retain " + marker);
  assert.ok(!workflow.includes("workflow_dispatch:"),
    "candidate must not become a manually triggered production control");
});

test("unchanged SQL snapshots are mandatory after own POST and every denial", () => {
  assert.doesNotThrow(() => assertRosterPreviewImmutable({ rows: [1] }, { rows: [1] }, "own"));
  assert.throws(() => assertRosterPreviewImmutable(
    { rows: [1] }, { rows: [1, 2] }, "cross-employer"));
});
