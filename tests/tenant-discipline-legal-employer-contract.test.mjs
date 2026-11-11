import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-level regression only. This is NOT an HTTP/PostgreSQL tenant proof.
const route = readFileSync("src/app/api/discipline/route.ts", "utf8");
const get = route.split("export async function GET(request: Request) {")[1]
  ?.split("export async function POST(request: Request) {")[0];
const post = route.split("export async function POST(request: Request) {")[1]
  ?.split("export async function PATCH(request: Request) {")[0];
const patch = route.split("export async function PATCH(request: Request) {")[1];

test("disciplinary GET applies legal employer to the joined employee SQL before reading cases", () => {
  assert.ok(get, "GET handler must exist");
  assert.ok(get.indexOf("assertOrganizationRole(") < get.indexOf("resolveMultiEntityContext("));
  assert.ok(get.indexOf("resolveMultiEntityContext(") < get.indexOf("const cases = await db.select("));
  assert.match(get, /entityAccess\.context\.group \|\| entityAccess\.context\.legalEntityId === null/);
  assert.match(get, /\.innerJoin\(employees, and\(/);
  assert.match(get, /legalEntityId === null \? undefined : eq\(employees\.legalEntityId, legalEntityId\)/);
  assert.match(get, /eq\(disciplinaryCases\.organizationId, organizationId\)/);
  assert.match(get, /eq\(employees\.orgUnitId, access\.orgUnitId!\)/);
});

test("disciplinary POST checks body/header/query entity selectors and worker's actual legal employer", () => {
  assert.ok(post, "POST handler must exist");
  assert.ok(post.indexOf("assertOrganizationRole(") < post.indexOf("resolveMultiEntityContext("));
  assert.ok(post.indexOf("resolveMultiEntityContext(") < post.indexOf("db.select().from(employees)"));
  assert.match(post, /requested: body\.legalEntityId/);
  assert.match(post, /entityAccess\.context\.group \|\| entityAccess\.context\.legalEntityId === null/);
  assert.match(post, /eq\(employees\.id, employeeId\)/);
  assert.match(post, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /legalEntityId === null \? undefined : eq\(employees\.legalEntityId, legalEntityId\)/);
  assert.match(post, /assertScope\(access, employee\.orgUnitId\)/);
  assert.ok(post.indexOf("db.select().from(employees)") < post.indexOf("db.insert(disciplinaryCases)"));
});

test("disciplinary PATCH denies foreign legal employer before all four actions and rechecks at write time", () => {
  assert.ok(patch, "PATCH handler must exist");
  assert.match(patch, /eq\(userOrganizations\.active, true\)/);
  assert.ok(patch.indexOf("assertOrganizationRole(") < patch.indexOf("resolveMultiEntityContext("));
  assert.ok(patch.indexOf("resolveMultiEntityContext(") < patch.indexOf("db.select({ orgUnitId: employees.orgUnitId })"));
  assert.ok(patch.indexOf("const currentLegalEmployerScope") < patch.indexOf('if (action === "submit_explanation")'));
  assert.match(patch, /requested: body\.legalEntityId/);
  assert.match(patch, /entityAccess\.context\.group \|\| entityAccess\.context\.legalEntityId === null/);
  assert.match(patch, /legalEntityId === null \? undefined : eq\(employees\.legalEntityId, legalEntityId\)/);
  assert.match(patch, /inArray\(\s*disciplinaryCases\.employeeId,[\s\S]*eq\(employees\.legalEntityId, legalEntityId\)/);
  assert.equal((patch.match(/db\.update\(disciplinaryCases\)/g) ?? []).length, 4);
  assert.equal((patch.match(/currentLegalEmployerScope,\s*\)\)\.returning\(\)/g) ?? []).length, 4);
  assert.match(patch, /if \(!discCase\) return Response\.json\(\{ error: "Disciplinary case unavailable\." \}, \{ status: 403 \}\)/);
});

test("existing same-origin, role, unit, and feature-off behavior remain guarded", () => {
  assert.match(post, /enforceSameOriginMutation\(request\)/);
  assert.match(patch, /enforceSameOriginMutation\(request\)/);
  assert.equal((route.match(/assertOrganizationRole\(/g) ?? []).length, 3);
  assert.equal((route.match(/assertScope\(/g) ?? []).length, 2);
  assert.equal((route.match(/legalEntityId === null \? undefined : eq\(employees\.legalEntityId, legalEntityId\)/g) ?? []).length, 3);
});
