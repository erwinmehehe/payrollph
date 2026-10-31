import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/multi-entity/transfers/route.ts", "utf8");
const proof = readFileSync("scripts/qa/tenant-multi-entity-transfers-write-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("transfer write handlers retain independent employer, MFA, and maker-checker controls", () => {
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.match(route, /export async function PATCH\(request: Request\)/);
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));
  const patch = route.slice(route.indexOf("export async function PATCH"));
  for (const handler of [post, patch]) {
    assert.match(handler, /criticalReleaseFlagEnabled\("multiEntityTransfers"\)/);
    assert.match(handler, /enforceSameOriginMutation\(request\)/);
    assert.match(handler, /getSessionUser\(\)/);
    assert.match(handler, /resolveMultiEntityContext\(/);
    assert.match(handler, /canActOnEntityTransfer\(/);
    assert.match(handler, /requireSensitiveActionMfa\(user\)/);
    assert.match(handler, /db\.transaction\(/);
    assert.match(handler, /auditEvents/);
  }
  assert.match(post, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /eq\(employees\.legalEntityId, scope\.context\.legalEntityId\)/);
  assert.match(post, /eq\(legalEntities\.organizationId, organizationId\)/);
  assert.match(patch, /eq\(entityTransferRequests\.organizationId, organizationId\)/);
  assert.match(patch, /makerUserId: requestRow\.requestedByUserId/);
  assert.match(patch, /if \(action === "apply"/);
  assert.match(route, /summarizeEntityTransfer\(created\)/);
  assert.match(route, /summarizeEntityTransfer\(result\)/);
});

test("PG16 real-HTTPS transfer write fixture is the only proposed family and never promotes itself", () => {
  assert.match(proof, /GITHUB_ACTIONS", "true"/);
  assert.match(proof, /DATABASE_URL", "postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db"/);
  assert.match(proof, /const ownCreated = status\(await call\(a, "POST"/);
  assert.match(proof, /const rejected = status\(await call\(b, "PATCH"/);
  assert.match(proof, /const approved = status\(await call\(b, "PATCH"/);
  assert.match(proof, /const applied = status\(await call\(b, "PATCH"/);
  assert.match(proof, /for \(const attacker of \[attackerB, attackerC\]\)/);
  assert.match(proof, /assert\.deepEqual\(await snapshot\(2\), victimBefore/);
  assert.match(proof, /methodCredits: 0, independentlyAccepted: false/);
  assert.match(workflow, /MULTI_ENTITY_TRANSFERS_ENABLED: "true"/);
  assert.match(workflow, /node scripts\/qa\/tenant-multi-entity-transfers-write-http\.mjs/);
  assert.match(workflow, /MULTI_ENTITY_QA_MODE: synthetic-postgres-only/);
  assert.match(workflow, /image: postgres:16/);
  const methods = manifest.allApiRouteFiles["src/app/api/multi-entity/transfers/route.ts"].methods;
  assert.deepEqual(methods.map(m => [m.name, m.status]),
    [["GET", "COVERED"], ["POST", "GAP"], ["PATCH", "GAP"]],
    "First new run must pass and receive independent review before earning any credits");
});
