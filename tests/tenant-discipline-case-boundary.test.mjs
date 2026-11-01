import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
});

test("all four decisions bind the final update to case, employer and employee, and reject lost targets", () => {
  const actions = ["submit_explanation", "schedule_hearing", "issue_nod", "close"];
  const codeBlocks = [...patch.matchAll(/if \(action === "(submit_explanation|schedule_hearing|issue_nod|close)"\) \{([\s\S]*?)(?=\n  if \(action === |\n  return Response\.json\(\{ error: "Unknown disciplinary action\.)/g)];
  assert.deepEqual(codeBlocks.map((entry) => entry[1]), actions);

  for (const [, action, block] of codeBlocks) {
    assert.match(block, /\.where\(and\(\s*eq\(disciplinaryCases\.id, id\),\s*eq\(disciplinaryCases\.organizationId, discCase\.organizationId\),\s*eq\(disciplinaryCases\.employeeId, discCase\.employeeId\),\s*\)\)\.returning\(\)/,
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
