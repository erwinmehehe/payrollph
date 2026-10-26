import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const keys = [
  ["GET", "year-end/prior-evidence"],
  ["POST", "year-end/prior-evidence"],
  ["POST", "payroll-runs/[id]/exports"],
  ["POST", "documents"],
  ["POST", "employees/import"],
];
test("DL-01 frozen exact five method keys are represented once in batch families", () => {
  const manifest = JSON.parse(file("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const runner = file("scripts/qa/tenant-dl01-closure-http.mjs");
  const shared = file("scripts/qa/tenant-dl01-closure-shared.mjs");
  const families = [
    file("scripts/qa/tenant-dl01-rows/prior-evidence.mjs"),
    file("scripts/qa/tenant-dl01-rows/payout-export.mjs"),
    file("scripts/qa/tenant-dl01-rows/documents.mjs"),
    file("scripts/qa/tenant-dl01-rows/employee-import.mjs"),
  ];
  assert.match(runner, /assert\.deepEqual\(\[\.\.\.passed\]\.sort\(\), \[\.\.\.METHODS\]\.sort\(\)\)/);
  assert.match(shared, /oneEmployer\("ATTA"/);
  assert.match(shared, /oneEmployer\("ATTB"/);
  assert.match(shared, /oneEmployer\("VICTIM"/);
  for (const [method, route] of keys) {
    const entry = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"];
    const record = entry?.methods.find(x => x.name === method);
    assert.ok(record, "frozen method is missing: " + method + " " + route);
    assert.ok(["GAP", "COVERED"].includes(record.status));
    if (record.status === "COVERED") {
      assert.ok(record.testedBy?.ownPositiveLine &&
        record.testedBy?.foreignDenialLine &&
        record.testedBy?.unchangedDbLine &&
        record.testedBy?.forgedSelectorLine &&
        record.testedBy?.evidence,
      "no manifest credit without exact method four-part source pins and executed receipt");
    }
    const literal = JSON.stringify(method + " /api/" + route);
    assert.equal(families.filter(text => text.includes(literal)).length, 1,
      "each method must belong to exactly one logical family");
  }
});
test("No production code, real key, bucket or external host can be used in adapters", () => {
  const adapter = file("scripts/qa/tenant-dl01-local-adapters.mjs");
  const preload = file("scripts/qa/tenant-dl01-network-preload.mjs");
  const workflow = file(".github/workflows/tenant-dl01-closure.yml");
  for (const s of [adapter, preload]) {
    assert.match(s, /GITHUB_ACTIONS/);
    assert.match(s, /isolated-ci-only/);
    assert.match(s, /sk_test_synthetic_no_network/);
    assert.match(s, /127\.0\.0\.1/);
  }
  assert.match(adapter, /MOCK_REJECTS_REAL_PROVIDER_HOST/);
  assert.match(adapter, /dl01-fixture-bucket/);
  assert.match(preload, /DL01_OUTBOUND_NETWORK_REFUSED/);
  assert.match(workflow, /iptables -I OUTPUT/);
  assert.match(workflow, /ip6tables -I OUTPUT/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: 'false'/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED=true/);
  assert.doesNotMatch(workflow, /secrets\./, "CI must never import GitHub production secrets");
  assert.doesNotMatch(workflow, /NEON_DATABASE_URL|PRODUCTION_DATABASE_URL/);
});
test("All four independent security clauses are present in shared runner and families", () => {
  const shared = file("scripts/qa/tenant-dl01-closure-shared.mjs");
  const runner = file("scripts/qa/tenant-dl01-closure-http.mjs");
  assert.match(shared, /victimSnapshot/);
  assert.match(shared, /foreignDenied/);
  assert.match(shared, /real, persisted higher-ID victim/);
  assert.match(runner, /victimDatabaseUnchanged: true/);
  for (const name of ["prior-evidence", "payout-export", "documents", "employee-import"]) {
    const content = file("scripts/qa/tenant-dl01-rows/" + name + ".mjs");
    assert.match(content, /export const METHODS/);
    assert.match(content, /export async function prepare/);
    assert.match(content, /export async function verify/);
    assert.match(content, /victimSnapshot/);
    assert.match(content, /forged|selector|victim/i);
  }
});

test("DL-01 local adapter returns only fixed error codes and requires loopback", () => {
  const adapter = file("scripts/qa/tenant-dl01-local-adapters.mjs");
  assert.ok(adapter.includes('req.headers.host === "127.0.0.1:" + port'));
  assert.ok(adapter.includes('req.socket.localAddress === "127.0.0.1"'));
  assert.ok(adapter.includes('req.socket.remoteAddress === "127.0.0.1"'));
  assert.ok(adapter.includes('req.url.startsWith("//")'));
  assert.ok(!adapter.includes("/paymongo\\.com/i.test"), "substring URL matching is not a host guard");
  assert.ok(!adapter.includes("String(error?.message"), "never return exception text over HTTP");
  assert.equal(adapter.split("} catch {").length - 1, 3);
  for (const code of [
    "DL01_MOCK_INVALID_REQUEST", "DL01_SCANNER_INVALID_REQUEST", "DL01_STORE_INVALID_REQUEST"
  ]) assert.ok(adapter.includes(code));
});
