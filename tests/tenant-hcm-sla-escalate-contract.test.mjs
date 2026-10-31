import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/hcm/work-items/escalate/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const proof = readFileSync("scripts/qa/tenant-hcm-sla-escalate-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-hcm-sla-escalate-http.yml", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("SLA scheduler has a token-only gate before any cross-employer write", () => {
  assert.match(route, /HCM_SLA_CRON_SECRET/);
  assert.match(route, /timingSafeEqual\(a, b\)/);
  assert.match(route, /if \(!authorized\(request\)\) return Response\.json\(\{ error: "Unauthorized\."/);
  assert.ok(route.indexOf("if (!authorized(request))") <
    route.indexOf("const client = await pool.connect()"),
    "Token check must precede all DB work");
  assert.doesNotMatch(route, /getSessionUser\(/,
    "Authenticated browser cookies are not scheduler authorization");
  assert.match(route, /FOR UPDATE SKIP LOCKED/);
  assert.match(route, /escalated_at IS NULL/);
  assert.match(route, /WHERE uo\.organization_id=\$1 AND uo\.active=true/);
  assert.match(route, /item\.organization_id, recipient\.email/);
  assert.match(route, /"hcm-sla:" \+ item\.organization_id/);
});

test("SLA outbox dedupe references the existing partial unique index", () => {
  assert.ok(schema.includes('uniqueIndex("outbox_dedupe_key_unique").on(table.dedupeKey)'));
  assert.match(schema, /table\.dedupeKey\} is not null/);
  assert.match(route, /ON CONFLICT \(dedupe_key\) WHERE dedupe_key IS NOT NULL DO NOTHING/);
  assert.match(route, /await client\.query\("BEGIN"\)/);
  assert.match(route, /await client\.query\("COMMIT"\)/);
  assert.match(route, /await client\.query\("ROLLBACK"\)/);
});

test("disposable PG16 proof denies tenant sessions and cross-employer notifications", () => {
  for (const key of [
    '["GITHUB_ACTIONS", "true"]',
    '["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"]',
    '["WORKER_ENABLED", "false"]',
    '["CENTRAL_SCHEDULER_ENABLED", "false"]',
    'authorization: "Bearer " + process.env.HCM_SLA_CRON_SECRET',
    'authenticatedTenantCookieDenied: true',
    'assert.deepEqual(await snapshot("audit_events", org.orgId)',
    'assert.deepEqual(await snapshot("payroll_runs", org.orgId)',
    "foreignEmailsObserved: 0",
    "methodCredits: 0, independentSecurityAcceptance: false",
  ]) assert.ok(proof.includes(key), "Missing isolation proof guard: " + key);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /scripts\/qa\/prepare-hcm-work-item-fixture\.mjs/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-sla-escalate-http\.mjs/);
  const methods = manifest.allApiRouteFiles["src/app/api/hcm/work-items/escalate/route.ts"].methods;
  assert.equal(methods.length, 1);
  assert.equal(methods[0].name, "POST");
  assert.equal(methods[0].status, "GAP", "No credits before exact-head CI and security review");
});
