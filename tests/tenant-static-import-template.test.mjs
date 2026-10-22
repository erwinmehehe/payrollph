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
  assert.ok(live.includes('"/api/employees/import/template?organizationId=" + f.orgs[0].id'));
  assert.ok(live.includes('"&employeeId=" + f.victimEmployee.id + "&runId=" + f.victimRun.id'));
  assert.ok(live.includes("assert.equal(forged.text, own.text"));
  assert.ok(live.includes("assert.equal(own.text, reference"));
  assert.ok(live.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
});

test("statutory posting GET serves a globally public static CSV, unlike the separate POST", () => {
  const route = readFileSync("src/app/api/compliance/statutory-remittances/posting-import/route.ts", "utf8");
  const a = route.indexOf("export async function GET()");
  const b = route.indexOf("export async function POST(");
  assert.ok(a >= 0 && b > a, "Must keep GET separate from authenticated mutation POST");
  const get = route.slice(a, b);
  assert.ok(get.includes('new Response(STATUTORY_POSTING_TEMPLATE +'));
  assert.ok(get.includes('filename="statutory-posting-template.csv"'));
  assert.ok(!get.includes("getSessionUser("), "Public static GET cannot use another employer session");
  assert.ok(!get.includes("organizationId"));
  assert.ok(!get.includes("db.select"));
  const entry = manifest.allApiRouteFiles[
    "src/app/api/compliance/statutory-remittances/posting-import/route.ts"].methods;
  const getter = entry.find((method) => method.name === "GET");
  const poster = entry.find((method) => method.name === "POST");
  assert.equal(getter?.status, "PUBLIC-BY-DESIGN");
  assert.ok(getter.reason.includes("unauthenticated"));
  assert.ok(getter.reason.includes("static"));
  // Public template GET does not establish any authorization for POST. The
  // private mutation earns provisional coverage only from its OWN runnable
  // three-employer HTTP/PG16 case with persisted-victim and unchanged-DB proof.
  assert.equal(getter?.testedBy, null, "Public template cannot borrow private write evidence");
  assert.equal(poster?.status, "COVERED",
    "Authenticated POST must have its own source-linked PG16/HTTP tenant proof, never inherited GET publicity");
  assert.equal(poster?.testedBy?.file, "scripts/qa/tenant-dl01-batch2-http.mjs",
    "Separate private mutation must not borrow the public CSV GET evidence");
  const proof = poster.testedBy;
  const postingLines = readFileSync(proof.file, "utf8").split("\n");
  assert.ok(postingLines[proof.line - 1].includes("POST compliance/statutory-remittances/posting-import"));
  assert.ok(postingLines[proof.ownPositiveLine - 1].includes("const ownPosting = expectStatus(await request("));
  assert.ok(postingLines[proof.foreignDenialLine - 1].includes("const foreignPosting = expectStatus(await request("));
  assert.ok(postingLines[proof.forgedSelectorLine - 1].includes("const forgedPosting = expectStatus(await request("));
  assert.ok(postingLines[proof.unchangedDbLine - 1].includes("assert.deepEqual(after, before,"));
  assert.ok(proof.ownPositiveLine < proof.foreignDenialLine &&
    proof.foreignDenialLine < proof.forgedSelectorLine &&
    proof.forgedSelectorLine < proof.unchangedDbLine, "Private write needs ordered independent evidence");
  assert.ok(runner.includes('verifyDl01Batch2(f, { request, expectStatus })'),
    "POST's independent proof must run on the isolated authenticated HTTP/PG16 harness");
  assert.ok(live.includes("for (const idx of [null, 0, 1, 2])"));
  assert.ok(live.includes('"/api/compliance/statutory-remittances/posting-import", options'));
  assert.ok(live.includes('"?organizationId=" + f.orgs[0].id') ||
    live.includes('posting-import?organizationId=" + f.orgs[0].id'));
  assert.ok(live.includes("assert.equal(forged.text, own.text"));
  assert.ok(live.includes("assert.equal(own.text, postingTemplate"));
});
