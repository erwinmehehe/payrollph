import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NAV_TENANT_ORIGIN, NAV_TENANT_ROUTE_BY_FILE, requireDisposableNavTenantEnv,
  tenantNavPageUrl, navReceiptStatus,
  requireRealEmployerTrio, inspectNavPage, assertReadOnlySnapshot, verifyNavCoverage,
} from "../scripts/nav-sweep-tenant-contract.mjs";

const safe = Object.freeze({
  CI: "true", BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  NODE_ENV: "production", DEMO_MODE: "false",
  APP_BASE_URL: "https://127.0.0.1:3000",
  TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  OPENAI_API_KEY: "",
});
const mk = (label, n) => ({
  label, marker: "TTBL-" + label + "-" + n,
  orgName: "TTBL-" + label + "-" + n + " employer",
  orgId: n, ownerId: n * 10, employeeId: n * 10 + 1, payrollId: n * 30,
  ownerCookie: "__Host-linaw_session=fictional-own-" + n,
  employeeCookie: "__Host-linaw_session=fictional-worker-" + n,
  privateEmployeeNo: "TTBL-" + label + "-" + n + "-P",
  privatePayrollPeriod: "TTBL-" + label + "-" + n + "-PRIVATE",
});
const subjects = () => [mk("ATTA", 11), mk("ATTB", 12), mk("VICTIM", 15)];
const [a, b, victim] = subjects();
const ownPage = {
  status: 200, contentType: "text/html; charset=utf-8",
  text: "<main>" + a.orgName + " " + a.privateEmployeeNo + " owner workspace</main>",
};
const foreignPage = { status: 404, contentType: "text/html", text: "Not Found" };
const pageProof = (overrides = {}) => ({
  file: "src/app/app/page.tsx", actor: a, victim,
  own: ownPage, foreign: foreignPage, ...overrides,
});

