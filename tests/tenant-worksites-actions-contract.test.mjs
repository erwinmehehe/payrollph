import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  WORKSITES_ENDPOINT, WORKSITE_ACTIONS, requireDisposableWorksiteActions, assertWorksiteDenied, assertImmutableWorksiteSql,
} from "../scripts/qa/tenant-worksites-actions-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_TABLE_PROFILE: "allowlisted-reads", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000", TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000", DEMO_MODE: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  WFM_GEOFENCE_PILOT_ENABLED: "true", WFM_GEOFENCE_PILOT_ORG_IDS: "1,2,3",
  WFM_PUNCH_EVIDENCE_ENABLED: "true", WFM_PUNCH_EVIDENCE_ORG_IDS: "1,2,3",
  TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/payrollph-tenant-allowlist-Abc123/fixture.json",
};
const refuses = (change) => assert.throws(() => requireDisposableWorksiteActions({ ...safe, ...change }), /WORKSITE_ACTIONS_REFUSED|exact disposable/);

test("the guard accepts only the disposable GitHub Actions localhost shape", () => {
  assert.deepEqual(requireDisposableWorksiteActions(safe), [1, 2, 3]);
  for (const change of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { NODE_ENV: "development" }, { TENANT_SECOND_PASS_MODE: "" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.internal:5432/app_db" }, { SECURITY_SMOKE_URL: "https://example.com" },
    { WORKER_ENABLED: "true" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { PAYMONGO_SECRET_KEY: "sk_live_x" },
    { RESEND_API_KEY: "re_x" }, { TENANT_TABLE_ALLOWLIST_FIXTURE: "/home/runner/fixture.json" },
  ]) refuses(change);
});

test("both pilots must name exactly the three bootstrap-owned employers with a higher-ID victim", () => {
  refuses({ WFM_GEOFENCE_PILOT_ENABLED: "false" });
  refuses({ WFM_PUNCH_EVIDENCE_ENABLED: "false" });
  refuses({ WFM_GEOFENCE_PILOT_ORG_IDS: "1,2" });
  refuses({ WFM_GEOFENCE_PILOT_ORG_IDS: "1,2,3,4", WFM_PUNCH_EVIDENCE_ORG_IDS: "1,2,3,4" });
  refuses({ WFM_PUNCH_EVIDENCE_ORG_IDS: "1,2,4" });
  refuses({ WFM_GEOFENCE_PILOT_ORG_IDS: "3,2,1", WFM_PUNCH_EVIDENCE_ORG_IDS: "3,2,1" });
  refuses({ WFM_GEOFENCE_PILOT_ORG_IDS: "1,1,3", WFM_PUNCH_EVIDENCE_ORG_IDS: "1,1,3" });
});

const response = (status, json, text = JSON.stringify(json)) => ({ status, json, text, headers: new Headers() });

test("a denial must be the exact status, bounded, free of created objects and free of foreign markers", () => {
  assertWorksiteDenied(response(404, { error: "Worksite not found." }), 404, ["TTBL-VICTIM-X"]);
  assertWorksiteDenied(response(409, { error: "x" }), [404, 409]);
  assert.throws(() => assertWorksiteDenied(response(200, { error: "x" }), 404));
  assert.throws(() => assertWorksiteDenied(response(403, { error: "x" }), 404));
  assert.throws(() => assertWorksiteDenied(response(404, {}), 404), "no bounded error");
  assert.throws(() => assertWorksiteDenied(response(404, { error: "x", worksite: { id: 1 } }), 404), "a created object");
  assert.throws(() => assertWorksiteDenied(response(404, { error: "x", ok: true }), 404));
  assert.throws(() => assertWorksiteDenied(response(404, { error: "TTBL-VICTIM-X" }), 404, ["TTBL-VICTIM-X"]));
  assert.throws(() => assertWorksiteDenied(response(404, { error: "x" }, "y".repeat(2500)), 404));
});

test("a changed foreign snapshot is never accepted", () => {
  assertImmutableWorksiteSql({ worksites: [1], audit: [] }, { worksites: [1], audit: [] }, "victim");
  assert.throws(() => assertImmutableWorksiteSql({ worksites: [1], audit: [] }, { worksites: [1, 2], audit: [] }, "victim"));
});

test("the harness proves all ten route actions, both attackers, the victim, the pilot-off employer and SQL read-back", () => {
  assert.equal(WORKSITES_ENDPOINT, "/api/workforce/worksites");
  const route = readFileSync("src/app/api/workforce/worksites/route.ts", "utf8");
  const routeActions = [...route.matchAll(/action === "([a-z_]+)"/g)].map((m) => m[1]);
  for (const name of new Set(routeActions)) assert.ok(WORKSITE_ACTIONS.includes(name), "route action not covered by the proof list: " + name);
  assert.equal(new Set(WORKSITE_ACTIONS).size, WORKSITE_ACTIONS.length);
  const harness = readFileSync("scripts/qa/tenant-worksites-actions-http.mjs", "utf8");
  for (const action of WORKSITE_ACTIONS) {
    assert.ok(harness.includes('action: "' + action + '"') || harness.includes('"' + action + '"') || harness.includes("action, "),
      "harness never sends " + action);
  }
  for (const evidence of [
    "for (const actor of attackers)", "victim.site1.id", "victim.seedAuthorization.id", "excluded", "unchanged(before, label)",
    "assertImmutableWorksiteSql(before.get(other.org.id)", "Worksite created", "Employee worksite assigned", "HCM work arrangement set",
    "HCM secondary worksite authorized", "HCM worksite restricted", "HCM secondary worksite authorization ended",
    "Worksite selfie policy changed", "Worksite geofence configured", "Worksite geofence disabled", "Worksite updated",
    "requireDisposableWorksiteActions();",
  ]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposableWorksiteActions();") < harness.indexOf('import("../../src/db/index.ts")'),
    "the fail-closed guard must run before any database import");
});

test("the workflow runs the harness on PostgreSQL 16 only after the contract tests and the pilot step", () => {
  const workflow = readFileSync(".github/workflows/tenant-worksites-actions-http.yml", "utf8");
  assert.match(workflow, /image: postgres:16/);
  const order = ["node --test tests/tenant-worksites-actions-contract.test.mjs", "node --import tsx scripts/qa/tenant-table-allowlist-bootstrap.mjs",
    "WFM_GEOFENCE_PILOT_ORG_IDS=$ids", "npm run build", "node --import tsx scripts/qa/tenant-worksites-actions-http.mjs"].map((s) => workflow.indexOf(s));
  assert.ok(order.every((index) => index >= 0) && order.every((index, i) => i === 0 || index > order[i - 1]), "workflow steps are out of order");
  // Provider secrets may only be blanked (KEY=), never given a value, and no repository secret is referenced.
  assert.doesNotMatch(workflow, /secrets\.|PAYMONGO_SECRET_KEY=[^"\s]|XENDIT_SECRET_KEY=[^"\s]/);
});
