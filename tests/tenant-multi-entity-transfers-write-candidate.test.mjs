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

test("POST and PATCH transfer failures never expose unexpected SQL diagnostics", () => {
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.ok(post.includes('return fail("Could not request transfer.");'),
    "POST SQL errors must use a fixed message");
  assert.ok(route.includes("class TransferDecisionConflict extends Error"),
    "Only a typed business conflict may be shown to users");
  assert.ok(patch.includes("error instanceof TransferDecisionConflict"),
    "PATCH must not classify safe exceptions using database-provided message text");
  assert.equal((patch.match(/throw new TransferDecisionConflict\(/g) ?? []).length, 9,
    "All nine existing business-conflict throw sites must be typed");
  assert.doesNotMatch(patch, /throw new Error\(/,
    "Raw Error instances in PATCH must not be exposed as reviewer conflicts");
  assert.ok(patch.includes('error.message : "Transfer could not be decided."'),
    "Unknown PATCH failures must use a fixed response");
  assert.doesNotMatch(post, /return fail\(error instanceof Error \? error\.message/,
    "POST must not echo database driver diagnostics");
  assert.doesNotMatch(patch, /return fail\(error instanceof Error \? error\.message/,
    "PATCH must not echo database driver diagnostics");
  for (const message of [
    "Transfer decision was changed. Reload.", "Review conflict.",
    "Source employer or service date changed. Request a new review.",
    "Historical assignment is missing or move date is invalid.",
    "New payroll appeared after approval; cannot mix employers.",
    "Concurrent transfer conflict.", "The worker changed concurrently.",
    "Transfer already applied.",
  ]) assert.ok(route.includes(JSON.stringify(message)),
    "Explicit business conflict should remain available: " + message);
  assert.match(workflow, /MULTI_ENTITY_TRANSFERS_ENABLED: "true"/);
  assert.match(proof, /for \(const attacker of \[attackerB, attackerC\]\)/);
  assert.match(proof, /assert\.deepEqual\(await snapshot\(2\), victimBefore/);
  for (const marker of [
    "CREATE TRIGGER ci_transfer_post_error",
    "CREATE TRIGGER ci_transfer_patch_error",
    "DROP TRIGGER IF EXISTS ci_transfer_post_error",
    "DROP TRIGGER IF EXISTS ci_transfer_patch_error",
    'deniedFault.data?.error === "Could not request transfer."',
    'deniedFault.data?.error === "Transfer could not be decided."',
    "CI_INTERNAL_DATABASE_DIAGNOSTIC",
    "assert.deepEqual(await snapshot(1), beforePostFault",
    "assert.deepEqual(await snapshot(1), beforePatchFault",
  ]) assert.ok(proof.includes(marker), "Missing synthetic real-HTTP SQL-fault verification: " + marker);
});
