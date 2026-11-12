import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ORIGIN, PAGE, SOURCE_PINS, REQUIRED_ENV, FORBIDDEN_ENV,
  requireFictionalEnvironment, verifySources, assertOwnPage,
  assertDenied, assertNoLeak, assertSqlUnchanged
} from "../scripts/qa/tenant-hcm-action-center-contract.mjs";

const actor = { org: { id: 8 }, marker: "OWN-EMPLOYER", processLabel: "Transfer", secrets: ["PRIVATE-OWN"] };
const victim = { org: { id: 10 }, marker: "FOREIGN-EMPLOYER", processLabel: "Termination", secrets: ["PRIVATE-VICTIM"] };
const actors = [actor, victim];
const response = (status, text, extra = {}) => ({ status, text, headers: new Headers({
  "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", ...extra
}) });
function ownedHtml() {
  return '<main><h1>HCM Action Center</h1>OWN-EMPLOYER' +
    '<article><h2>My HCM decisions</h2><p>1<span>items previewed</span></p><ul><li>Transfer Approval</li></ul></article>' +
    '<article><h2>People Ops follow-ups</h2><p>2<!-- -->+<span>items previewed</span></p><ul>' +
    '<li>Employment lifecycle follow-up</li><li>Onboarding checklist</li></ul></article>' +
    '<article><h2>Cases assigned to me</h2><p>1<span>items previewed</span></p><ul>' +
    '<li>Assigned operational case</li></ul></article><a href="/app?organizationId=8">Back</a></main>';
}

test("source seal includes page, shared loader, authorization, fixture and schema", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 15);
  verifySources();
  for (const path of Object.keys(SOURCE_PINS))
    assert.throws(() => verifySources(p => p === path ? Buffer.from("changed") : readFileSync(p)), /source drift/);
});
test("safe sandbox accepts only its complete exact configuration", () => {
  requireFictionalEnvironment({ ...REQUIRED_ENV });
  for (const key of Object.keys(REQUIRED_ENV)) {
    const missing = { ...REQUIRED_ENV }; delete missing[key];
    assert.throws(() => requireFictionalEnvironment(missing), /unsafe or missing/);
    assert.throws(() => requireFictionalEnvironment({ ...REQUIRED_ENV, [key]: "unsafe" }), /unsafe or missing/);
  }
  for (const key of FORBIDDEN_ENV)
    assert.throws(() => requireFictionalEnvironment({ ...REQUIRED_ENV, [key]: "not-a-real-key" }), /external credential/);
});
test("owned page must contain the actual populated employer and all three sources", () => {
  assertOwnPage(response(200, ownedHtml()), actor, actors);
  for (const html of ["", "Loading", "<main>HCM Action Center</main>",
    ownedHtml().replace("OWN-EMPLOYER", "someone else"),
    ownedHtml().replace("Transfer Approval", "Termination Approval"),
    ownedHtml().replace("1<span>items", "0<span>items"),
    ownedHtml().replace("<li>Assigned operational case</li>", ""),
    ownedHtml().replace("Onboarding checklist", "Source unavailable"),
    ownedHtml().replace("organizationId=8", "organizationId=10")])
    assert.throws(() => assertOwnPage(response(200, html), actor, actors));
  for (const status of [302, 307, 401, 403, 404, 500])
    assert.throws(() => assertOwnPage(response(status, ownedHtml()), actor, actors));
  assert.throws(() => assertOwnPage(response(200, ownedHtml(), { "cache-control": "public, max-age=3600" }), actor, actors));
});
test("comment normalization cannot splice source labels or count evidence", () => {
  // Ordinary SSR/React separators still preserve the expected populated page.
  assertOwnPage(response(200, ownedHtml()), actor, actors);
  for (const html of [
    ownedHtml().replace("Transfer Approval", "Trans<!-- removed -->fer Approval"),
    ownedHtml().replace("items previewed", "i<!-- removed -->tems previewed"),
    ownedHtml().replace("Onboarding checklist", "Onboard<!-- removed -->ing checklist"),
  ]) {
    assert.throws(() => assertOwnPage(response(200, html), actor, actors),
      /Missing persisted source|Wrong populated source count/);
  }
});
test("every denial rejects success, error and private shells", () => {
  assertDenied(response(404, "Not Found"), actors);
  for (const status of [200, 302, 307, 401, 403, 500])
    assert.throws(() => assertDenied(response(status, "Not Found"), actors));
  for (const text of [ownedHtml(), victim.marker, victim.secrets[0], "My HCM decisions", "1 items previewed"])
    assert.throws(() => assertDenied(response(404, text), actors));
});
test("embedded RSC and response headers must not leak own or foreign private fields", () => {
  for (const secret of [...actor.secrets, ...victim.secrets, victim.marker]) {
    for (const text of [secret, secret.replaceAll("P", "\\u0050")])
      assert.throws(() => assertNoLeak(response(200, ownedHtml() + '<script>' + text + '</script>'), actors, actor));
    assert.throws(() => assertNoLeak(response(200, ownedHtml(), { "x-hidden-data": secret }), actors, actor));
  }
});
test("snapshots reject hidden business and audit mutations", () => {
  const before = { employees: [{ id: 1 }], auditEvents: [], userOrganizations: [{ active: true }] };
  assertSqlUnchanged(before, structuredClone(before), "same");
  for (const after of [{ ...before, employees: [] }, { ...before, auditEvents: [{ id: 1 }] },
    { ...before, userOrganizations: [{ active: false }] }])
    assert.throws(() => assertSqlUnchanged(before, after, "changed"), /protected business/);
});
test("real runner is guarded, source-sealed, read-only HTTP and cannot silently shrink proof", () => {
  const src = readFileSync("scripts/qa/tenant-hcm-action-center-http.mjs", "utf8");
  assert.match(src, /requireFictionalEnvironment\(\);\s*verifySources\(\);[\s\S]*import\("\.\.\/\.\.\/src\/db\/index\.ts"\)/);
  for (const token of ["SHOW server_version_num", "Refuse nonempty fixture database", "seedEmployer",
    "[8, 9, 10]", 'method: "GET"', 'redirect: "manual"', '"x-organization-id"',
    '"x-tenant-id"', '"&organizationId="', "await identity(a)", "active: false",
    "permissions: []", "assert.equal(ownPages, 8)", "assert.equal(foreignDenials, 8)",
    "assert.equal(denials, 41)", "before controlled fixture change", "only declared fixture fields change",
    "pageActionCredits: 0", "apiMethodCredits: 0", "independentlyAccepted: false"])
    assert.ok(src.includes(token), "Required proof control missing: " + token);
  assert.equal((src.match(/await fetch\(/g) ?? []).length, 1);
});
test("dedicated workflow verifies exact head, isolates PG16 and uploads only sanitized evidence", () => {
  const workflow = readFileSync(".github/workflows/tenant-hcm-action-center-qa.yml", "utf8");
  const docs = readFileSync("docs/qa/tenant-hcm-action-center-isolation.md", "utf8");
  assert.equal(PAGE, "/hcm/action-center"); assert.equal(ORIGIN, "http://127.0.0.1:3000");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(workflow, /tenant-hcm-action-center-http.mjs/);
  assert.match(workflow, /path: artifacts\/tenant-hcm-action-center\/evidence.json/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(docs, /ZERO credits/); assert.match(docs, /NOT ACCEPTED/);
  assert.match(docs, /same-parent legal-employer isolation/);
});
