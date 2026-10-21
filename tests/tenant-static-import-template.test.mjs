/**
 * Public-by-design means a truly tenant-independent static resource. The
 * authenticated template bytes MUST remain identical for all three fictional
 * employers in the real HTTP smoke; structural checks are not that evidence.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/employees/import/template/route.ts", "utf8");
const importer = readFileSync("src/app/api/employees/import/route.ts", "utf8");
const live = readFileSync("scripts/qa/tenant-static-template-http.mjs", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("import CSV template is global fixed data, never an employer record lookup", () => {
  assert.match(route, /export async function GET\(\)/);
  assert.ok(route.includes("getSessionUser()"), "Keep existing login requirement");
  assert.ok(route.includes("parseCsv(TEMPLATE_CSV)"));
  assert.ok(route.includes("toCsv("));
  assert.ok(route.includes("new Response(template"));
  assert.ok(!route.includes("organizationId"), "Static template must not select by employer");
  assert.ok(!route.includes("employeeId"), "Static template must not query a worker");
  assert.ok(!route.includes("db.select"), "Static template must not read tenant rows");
  assert.ok(importer.includes("export const TEMPLATE_CSV = `Employee No,"));
  const entry = manifest.allApiRouteFiles["src/app/api/employees/import/template/route.ts"].methods;
  assert.equal(entry.length, 1);
  assert.equal(entry[0].name, "GET");
  assert.equal(entry[0].status, "PUBLIC-BY-DESIGN");
  assert.ok(entry[0].reason.includes("tenant-independent"));
  assert.ok(entry[0].reason.includes("authentication"));
});

test("tenant-independent template is compared by real HTTP across 3 employers and forged IDs", () => {
  assert.ok(runner.includes('verifyTenantIndependentImportTemplate(f, { request, expectStatus })'));
  assert.ok(live.includes("for (const idx of [0, 1, 2])"));
  assert.ok(live.includes('expectStatus(await request("/api/employees/import/template", { cookie }), 200'));
  assert.ok(live.includes('"?organizationId=" + f.orgs[0].id'));
  assert.ok(live.includes('"&employeeId=" + f.victimEmployee.id + "&runId=" + f.victimRun.id'));
  assert.ok(live.includes("assert.equal(forged.text, own.text"));
  assert.ok(live.includes("assert.equal(own.text, reference"));
  assert.ok(live.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
});
