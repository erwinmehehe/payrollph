import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const route = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const family = readFileSync("scripts/qa/tenant-table-rows/write/workforce-planning-root.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const methods = manifest.allApiRouteFiles["src/app/api/workforce-planning/route.ts"].methods;

test("Batch 3 stays two uncredited root GAP methods, discovered by the shared write runner", () => {
  const rows = tenantFamilyCatalog("write").filter(row => row.file.endsWith("/workforce-planning-root.mjs"));
  assert.deepEqual(rows.map(row => row.key), ["POST workforce-planning","PATCH workforce-planning"]);
  assert.deepEqual(rows.map(row => row.profile), ["default","default"]);
  assert.deepEqual(rows.map(row => row.flags), [[],[]]);
  assert.deepEqual(methods.map(row => [row.name,row.status,row.testedBy]),
    [["GET","COVERED",methods[0].testedBy],["POST","GAP",null],["PATCH","GAP",null]]);
  assert.match(family, /certifiedMethod: false/);
});

test("root POST exercises all approved architecture, plan and position creation paths", () => {
  const post = route.split("export async function POST(request: Request) {")[1]
    ?.split("export async function PATCH(request: Request) {")[0] ?? "";
  for (const action of ["job_family","job_level","job_grade","org_unit","profile","plan","position","assignment"]) {
    assert.ok(post.includes('entityType === "'+action+'"') || post.includes('"'+action+'"'),
      action+": root POST path must still exist and require review");
  }
  for (const action of ["job_family","job_level","job_grade","org_unit","plan","profile","position"]) {
    assert.match(family, new RegExp('"'+action+'"'), action+": synthetic row required");
  }
  assert.match(post, /assertOrganizationRole/);
  assert.match(post, /denyOptInEnterpriseAdvancedPlan/);
  assert.match(post, /startHcmBusinessProcessTx/);
  assert.match(family, /direct assignment future-date bypass/);
  assert.match(family, /TENANT_TABLE_FAMILY === "workforce-planning-root"/,
    "successful direct assignment runs only in the dedicated disposable PG16 family");
  assert.match(family, /isGovernedPositionAssignmentWorkspace\(c.orgId\)/,
    "assignment positive must prove the employer is actually ungoverned");
  assert.match(family, /directAssignmentProofs = 1/,
    "direct assignment proof must be a real positive HTTP action");
  assert.match(family, /position_assigned/,
    "assignment proof must check persisted employment event");
});

test("root PATCH explicitly exercises direct freeze, governed approval and closure without auto-release", () => {
  const patch = route.split("export async function PATCH(request: Request) {")[1] ?? "";
  for (const exact of [
    "requireSensitiveActionMfa(user)",
    "enforceSensitiveActionRateLimit(request",
    'status === "approved" && position.status === "planned"',
    'status === "closed" && position.status !== "closed"',
    'if (status === position.status)',
    "pg_advisory_xact_lock",
    "eq(positions.organizationId, position.organizationId)",
    "eq(positions.status, freshPosition.status)",
    "Position lifecycle review requested",
  ]) assert.ok(patch.includes(exact), "Required lifecycle boundary was removed: "+exact);
  for (const label of [
    "idempotent vacancy freeze","approved vacancy freeze","governed approval request",
    "governed closure request","foreign governed approval request",
  ]) assert.ok(family.includes(label), "Synthetic proof missing: "+label);
});

test("foreign and missing root PATCH IDs are hidden before role checks", () => {
  const patch = route.split("export async function PATCH(request: Request) {")[1] ?? "";
  const missing = patch.indexOf('if (!position) return Response.json({ error: "Position not found." }, { status: 404 });');
  const membership = patch.indexOf("const membership = await getAccess(user.id, position.organizationId);");
  const concealed = patch.indexOf('if (!membership) return Response.json({ error: "Position not found." }, { status: 404 });');
  const roleCheck = patch.indexOf("const denied = await assertOrganizationRole(user.id, position.organizationId");
  assert.ok(missing !== -1 && missing < membership && membership < concealed && concealed < roleCheck,
    "foreign and missing ID responses must match before role/tenant disclosure");
  assert.match(family, /unknown position id matches foreign 404/);
  assert.match(family, /foreignPosition.text, missingPosition.text/);
  assert.match(family, /key: "PATCH workforce-planning", status: 200, deny: 404/);
});

test("out-of-range PostgreSQL int4 position IDs return neutral missing 404 before SQL", () => {
  const patch = route.split("export async function PATCH(request: Request) {")[1] ?? "";
  const validated = patch.indexOf("!Number.isInteger(id)");
  const range = patch.indexOf("if (id <= 0 || id > 2_147_483_647)");
  const neutral = patch.indexOf('return Response.json({ error: "Position not found." }, { status: 404 });', range);
  const lookup = patch.indexOf("const [position] = await db.select().from(positions)");
  assert.ok(validated !== -1 && validated < range && range < neutral && neutral < lookup,
    "Out-of-range numeric IDs must return the same 404 without querying Postgres int4");
  assert.match(family, /Number\.MAX_SAFE_INTEGER, status: "approved"/,
    "The live HTTP fixture must send an out-of-range missing ID and expect 404");
});

test("simultaneous vacancy freezes cannot double-write; coverage remains uncredited", () => {
  assert.match(family, /Promise\.all\(\[1, 2\]\.map/);
  assert.match(family, /raceAudit.length, 1/);
  assert.match(family, /racedSamePositionFreezes: 2/);
  assert.deepEqual(methods.filter(row => row.name === "POST" || row.name === "PATCH")
    .map(row => [row.name, row.status, row.testedBy]),
    [["POST", "GAP", null], ["PATCH", "GAP", null]],
    "a passing synthetic fixture must not silently promote either method");
});

test("no payroll, provider or production authorization is carried in the Batch 3 fixture", () => {
  assert.doesNotMatch(family, /(?:PAYMONGO_SECRET_KEY|XENDIT_SECRET_KEY|PRODUCTION_DATABASE_URL|releasePayroll|submitGovernmentFiling)/);
  const workflow = readFileSync(".github/workflows/tenant-wrk02-batch3-root.yml", "utf8");
  assert.match(workflow, /TENANT_TABLE_FAMILY: workforce-planning-root/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED/);
  assert.match(workflow, /tenant-write-table-http\.mjs/);
});
