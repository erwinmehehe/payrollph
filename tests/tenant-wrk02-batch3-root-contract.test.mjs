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

test("no payroll, provider or production authorization is carried in the Batch 3 fixture", () => {
  assert.doesNotMatch(family, /(?:PAYMONGO_SECRET_KEY|XENDIT_SECRET_KEY|PRODUCTION_DATABASE_URL|releasePayroll|submitGovernmentFiling)/);
  const workflow = readFileSync(".github/workflows/tenant-wrk02-batch3-root.yml", "utf8");
  assert.match(workflow, /TENANT_TABLE_FAMILY: workforce-planning-root/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED/);
  assert.match(workflow, /tenant-write-table-http\.mjs/);
});