test("production, remote DB, paid providers, workers and public demo modes fail closed", () => {
  assert.doesNotThrow(() => requireDisposableNavTenantEnv(safe));
  const unsafe = [
    { CI: "false" }, { BUILD_BLOCK_ACCEPTANCE_MODE: "normal" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { APP_BASE_URL: "https://real.example.com" },
    { TRUSTED_APP_ORIGINS: "https://real.example.com" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example.com:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/production" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "test-not-allowed" },
    { XENDIT_SECRET_KEY: "test-not-allowed" },
    { RESEND_API_KEY: "test-not-allowed" },
    { OPENAI_API_KEY: "test-not-allowed" },
  ];
  for (const values of unsafe) {
    assert.throws(() => requireDisposableNavTenantEnv({ ...safe, ...values }),
      "must reject " + JSON.stringify(values));
  }
  assert.equal(NAV_TENANT_ORIGIN, "http://127.0.0.1:3000");
});

test("manifest page URLs require a real positive employer ID and static source path", () => {
  assert.equal(tenantNavPageUrl("src/app/app/page.tsx", 12), "/app?organizationId=12");
  assert.equal(tenantNavPageUrl("src/app/hcm/my-team/page.tsx", 15),
    "/hcm/my-team?organizationId=15");
  for (const id of [0, -1, NaN, "15", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => tenantNavPageUrl("src/app/app/page.tsx", id));
  }
  for (const p of ["src/app/hcm/[id]/page.tsx", "src/app/hcm/not-allowlisted/page.tsx",
    "https://example.com/page.tsx",
    "src/app/../../secrets/page.tsx", "src/app/app/route.ts"]) {
    assert.throws(() => tenantNavPageUrl(p, 15));
  }
});

test("outbound route allowlist exactly matches the 21-page manifest", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.deepEqual(manifest.scopedPages.map(p => p.path).sort(),
    Object.keys(NAV_TENANT_ROUTE_BY_FILE).sort());
  for (const [file, route] of Object.entries(NAV_TENANT_ROUTE_BY_FILE)) {
    assert.equal(tenantNavPageUrl(file, 17), route + "?organizationId=17");
  }
  const observations = manifest.scopedPages.flatMap(p => ["ATTA", "ATTB"].map(attacker => ({
    file: p.path, attacker, ownPopulated: p.path === "src/app/app/page.tsx",
    methodCredited: false, pageCredited: false,
  })));
  assert.doesNotThrow(() => verifyNavCoverage(manifest, observations));
  const drifted = structuredClone(manifest);
  drifted.scopedPages[0].path = "src/app/hcm/unreviewed/page.tsx";
  assert.throws(() => verifyNavCoverage(drifted, observations), /allowlist/);
  assert.throws(() => tenantNavPageUrl("src/app/hcm/unreviewed/page.tsx", 17));
});

test("receipt HTTP codes are literal, bounded and reject untrusted values", () => {
  for (const status of [200, 204, 302, 307, 401, 403, 404, 422, 429]) {
    assert.equal(navReceiptStatus(status), status);
  }
  for (const status of [500, 199, 299, "200", null, NaN, Infinity, {}]) {
    assert.throws(() => navReceiptStatus(status));
  }
  const proof = inspectNavPage(pageProof());
  assert.equal(proof.ownStatus, 200);
  assert.equal(proof.foreignStatus, 404);
});

test("requires two distinct real SQL attacker identities and higher-ID victim", () => {
  assert.doesNotThrow(() => requireRealEmployerTrio(subjects()));
  assert.throws(() => requireRealEmployerTrio(subjects().slice(0, 2)));
  assert.throws(() => requireRealEmployerTrio([victim, a, b]));
  const copied = subjects(); copied[1].ownerCookie = copied[0].ownerCookie;
  assert.throws(() => requireRealEmployerTrio(copied));
  const nonexistent = subjects(); nonexistent[2].payrollId = 0;
  assert.throws(() => requireRealEmployerTrio(nonexistent));
  const lower = subjects(); lower[2].orgId = 3;
  assert.throws(() => requireRealEmployerTrio(lower));
  const same = subjects(); same[1].marker = same[0].marker;
  assert.throws(() => requireRealEmployerTrio(same));
});

test("owned populated workspace and actual foreign 404 are required, never a 200 error shell", () => {
  const observed = inspectNavPage(pageProof());
  assert.equal(observed.ownPopulated, true);
  assert.equal(observed.foreignDenied, true);
  assert.equal(observed.pageCredited, false);
  for (const response of [
    { ...ownPage, status: 404 },
    { ...ownPage, text: "Workspace unavailable" },
    { ...ownPage, text: "<html>empty generic shell</html>" },
    { ...ownPage, contentType: "application/json" },
  ]) {
    assert.throws(() => inspectNavPage(pageProof({ own: response })));
  }
  assert.throws(() => inspectNavPage(pageProof({ foreign: { ...foreignPage, status: 200 } })));
  assert.throws(() => inspectNavPage(pageProof({ foreign: { ...foreignPage, status: 500 } })));
});

test("foreign victim private employee, payroll, organization and HTTP 5xx fail the sweep", () => {
  for (const leak of [victim.marker, victim.orgName,
    victim.privateEmployeeNo, victim.privatePayrollPeriod]) {
    assert.throws(() => inspectNavPage(pageProof({
      foreign: { ...foreignPage, text: "Not Found " + leak },
    })), "must block genuine foreign marker " + leak);
  }
  assert.throws(() => inspectNavPage(pageProof({ own: { ...ownPage, status: 503 } })));
  const careers = inspectNavPage(pageProof({
    file: "src/app/careers/page.tsx",
    own: { status: 404, contentType: "text/html", text: "off" },
    foreign: { status: 200, contentType: "text/html",
      text: "Public careers may identify " + victim.orgName },
  }));
  assert.equal(careers.pageCredited, false,
    "A public page is not a business-ID authorization positive");
  assert.equal(careers.foreignDenied, false);
  assert.throws(() => inspectNavPage(pageProof({
    file: "src/app/careers/page.tsx",
    own: { status: 404, contentType: "text/html", text: "off" },
    foreign: { status: 200, contentType: "text/html",
      text: "Bad public page " + victim.privateEmployeeNo },
  })));
});

test("denials must not modify protected payroll, staffing, membership or audit data", () => {
  const rows = { payrollRuns: [{ id: 7 }], auditEvents: [],
    userOrganizations: [{ active: true }] };
  assert.doesNotThrow(() => assertReadOnlySnapshot(rows, structuredClone(rows), "nav"));
  const mutated = structuredClone(rows); mutated.auditEvents.push({ action: "hidden write" });
  assert.throws(() => assertReadOnlySnapshot(rows, mutated, "nav"));
  const revoked = structuredClone(rows); revoked.userOrganizations[0].active = false;
  assert.throws(() => assertReadOnlySnapshot(rows, revoked, "nav"));
});

test("all manifest pages and both attackers are mandatory, with zero automatic credits", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.equal(manifest.scopedPages.length, 21);
  const observations = manifest.scopedPages.flatMap(p => ["ATTA", "ATTB"].map(attacker => ({
    file: p.path, attacker, ownStatus: 404, foreignStatus: 404,
    ownPopulated: p.path === "src/app/app/page.tsx",
    methodCredited: false, pageCredited: false,
  })));
  const summary = verifyNavCoverage(manifest, observations);
  assert.equal(summary.realOwnForeignPageComparisons, 42);
  assert.equal(summary.ownedWorkspacePositiveChecks, 2);
  assert.equal(summary.pageCreditDelta, 0);
  assert.equal(summary.fullPageAuthorizationAccepted, false);
  assert.equal(summary.remainingPageGaps,
    manifest.scopedPages.filter(p => p.status === "GAP").length);
  assert.throws(() => verifyNavCoverage(manifest, observations.slice(1)));
  assert.throws(() => verifyNavCoverage(manifest, [...observations, observations[0]]));
  const promoted = structuredClone(observations); promoted[0].pageCredited = true;
  assert.throws(() => verifyNavCoverage(manifest, promoted));
  const mislabeled = structuredClone(observations); mislabeled[0].file = "src/app/imaginary/page.tsx";
  assert.throws(() => verifyNavCoverage(manifest, mislabeled));
});

