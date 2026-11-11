import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ORIGIN, PAGE, GRAPH, HISTORY, SOURCE_PINS,
  verifySources, requireFictionalEnvironment, assertNoTenantLeak,
  assertOwnPage, assertOwnGraph, assertOwnHistory, assertDenied, assertSqlUnchanged
} from "../scripts/qa/tenant-hcm-org-explorer-page-contract.mjs";

const actor = {
  org: { id: 8 }, unit: { id: 30 }, worker: { id: 25 },
  position: { id: 72 }, assignment: { id: 92 },
  marker: "OWN-EMPLOYER-8", secrets: ["PRIVATE-OWN-TIN"]
};
const victim = {
  org: { id: 10 }, unit: { id: 40 }, worker: { id: 35 },
  position: { id: 82 }, assignment: { id: 102 },
  marker: "FOREIGN-EMPLOYER-10", secrets: ["PRIVATE-VICTIM-BANK"]
};
const res = (status, body, json = null) => ({
  status, text: body, json, headers: new Headers({ "Cache-Control": "private, no-store" })
});
const env = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_ORG_EXPLORER_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  SECURITY_SMOKE_URL: ORIGIN, HCM_ORG_EXPLORER_ENABLED: "true",
  HCM_ORG_EXPLORER_ORG_IDS: "8,9,10",
  HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false"
};

test("source seal covers SSR, both APIs, SQL loader, auth, roles and client", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 10);
  assert.equal(verifySources(), true);
  assert.throws(() => verifySources(path =>
    path === "src/app/hcm/org-explorer/page.tsx" ?
      Buffer.from("tampered") : readFileSync(path)), /changed reviewed source/);
  const runner = readFileSync("scripts/qa/tenant-hcm-org-explorer-page-http.mjs", "utf8");
  assert.match(runner, /requireFictionalEnvironment\(\);[\s\S]*verifySources\(\);[\s\S]*import\("\.\.\/\.\.\/src\/db\/index\.ts"\)/);
  assert.match(runner, /SHOW server_version_num/);
  assert.match(runner, /seedEmployer/);
  assert.match(runner, /assertOwnPage\(/);
  assert.match(runner, /assertOwnGraph\(/);
  assert.match(runner, /assertOwnHistory\(/);
  assert.match(runner, /assertSqlUnchanged\(/);
  assert.match(runner, /loggedInAfterRevoke/);
  assert.match(runner, /pageActionCredits: 0, apiMethodCredits: 0/);
  assert.match(runner, /duplicateApiSelectorsProven: false/);
});

test("fictional PG16 environment refuses remote database, enabled money and credentials", () => {
  assert.equal(requireFictionalEnvironment(env), true);
  for (const patch of [
    { DATABASE_URL: "postgresql://example.com/live" },
    { APP_BASE_URL: "https://prod.example" },
    { NODE_ENV: "development" }, { GITHUB_ACTIONS: "false" },
    { HCM_ORG_EXPLORER_ENABLED: "false" },
    { HCM_ORG_EXPLORER_ORG_IDS: "8,9,10,11" },
    { WORKER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { OPENAI_API_KEY: "live-secret" }, { SMTP_URL: "smtp://real" }
  ]) assert.throws(() => requireFictionalEnvironment({ ...env, ...patch }),
    /ORG_EXPLORER_PROOF_REFUSED/);
});

test("nonempty authorized page and API data cannot be forged by status alone", () => {
  assert.doesNotThrow(() => assertOwnPage(
    res(200, "<h1>Organizations &amp; Positions</h1>organizationId=8"),
    actor, [actor, victim]));
  assert.throws(() => assertOwnPage(res(200, "empty shell"), actor, [actor, victim]));

  const goodGraph = { tenantId: 8, units: [{ id: 30 }],
    positions: [{ id: 72 }] };
  assert.doesNotThrow(() => assertOwnGraph(
    res(200, JSON.stringify(goodGraph), goodGraph), actor, [actor, victim]));
  assert.throws(() => assertOwnGraph(res(200, "{}", { tenantId: 8,
    units: [], positions: [] }), actor, [actor, victim]), /persisted org unit/);
  assert.throws(() => assertOwnGraph(res(200, "{}",
    { ...goodGraph, tenantId: 10 }), actor, [actor, victim]),
    /selected employer/);

  const goodHistory = { tenantId: 8, positionId: 72,
    history: { preview: { items: [{ id: 92, employeeId: 25 }] } } };
  assert.doesNotThrow(() => assertOwnHistory(
    res(200, JSON.stringify(goodHistory), goodHistory), actor, [actor, victim]));
  assert.throws(() => assertOwnHistory(res(200, "{}", {
    ...goodHistory, history: { preview: { items: [] } }
  }), actor, [actor, victim]), /real employer-bound worker/);
});

test("all denials reject foreign identifiers and secret data, even on 404", () => {
  assert.doesNotThrow(() => assertDenied(res(404, "Not Found"), 404,
    [actor, victim], "page"));
  assert.throws(() => assertDenied(res(200, "empty"), 404,
    [actor, victim], "fake page denial"));
  assert.throws(() => assertDenied(res(404, victim.marker), 404,
    [actor, victim], "leaked employer"));
  assert.throws(() => assertDenied(res(403, victim.secrets[0]), 403,
    [actor, victim], "leaked private field"));
  assert.throws(() => assertDenied(res(403, "{}",
    { tenantId: 8, positions: [] }), 403, [actor, victim], "denied data"));
  assert.throws(() => assertNoTenantLeak(
    res(200, actor.secrets[0]), [actor, victim], "own private PII", actor));
});

test("employer and audit snapshots must remain byte-identical after GETs", () => {
  const before = { organizations: [{ id: 8 }],
    employees: [{ id: 25 }], auditEvents: [] };
  assert.doesNotThrow(() => assertSqlUnchanged(
    before, structuredClone(before), "read-only"));
  assert.throws(() => assertSqlUnchanged(before, {
    ...before, auditEvents: [{ id: 1 }]
  }, "hidden audit mutation"));
});

test("proof is not release/coverage acceptance and checks both browser and API paths", () => {
  assert.equal(PAGE, "/hcm/org-explorer");
  assert.equal(GRAPH, "/api/hcm/org-explorer");
  assert.equal(HISTORY, "/api/hcm/position-history");
  const workflow = readFileSync(".github/workflows/tenant-hcm-org-explorer-page-qa.yml", "utf8");
  const docs = readFileSync("docs/qa/tenant-hcm-org-explorer-page-isolation.md", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /tenant-hcm-org-explorer-page-http\.mjs/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(docs, /ZERO credits/);
  assert.match(docs, /NOT ACCEPTED/);
});