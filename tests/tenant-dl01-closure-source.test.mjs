import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releasedFixturePeriod } from "../scripts/qa/tenant-dl01-fixture-periods.mjs";

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

test("DL-01 egress is kernel-scoped to the unprivileged proof UID, never the runner", () => {
  const workflow = file(".github/workflows/tenant-dl01-closure.yml");
  // The proof UID must not alias the postgres:16 service container's UID 999.
  // Host-visible numeric UID collisions would make cleanup kill PostgreSQL.
  assert.ok(workflow.includes('proof_uid=61001'));
  assert.ok(workflow.includes('if getent passwd "$proof_uid" >/dev/null; then'));
  assert.ok(workflow.includes('if ps -eo uid= | awk -v uid="$proof_uid"'));
  assert.ok(workflow.includes('sudo useradd --uid "$proof_uid" --create-home --shell /usr/sbin/nologin dl01proof'));
  assert.ok(workflow.includes('test "$(id -u dl01proof)" = "$proof_uid"'));
  assert.doesNotMatch(workflow, /useradd --system/, "A system UID could collide with postgres:16");
  assert.ok(workflow.includes('Verify disposable PG16 survived proof cleanup before full regression'));
  assert.ok(workflow.includes("assert.equal(rows[0]?.db, 'app_db');"));
  assert.match(workflow, /sudo iptables -I OUTPUT 1 -m owner --uid-owner "\$proof_uid" ! -d 127\.0\.0\.0\/8 -j REJECT/);
  assert.match(workflow, /sudo ip6tables -I OUTPUT 1 -m owner --uid-owner "\$proof_uid" ! -d ::1\/128 -j REJECT/);
  assert.doesNotMatch(workflow, /sudo ip6?tables -I OUTPUT 1 ! -d/,
    "Global outbound blocking would disconnect GitHub Actions control traffic");
  assert.match(workflow, /proof node scripts\/qa\/tenant-dl01-local-adapters\.mjs/);
  assert.match(workflow, /proof env NODE_OPTIONS=.*tenant-dl01-network-preload\.mjs/);
  assert.match(workflow, /proof timeout --signal=TERM --kill-after=10s 300s/);
  assert.match(workflow, /sudo pkill -TERM -u dl01proof/);
  assert.match(workflow, /sudo chown -R "\$\(id -un\)":"\$\(id -gn\)" \.next/);
});

test("DL-01 isolated proof user has narrow, verified checkout permissions", () => {
  const workflow = file(".github/workflows/tenant-dl01-closure.yml");
  assert.match(workflow, /command -v setfacl/);
  assert.match(workflow, /sudo setfacl -m "u:dl01proof:r-x" "\$dir"/);
  assert.match(workflow, /sudo setfacl -m "u:dl01proof:--x" "\$dir"/);
  assert.match(workflow, /for dir in "\$\{acl_dirs\[@\]\}"/);
  assert.match(workflow, /sudo setfacl -x "u:dl01proof" "\$dir"/);
  assert.match(workflow, /proof node --check scripts\/qa\/tenant-dl01-local-adapters\.mjs/);
  assert.match(workflow, /proof node --check scripts\/qa\/tenant-dl01-network-preload\.mjs/);
  assert.match(workflow, /proof test -r node_modules\/next\/dist\/bin\/next/);
  assert.match(workflow, /proof test -r \.next\/BUILD_ID/);
  const beforeFirewall = workflow.indexOf('proof test -r scripts/qa/tenant-dl01-local-adapters.mjs');
  const firewall = workflow.indexOf('sudo iptables -I OUTPUT 1 -m owner');
  assert.ok(beforeFirewall > 0 && firewall > beforeFirewall,
    "Readability must be demonstrated before the network isolation proof starts");
});

test("DL-01 fixture uses distinct canonical semi-monthly periods for independently released payout modes", () => {
  const first = releasedFixturePeriod("PROVIDER");
  const second = releasedFixturePeriod("MANUAL");
  assert.deepEqual(first, {
    periodStart: "2026-05-01", periodEnd: "2026-05-15", payDate: "2026-05-16",
  });
  assert.deepEqual(second, {
    periodStart: "2026-05-16", periodEnd: "2026-05-31", payDate: "2026-06-01",
  });
  assert.ok(first.periodEnd < second.periodStart,
    "The PostgreSQL Released-run exclusion constraint must remain enforced");
  assert.ok(first.periodStart <= first.periodEnd && second.periodStart <= second.periodEnd);
  assert.ok(first.payDate > first.periodEnd && second.payDate > second.periodEnd);
  assert.throws(() => releasedFixturePeriod("VICTIM"), /DL01_UNEXPECTED_RELEASED_FIXTURE_KIND/);
  assert.throws(() => releasedFixturePeriod(""), /DL01_UNEXPECTED_RELEASED_FIXTURE_KIND/);
  const shared = file("scripts/qa/tenant-dl01-closure-shared.mjs");
  assert.match(shared, /\.\.\.releasedFixturePeriod\(suffix\)/,
    "The real three-employer database fixture must use the tested disjoint periods");
  assert.match(shared, /status: "Released"/,
    "Do not avoid the exclusion constraint by downgrading the payroll state");
});