test("CI retains real desktop/mobile Chromium nav and adds separate exact-head tenant proof", () => {
  const workflow = readFileSync(".github/workflows/nav-runtime-sweep.yml", "utf8");
  const runner = readFileSync("scripts/nav-sweep-tenant-edges.mjs", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.ok(workflow.includes("ref: " + "$" + "{{ github.event.pull_request.head.sha || github.sha }}"));
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /node --import tsx scripts\/nav-sweep-tenant-edges\.mjs/);
  assert.match(workflow, /node --test tests\/nav-sweep-tenant-contract\.test\.mjs/);
  assert.match(workflow, /NAV_SWEEP_MOBILE_EDGE=true/);
  assert.match(workflow, /node scripts\/nav-sweep-run-all-roles\.mjs/);
  assert.match(workflow, /NAV_SWEEP_INJECT_BROKEN=true/);
  assert.match(workflow, /NAV_SWEEP_INJECT_VISUAL_OVERFLOW=true/);
  assert.match(workflow, /'scripts\/nav-sweep-\*'/);
  assert.ok(workflow.indexOf("Start local-only application") <
    workflow.indexOf("Cross-employer business-ID navigation proof"));
  assert.match(runner, /requireDisposableNavTenantEnv\(\)/);
  assert.ok(runner.indexOf("requireDisposableNavTenantEnv();") <
    runner.indexOf('import("../src/db/index.ts")'));
  assert.match(runner, /for \(const label of \["ATTA", "ATTB", "VICTIM"\]\)/);
  assert.match(runner, /for \(const actor of \[a, b\]\)/);
  assert.match(runner, /privatePayrollPeriod:/);
  assert.match(runner, /sameSessionRevokedAccess:/);
  assert.match(runner, /status, 404/);
  assert.match(runner, /methodCreditDelta: 0|newCredits: 0/);
  assert.match(runner, /methodCredited: false|verifyNavCoverage\(/);
  assert.doesNotMatch(runner, /process\.env\.DATABASE_URL\s*=/);
});
