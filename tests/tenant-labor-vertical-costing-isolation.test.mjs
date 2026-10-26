import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/labor-vertical-costing.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const [row] = createRows({ assert });
const key = "POST workforce/labor-costing";

test("new vertical allocation POST is a real single-row tenant write contract, never an empty 403 probe", () => {
  assert.equal(row?.key, key);
  assert.equal(row.status, 201);
  for (const method of ["seed", "state", "expect", "ownBody", "foreignBody"])
    assert.equal(typeof row[method], "function", method);
  assert.equal(row.forged?.status, 404);
  assert.equal(typeof row.forged?.body, "function");
  const matches = tenantFamilyCatalog("write").filter(x => x.key === key);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].file, "scripts/qa/tenant-table-rows/write/labor-vertical-costing.mjs");
  assert.match(matches[0].text, /state: state/);
  assert.match(matches[0].text, /expect: \(before, after, c, response\)/);
  assert.match(matches[0].text, /assert\.deepEqual\(after\.allocations/);
  assert.match(matches[0].text, /after\.audits/);
  assert.match(matches[0].text, /before\.profiles/);
});
test("actor, victim and forged worker IDs bind independently to genuine source IDs", () => {
  const a = { orgId: 11, workerId: 21, marker: "TTBL-ATTA-FAKE",
    seeded: { id: 31, secondId: 32 },
    victim: { org: { id: 101 }, worker: { id: 201 } },
    victimSeeded: { id: 301, secondId: 302 } };
  const own = row.ownBody(a), foreign = row.foreignBody(a), forged = row.forged.body(a);
  assert.equal(own.organizationId, 11);
  assert.equal(own.employeeId, 21);
  assert.deepEqual(own.allocations.map(x => x.costCenterId), [31, 32]);
  assert.equal(own.effectiveFrom, "2099-03-15");
  assert.equal(own.action, "set_employee_allocations");
  assert.equal(own.allocations.reduce((sum, x) => sum + x.allocationPercent, 0), 100);
  assert.equal(foreign.organizationId, 101);
  assert.equal(foreign.employeeId, 201);
  assert.deepEqual(foreign.allocations.map(x => x.costCenterId), [301, 302]);
  assert.equal(forged.organizationId, 11);
  assert.equal(forged.employeeId, 201);
  assert.deepEqual(forged.allocations.map(x => x.costCenterId), [31, 32]);
  assert.notDeepEqual(own.allocations[0].verticalDimensions, own.allocations[1].verticalDimensions);
  assert.ok(own.allocations[0].verticalDimensions.campaignCode.includes(a.marker));
  assert.ok(own.allocations[1].verticalDimensions.plantCode.includes(a.marker));
});
test("new provisional route pins actual unchanged-victim and two-attacker write-table runner", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = manifest.allApiRouteFiles["src/app/api/workforce/labor-costing/route.ts"];
  assert.equal(route?.route, "workforce/labor-costing");
  const post = route.methods.find(x => x.name === "POST");
  assert.equal(post?.status, "COVERED");
  assert.equal(post.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs");
  assert.equal(post.testedBy?.rowFile, "scripts/qa/tenant-table-rows/write/labor-vertical-costing.mjs");
  const proof = readFileSync(post.testedBy.file, "utf8").split("\n");
  const rowSource = readFileSync(post.testedBy.rowFile, "utf8").split("\n");
  assert.match(rowSource[post.testedBy.rowLine - 1], /key: "POST workforce\/labor-costing"/);
  assert.match(proof[post.testedBy.ownPositiveLine - 1], /const owned = expectStatus\(await request\(urlFor\("own"\)/);
  assert.match(proof[post.testedBy.foreignDenialLine - 1], /const foreign = expectStatus\(await request\(urlFor\("foreign"\)/);
  assert.match(proof[post.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(victimAfter, victimBefore/);
  const suite = proof.join("\n");
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /assert\.notDeepEqual\(ownAfter, ownBefore/);
  assert.match(suite, /await assert\.rejects\(async \(\) => item\.expect\(first\.ownBefore/);
  assert.match(suite, /assert\.deepEqual\(plain\(await item\.state\(victim\.org\.id\)\)/);
  const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-write-table-http\.mjs/);
  assert.match(workflow, /image: postgres:16/);
  const routeSource = readFileSync("src/app/api/workforce/labor-costing/route.ts", "utf8");
  assert.match(routeSource, /resolvedAllocation\.verticalDimensions \?\? null/);
  assert.match(routeSource, /scopedEmployee\(user\.id, organizationId, employeeId\)/);
  assert.match(routeSource, /assertOrganizationRole\(/);
  assert.equal(manifest.acceptanceStatus.startsWith("NOT ACCEPTED:"), true);
});
