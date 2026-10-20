import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { operationalSecret } from "../../src/lib/operational-secret";
import { organizations, payrollRuns, sessions, userOrganizations, users } from "../../src/db/schema";

// Authenticated API proof against an EXCLUSIVELY DISPOSABLE PG16 + localhost
// Next server. No production host, Neon connection, payroll write, payout,
// provider action or official filing is ever contacted.
const ORIGIN = "http://127.0.0.1:3000";
const PERIOD = "periodStart=2026-10-01&periodEnd=2026-10-15";
const ROLES = ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"];
const ACCESS = {
  owner:      { dashboard: 200, bi: 200, planning: 200, allocations: 200, timesheets: 200, payroll: 200, payslips: 403 },
  hr:         { dashboard: 200, bi: 200, planning: 200, allocations: 200, timesheets: 200, payroll: 403, payslips: 403 },
  payroll:    { dashboard: 200, bi: 200, planning: 403, allocations: 403, timesheets: 403, payroll: 200, payslips: 403 },
  checker:    { dashboard: 200, bi: 403, planning: 403, allocations: 403, timesheets: 403, payroll: 403, payslips: 403 },
  bookkeeper: { dashboard: 200, bi: 200, planning: 200, allocations: 200, timesheets: 200, payroll: 200, payslips: 403 },
  employee:   { dashboard: 403, bi: 403, planning: 403, allocations: 403, timesheets: 200, payroll: 403, payslips: 200 },
};
const observations = [];
let errors = 0;
let verifiedSourceSha = null;

function guardEnvironment() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.ISOLATED_SIX_ROLE_RBAC, "disposable-pg16-only");
  assert.equal(process.env.DEMO_MODE, "true");
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.equal(process.env.QA_URL, ORIGIN);
  assert.equal(process.env.APP_BASE_URL, ORIGIN);
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  // pull_request GITHUB_SHA usually refers to GitHub's synthetic merge commit,
  // not the exact PR head checked out by actions/checkout. Attest the real HEAD.
  const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(checkedOutSha, /^[0-9a-f]{40}$/);
  assert.equal(checkedOutSha, process.env.RBAC_SOURCE_SHA);
  verifiedSourceSha = checkedOutSha;
}

function evidence(role, name, actual, expected, validShape = true) {
  const passed = actual === expected && validShape;
  observations.push({ role, route: name, actual, expected, passed });
  if (!passed) errors += 1;
  console.log("ISOLATED_RBAC " + role + " " + name + " HTTP=" + actual +
    " expected=" + expected + " " + (passed ? "PASS" : "FAIL"));
}

async function request(path, cookie = null, role = null) {
  assert.ok(path.startsWith("/") && !path.startsWith("//") && !path.includes(".."));
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN);
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  const post = role !== null;
  if (post) {
    assert.equal(path, "/api/auth/demo-switch");
    assert.ok(ROLES.includes(role));
    headers.Origin = ORIGIN;
    headers["Sec-Fetch-Site"] = "same-origin";
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    method: post ? "POST" : "GET",
    headers, body: post ? JSON.stringify({ role }) : undefined,
    redirect: "manual", signal: AbortSignal.timeout(45000),
  });
}

function validRead(name, body, role, org) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  if (name === "dashboard") return body.selectedOrganization?.id === org;
  if (name === "bi") return Array.isArray(body.datasets) && body.datasets.length > 0 &&
    Array.isArray(body.scopes?.legalEntities) && Array.isArray(body.scopes?.orgUnits) &&
    Array.isArray(body.scopes?.dynamicGroups) && Array.isArray(body.formats);
  if (name === "planning") return body.access?.organizationId === org &&
    body.access?.role === role && body.access?.companyWide === true &&
    Array.isArray(body.profiles) && Array.isArray(body.plans) && Array.isArray(body.positions) &&
    body.plans.every(row => row.organizationId === org) &&
    body.positions.every(row => row.organizationId === org);
  if (name === "allocations") return body.access?.role === role &&
    body.access?.companyWide === true && Array.isArray(body.allocations) &&
    Array.isArray(body.submissions) &&
    body.allocations.every(row => row.organizationId === org) &&
    body.submissions.every(row => row.organizationId === org);
  if (name === "timesheets") return typeof body.manager === "boolean" &&
    body.manager === (role !== "employee") &&
    Array.isArray(body.employees) && Array.isArray(body.latest) &&
    Array.isArray(body.expectations) && Array.isArray(body.history) &&
    (role !== "employee" || body.employees.length <= 1);
  if (name === "payroll") return Array.isArray(body.runs) &&
    body.runs.every(row => row.organizationId === org);
  if (name === "payslips") return body.employer?.id === org &&
    typeof body.employee?.employeeNo === "string";
  return false;
}

