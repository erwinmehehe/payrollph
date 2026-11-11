import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableDisciplineEntityEnv } from "../scripts/qa/tenant-discipline-entity-http.mjs";

const route = readFileSync(new URL("../src/app/api/discipline/route.ts", import.meta.url), "utf8");
const get = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
const post = route.slice(route.indexOf("export async function POST("), route.indexOf("export async function PATCH("));
const patch = route.slice(route.indexOf("export async function PATCH("));

test("HR discipline list joins case and worker by the same employer and employee", () => {
  assert.match(get, /eq\(disciplinaryCases\.organizationId, organizationId\)/);
  assert.match(get, /\.innerJoin\(employees, and\(\s*eq\(disciplinaryCases\.employeeId, employees\.id\),\s*eq\(disciplinaryCases\.organizationId, employees\.organizationId\)/);
  assert.match(get, /assertOrganizationRole\(/);
  assert.match(get, /getAccess\(user\.id, organizationId\)/);
  assert.match(get, /eq\(employees\.orgUnitId, access\.orgUnitId!\)/);
  assert.match(post, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /assertScope\(access, employee\.orgUnitId\)/);
});

test("disciplinary GET, POST and PATCH bind authorized legal-employer scope before private data or actions", () => {
  for (const [method, handler] of [["GET", get], ["POST", post], ["PATCH", patch]]) {
    const resolve = handler.indexOf("resolveMultiEntityContext(");
    const workerEntity = handler.indexOf("legalEntityId === null ? undefined : eq(employees.legalEntityId, legalEntityId)");
    assert.ok(resolve >= 0 && workerEntity > resolve, method + ": legal-employer policy must precede worker SQL");
    assert.match(handler, /entityAccess\.context\.group \|\| entityAccess\.context\.legalEntityId === null/,
      method + ": group and ambiguous context must fail closed");
  }
  assert.ok(get.indexOf("resolveMultiEntityContext(") < get.indexOf("const cases = await db.select("),
    "GET must resolve legal employer before selecting disciplinary cases");
  assert.ok(post.indexOf("resolveMultiEntityContext(") < post.indexOf("db.select().from(employees)"),
    "POST must resolve legal employer before selecting target worker");
  assert.match(post, /requested: body\.legalEntityId/,
    "POST must reconcile body with header and query selectors");
  assert.match(patch, /requested: body\.legalEntityId/,
    "PATCH must reconcile body with header and query selectors");
  assert.ok(patch.indexOf("resolveMultiEntityContext(") < patch.indexOf("const [employee]"),
    "PATCH must authorize case worker legal employer before mutations");
  assert.match(patch, /inArray\(\s*disciplinaryCases\.employeeId,[\s\S]*eq\(employees\.legalEntityId, legalEntityId\)/,
    "PATCH must recheck current legal-employer association in update SQL");
  assert.equal((patch.match(/db\.update\(disciplinaryCases\)/g) ?? []).length, 4);
  assert.equal((patch.match(/currentLegalEmployerScope,\s*\)\)\.returning\(\)/g) ?? []).length, 4,
    "all four disciplinary actions must retain the write-time legal employer check");
});

test("ID-only PATCH resolves a case inside the current active employer memberships first", () => {
  assert.match(patch, /enforceSameOriginMutation\(request\)/);
  assert.match(patch, /getSessionUser\(\)/);
  assert.match(patch, /\.select\(\{ discCase: disciplinaryCases \}\)\s*\.from\(disciplinaryCases\)\s*\.innerJoin\(userOrganizations, and\(/);
  for (const predicate of [
    "eq(userOrganizations.userId, user.id)",
    "eq(userOrganizations.organizationId, disciplinaryCases.organizationId)",
    "eq(userOrganizations.active, true)",
    "eq(disciplinaryCases.id, id)",
  ]) assert.ok(patch.includes(predicate), "missing membership lookup predicate: " + predicate);

  const found = patch.indexOf("const discCase = membershipBoundCase?.discCase;");
  const missing = patch.indexOf('if (!discCase) return Response.json({ error: "Disciplinary case unavailable." }, { status: 403 });');
  const role = patch.indexOf("const denied = await assertOrganizationRole(");
  const scope = patch.indexOf("const scope = assertScope(access, employee.orgUnitId);");
  assert.ok(found > 0 && missing > found && role > missing && scope > role,
    "foreign and missing IDs must be denied identically before role, worker or case-state disclosure");
  assert.doesNotMatch(patch, /db\.select\(\)\.from\(disciplinaryCases\)\.where\(eq\(disciplinaryCases\.id, id\)\)/);
  assert.match(patch, /if \(!employee\) return Response\.json\(\{ error: "Disciplinary case unavailable\." \}, \{ status: 403 \}\)/,
    "Real out-of-scope cases and nonexistent IDs must have indistinguishable refusal bodies and status");
});

test("all four decisions bind the final update to case, employer and employee, and reject lost targets", () => {
  const actions = ["submit_explanation", "schedule_hearing", "issue_nod", "close"];
  const codeBlocks = [...patch.matchAll(/if \(action === "(submit_explanation|schedule_hearing|issue_nod|close)"\) \{([\s\S]*?)(?=\n  if \(action === |\n  return Response\.json\(\{ error: "Unknown disciplinary action\.)/g)];
  assert.deepEqual(codeBlocks.map((entry) => entry[1]), actions);

  for (const [, action, block] of codeBlocks) {
    assert.match(block, /\.where\(and\(\s*eq\(disciplinaryCases\.id, id\),\s*eq\(disciplinaryCases\.organizationId, discCase\.organizationId\),\s*eq\(disciplinaryCases\.employeeId, discCase\.employeeId\),\s*currentLegalEmployerScope,\s*\)\)\.returning\(\)/,
      action + ": final write must be bound to employer and original employee");
    assert.match(block, /if \(!updated\) return Response\.json\(\{ error: "Disciplinary case changed\. Refresh\." \}, \{ status: 409 \}\)/,
      action + ": changed target must fail closed");
    assert.ok(block.indexOf('if (!updated)') < block.indexOf("return Response.json(updated)"),
      action + ": fail closed before success");
    assert.doesNotMatch(block, /\.where\(eq\(disciplinaryCases\.id, id\)\)/,
      action + ": unqualified case-ID write is forbidden");
  }
});

test("existing real-PG16 ownership and foreign-denial cases remain referenced without new credits", () => {
  const read = readFileSync("scripts/qa/tenant-table-rows/read/people.mjs", "utf8");
  const write = readFileSync("scripts/qa/tenant-table-rows/write/people.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
  assert.match(read, /key: "GET discipline"/);
  assert.match(write, /key: "POST discipline"/);
  assert.match(write, /key: "PATCH discipline"/);
  assert.match(write, /foreignBody: \(c\) => \(\{ id: c\.victimSeeded\.id/);
  assert.match(workflow, /postgres:\s*\n\s*image: postgres:16/);
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-write-table-http\.mjs/);

  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const methods = manifest.allApiRouteFiles["src/app/api/discipline/route.ts"].methods;
  assert.deepEqual(methods.map(({ name, status }) => [name, status]),
    [["GET", "COVERED"], ["POST", "COVERED"], ["PATCH", "COVERED"]],
    "do not promote or remove any previously credited method");
  for (const method of methods) assert.ok(method.testedBy?.file, method.name + ": retain historical test evidence");
});

test("new real-HTTP discipline proof refuses non-disposable environments and provider secrets", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_DISCIPLINE_ENTITY_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    MULTI_ENTITY_ENABLED: "true", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  assert.equal(requireDisposableDisciplineEntityEnv(safe), true);
  for (const modified of [
    { CI: "false" }, { NODE_ENV: "development" },
    { DATABASE_URL: "postgresql://company.invalid/real" },
    { MULTI_ENTITY_ENABLED: "false" }, { DEMO_MODE: "true" },
    { TENANT_DISCIPLINE_ENTITY_PROOF: "live" },
    { SECURITY_SMOKE_URL: "https://production.invalid" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "live-secret" },
    { RESEND_API_KEY: "live-secret" },
  ]) assert.throws(() => requireDisposableDisciplineEntityEnv({ ...safe, ...modified }),
    /DISCIPLINE_REFUSED/);
});

test("two legal employers in one company have real owned HTTP methods, foreign denials, unchanged victim SQL and grant revocation", () => {
  const proof = readFileSync("scripts/qa/tenant-discipline-entity-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-discipline-entity-qa.yml", "utf8");
  for (const required of [
    "requireDisposableDisciplineEntityEnv();",
    'fixture.seedEmployer("ATTA"',
    'fixture.seedEmployer("ATTB"',
    'fixture.seedEmployer("VICTIM"',
    'userId: b.owner.id, organizationId: a.org.id, role: "hr"',
    "const caseV = await createCase(victim.org.id, victim.worker.id",
    "caseV.id > Math.max(caseA.id, caseB.id)",
    "const own = await request(GET(a.org.id, actor.entityId), actor.cookie)",
    'const posted = await request(API, actor.cookie, "POST", postBody(actor))',
    'const own = await request(API, actor.cookie, "PATCH", payload)',
    'const refused = await request(API, actor.cookie, "POST", foreignWorker)',
    'await unchanged(beforeForeign, "cross-entity POST")',
    "await db.delete(s.userLegalEntityGrants)",
    "assert.equal(ownGets, 2)",
    "assert.equal(ownPosts, 2)",
    "assert.equal(ownPatches, 8)",
    "assert.equal(deniedRequests, 48)",
    "newCoverageCredits: 0",
    'independentSecurityReview: "PENDING"',
  ]) assert.ok(proof.includes(required), "Missing concrete PG16 adversarial step " + required);
  assert.ok(proof.indexOf("requireDisposableDisciplineEntityEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "Local-only refusal must happen before app or DB import");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "true"/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-discipline-entity-http\.mjs/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(workflow, /WORKER_ENABLED: "false"/);
});