async function probe(role, name, path, expected, cookie, org) {
  try {
    const response = await request(path, cookie);
    const body = await response.json().catch(() => null);
    const valid = response.status === 200 ? validRead(name, body, role, org)
      : !!body && typeof body.error === "string" && !("runs" in body) &&
        !("datasets" in body) && !("employees" in body);
    evidence(role, name, response.status, expected, valid);
  } catch {
    evidence(role, name, 0, expected, false);
  }
}


// This fixture is created ONLY after the six demo personas have signed in.
// Demo provisioning must not run again once a second fictional employer exists.
// A known, existing foreign tenant AND a non-empty payroll resource prevent
// a guessed/nonexistent organization ID from falsely passing isolation QA.
async function seedForeignEmployer() {
  guardEnvironment();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const [foreignOrg] = await db.insert(organizations).values({
    name: "Isolated RBAC Victim " + nonce,
    legalName: "Fictional RBAC Victim " + nonce,
  }).returning({ id: organizations.id });
  const [foreignUser] = await db.insert(users).values({
    email: "isolated-rbac-victim-" + nonce + "@example.invalid",
    name: "Fictional foreign employer owner",
    role: "owner",
    passwordHash: "synthetic-ci-session-only-login-disabled",
    localPasswordEnabled: false,
  }).returning({ id: users.id });
  await db.insert(userOrganizations).values({
    userId: foreignUser.id,
    organizationId: foreignOrg.id,
    role: "owner",
    active: true,
  });
  const [foreignRun] = await db.insert(payrollRuns).values({
    organizationId: foreignOrg.id,
    periodLabel: "FICTIONAL-CROSS-TENANT-QA-" + nonce,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    payDate: "2026-10-16",
    status: "Draft",
    grossPay: "0.00",
    netPay: "0.00",
  }).returning({ id: payrollRuns.id, organizationId: payrollRuns.organizationId });
  assert.ok(Number.isSafeInteger(foreignOrg.id) && foreignOrg.id > 0);
  assert.equal(foreignRun.organizationId, foreignOrg.id);

  // The fixture session has no public password or demo-switch route.
  // It is valid only inside the disposable PostgreSQL 16 CI environment.
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: foreignUser.id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60_000),
    lastSeenAt: new Date(),
  });
  return { org: foreignOrg.id, run: foreignRun.id, cookie: "linaw_session=" + token };
}

async function verifyExistingForeignEmployerDenials(demoOwner) {
  guardEnvironment();
  const foreign = await seedForeignEmployer();
  assert.notEqual(foreign.org, demoOwner.org,
    "Cross-tenant QA requires two distinct actually seeded employers.");

  // Positive owner controls: denial alone is insufficient without a real
  // foreign employer and an authenticated session able to read its own data.
  const dashboard = await request("/api/dashboard?organizationId=" + foreign.org, foreign.cookie);
  const dashboardBody = await dashboard.json().catch(() => null);
  evidence("foreign-owner", "dashboard-own-positive", dashboard.status, 200,
    validRead("dashboard", dashboardBody, "owner", foreign.org));

  const runs = await request("/api/payroll-runs?organizationId=" + foreign.org, foreign.cookie);
  const runsBody = await runs.json().catch(() => null);
  const ownsActualRun = runsBody && Array.isArray(runsBody.runs) &&
    runsBody.runs.some(row => row.id === foreign.run && row.organizationId === foreign.org);
  evidence("foreign-owner", "payroll-own-existing-run", runs.status, 200, ownsActualRun);

  const snapshot = await db.select().from(payrollRuns).where(eq(payrollRuns.id, foreign.run)).limit(1);
  assert.equal(snapshot.length, 1);

  // Use the SAME real victim organization ID (and actual existing run ID) that
  // the other owner just accessed, not a fabricated ID with a canned denial.
  for (const [name, path] of [
    ["cross-tenant-dashboard", "/api/dashboard?organizationId=" + foreign.org],
    ["cross-tenant-bi", "/api/bi-exports?organizationId=" + foreign.org],
    ["cross-tenant-workforce", "/api/workforce-planning?organizationId=" + foreign.org],
    ["cross-tenant-payroll", "/api/payroll-runs?organizationId=" + foreign.org],
    ["cross-tenant-existing-run", "/api/payroll-runs?runId=" + foreign.run + "&include=entries"],
  ]) {
    await probe("owner", name, path, 403, demoOwner.cookie, demoOwner.org);
  }

  const after = await db.select().from(payrollRuns).where(eq(payrollRuns.id, foreign.run)).limit(1);
  evidence("foreign-owner", "run-unchanged-after-denials", 200, 200,
    isDeepStrictEqual(after, snapshot));
}

async function run() {
  guardEnvironment();
  // Confirm the private production diagnostic is NOT public, and the same
  // guarded endpoint responds to its real secret inside isolated development.
  const privatePath = "/api/readiness/demo-provisioning";
  const unauthorized = await request(privatePath);
  const denied = await unauthorized.json().catch(() => null);
  evidence("anonymous", "demo-provisioning-private", unauthorized.status, 404,
    denied?.error === "Not found." && !("demoProvisioning" in denied));

  const token = operationalSecret("readiness");
  assert.ok(typeof token === "string" && token.length >= 32);
  const authorized = await fetch(new URL(privatePath, ORIGIN), {
    method: "GET",
    headers: { Accept: "application/json", "x-readiness-token": token },
    redirect: "manual", signal: AbortSignal.timeout(45000),
  });
  const readiness = await authorized.json().catch(() => null);
  evidence("private-readiness", "demo-provisioning-read", authorized.status, 200,
    readiness?.demoProvisioning === "non_production" &&
    readiness?.evidenceScope === "PRIVATE_DEMO_GUARD_ONLY_NOT_PERSONA_ACCEPTANCE");

  for (const path of ["/api/bi-exports?organizationId=1",
    "/api/workforce-planning?organizationId=1",
    "/api/workforce-planning/allocations?organizationId=1",
    "/api/workforce/timesheets?organizationId=1&" + PERIOD,
    "/api/payroll-runs?organizationId=1"]) {
    await probe("anonymous", "deny-" + new URL(path, ORIGIN).pathname,
      path, 401, null, 1);
  }

  let demoOwner = null;
  for (const role of ROLES) {
    let session;
    try {
      const response = await request("/api/auth/demo-switch", null, role);
      const body = await response.json().catch(() => null);
      const org = body?.organizationId;
      const valid = response.status === 200 && body?.ok === true &&
        body.demoDataMode === "synthetic-redacted" &&
        body.sensitiveFieldsPersisted === false && body.user?.role === role &&
        body.redirectTo === "/app?demoRole=" + role &&
        Number.isSafeInteger(org) && org > 0;
      const cookies = response.headers.getSetCookie().map(x => x.split(";")[0])
        .filter(x => /^[A-Za-z0-9_-]+=[^\r\n]+$/.test(x));
      evidence(role, "demo-session", response.status, 200, valid && cookies.length > 0);
      if (valid && cookies.length > 0) session = { org, cookie: cookies.join("; ") };
    } catch {
      evidence(role, "demo-session", 0, 200, false);
    }
    if (!session) continue;
    if (role === "owner") demoOwner = session;

    const org = session.org, cookie = session.cookie;
    const query = "organizationId=" + org;
    const paths = {
      dashboard: "/api/dashboard?" + query,
      bi: "/api/bi-exports?" + query,
      planning: "/api/workforce-planning?" + query,
      allocations: "/api/workforce-planning/allocations?" + query,
      timesheets: "/api/workforce/timesheets?" + query + "&" + PERIOD,
      payroll: "/api/payroll-runs?" + query,
      payslips: "/api/self/payslips",
    };
    for (const [name, path] of Object.entries(paths)) {
      await probe(role, name, path, ACCESS[role][name], cookie, org);
    }
  }
  assert.ok(demoOwner, "The fictional demo Owner must authenticate before tenant isolation QA");
  await verifyExistingForeignEmployerDenials(demoOwner);
  // No role may silently drop out of the matrix and leave a green subset.
  // 2 true victim-owned positives + 5 actual victim denials + unchanged DB.
  const expected = 2 + 5 + ROLES.length * 8 + 2 + 5 + 1;
  assert.equal(observations.length, expected,
    "Every anonymous, login, role-route and cross-tenant probe must execute");
}

try {
  await run();
} catch {
  errors += 1;
  console.error("ISOLATED_RBAC_FAILED: fictional environment or complete role coverage was not verified.");
} finally {
  await mkdir("qa-artifacts", { recursive: true });
  await writeFile("qa-artifacts/isolated-six-role-rbac.json", JSON.stringify({
    sourceSha: verifiedSourceSha,
    environment: "disposable Postgres 16 and localhost, synthetic only",
    independentHumanUat: false, physicalDeviceAcceptance: false,
    officialPayrollOrMoneyTested: false,
    expectedRoleCount: ROLES.length,
    testedRoleCount: observations.filter(x => x.route === "demo-session" && x.passed).length,
    total: observations.length,
    passed: observations.filter(x => x.passed).length,
    failed: observations.filter(x => !x.passed).length + (errors > 0 && observations.every(x=>x.passed) ? 1 : 0),
    observations,
  }, null, 2) + "\n");
  console.log("ISOLATED_RBAC_SUMMARY total=" + observations.length +
    " failed=" + errors + " real-customer-UAT=NOT_RUN");
  await pool.end();
}
if (errors !== 0) process.exitCode = 1;
