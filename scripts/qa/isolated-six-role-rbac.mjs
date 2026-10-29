import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { operationalSecret } from "../../src/lib/operational-secret";
import { attendanceExceptionEvents, employees, organizations, payrollRuns, sessions, userOrganizations, users } from "../../src/db/schema";
import { ensurePublicDemoTenant } from "../../src/db/public-demo";

// Authenticated API proof against an EXCLUSIVELY DISPOSABLE PG16 + localhost
// Next server. No production host, Neon connection, payroll write, payout,
// provider action or official filing is ever contacted.
const ORIGIN = "http://127.0.0.1:3000";
const PERIOD = "periodStart=2026-10-01&periodEnd=2026-10-15";
const ATTENDANCE_DATES = "startDate=2026-10-01&endDate=2026-10-15";
const ROLES = ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"];
const ACCESS = {
  owner:      { dashboard: 200, bi: 200, planning: 200, allocations: 200, timesheets: 200, payroll: 200, payslips: 403, attendance: 200 },
  hr:         { dashboard: 200, bi: 200, planning: 200, allocations: 200, timesheets: 200, payroll: 403, payslips: 403, attendance: 200 },
  payroll:    { dashboard: 200, bi: 200, planning: 403, allocations: 403, timesheets: 403, payroll: 200, payslips: 403, attendance: 200 },
  checker:    { dashboard: 200, bi: 403, planning: 403, allocations: 403, timesheets: 403, payroll: 403, payslips: 403, attendance: 403 },
  bookkeeper: { dashboard: 200, bi: 200, planning: 200, allocations: 200, timesheets: 200, payroll: 200, payslips: 403, attendance: 200 },
  employee:   { dashboard: 403, bi: 403, planning: 403, allocations: 403, timesheets: 200, payroll: 403, payslips: 200, attendance: 403 },
};
const observations = [];
let errors = 0;
let verifiedSourceSha = null;
let seededAttendanceEventId = null;
let seededOutsideUnitEventId = null;
let seededScopedOrgUnitId = null;

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

// #1015: only a disposable PG16 runner may create the fictional event.
// A nonempty queue ensures GET really queries the repaired table rather
// than returning 200 before touching it for an employer with no employees.
async function seedAttendanceExceptionForDemo(org) {
  guardEnvironment();
  assert.equal(seededAttendanceEventId, null);
  const workers = await db.select({
    id: employees.id, orgUnitId: employees.orgUnitId,
  }).from(employees).where(eq(employees.organizationId, org))
    .orderBy(employees.id);
  const inUnit = workers.find(row => Number.isSafeInteger(row.orgUnitId) && row.orgUnitId > 0);
  const outsideUnit = workers.find(row =>
    Number.isSafeInteger(row.orgUnitId) && row.orgUnitId > 0 &&
    row.orgUnitId !== inUnit?.orgUnitId);
  assert.ok(inUnit && outsideUnit,
    "Fictional tenant must contain employees in two distinct real organizational units");

  // Two nonempty actual events make a company-wide 200 and an isolated
  // unit-HR 200 distinguishable. No hardcoded employee or unit IDs.
  const events = await db.insert(attendanceExceptionEvents).values(
    [inUnit, outsideUnit].map((worker, index) => ({
      organizationId: org,
      employeeId: worker.id,
      workDate: "2026-10-12",
      exceptionKind: index === 0 ? "missing_time_in" : "missing_time_out",
      severity: "warning",
      message: "Fictional issue 1015 unit scope fixture " + index,
      fingerprintSha256: createHash("sha256")
        .update("issue1015-" + org + "-" + randomUUID()).digest("hex"),
      status: "open",
      slaDueAt: new Date("2026-10-13T00:00:00.000Z"),
    })),
  ).returning({ id: attendanceExceptionEvents.id });
  assert.equal(events.length, 2);
  assert.ok(events.every(row => Number.isSafeInteger(row.id) && row.id > 0));
  seededAttendanceEventId = events[0].id;
  seededOutsideUnitEventId = events[1].id;
  seededScopedOrgUnitId = inUnit.orgUnitId;
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
  if (name === "attendance") return seededAttendanceEventId !== null &&
    seededOutsideUnitEventId !== null && body.organizationId === org &&
    body.range?.startDate === "2026-10-01" &&
    body.range?.endDate === "2026-10-15" &&
    Number.isSafeInteger(body.summary?.open) && body.summary.open >= 2 &&
    Number.isSafeInteger(body.summary?.unassigned) && body.summary.unassigned >= 2 &&
    Array.isArray(body.ownerCandidates) && Array.isArray(body.exceptions) &&
    body.exceptions.some(row => row.id === seededAttendanceEventId &&
      row.organizationId === org && row.status === "open" &&
      row.employee?.id === row.employeeId) &&
    body.exceptions.some(row => row.id === seededOutsideUnitEventId &&
      row.organizationId === org && row.status === "open" &&
      row.employee?.id === row.employeeId) &&
    body.exceptions.every(row => row.organizationId === org &&
      row.employee?.id === row.employeeId);
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
    // CI-only aggregate diagnosis: never log employee rows or response bodies.
    // Preserve the HTTP assertion even if the profile count is complete.
    if (name === "dashboard" && response.status === 500) {
      const { rows: [counts] } = await pool.query(
        `SELECT (SELECT COUNT(*) FROM employees WHERE organization_id = $1)::int AS employees,
                (SELECT COUNT(*) FROM employee_pay_profiles WHERE organization_id = $1)::int AS profiles,
                (SELECT COUNT(*) FROM employees e WHERE e.organization_id = $1 AND
                   NOT EXISTS (SELECT 1 FROM employee_pay_profiles p
                     WHERE p.employee_id = e.id AND p.organization_id = e.organization_id))::int AS missing`,
        [org],
      );
      console.error(`ISOLATED_RBAC_DASHBOARD_PROFILE_PREFLIGHT employees=${counts.employees} profiles=${counts.profiles} missing=${counts.missing}`);
    }
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
  // Prove the second employer owns an ACTUAL attendance exception, rather
  // than accepting a foreign-company denial where no attendance row exists.
  const [foreignEmployee] = await db.insert(employees).values({
    organizationId: foreignOrg.id,
    employeeNo: "QA-ATT-" + nonce,
    firstName: "Fictional",
    lastName: "ForeignWorker",
    title: "Synthetic attendance worker",
    avatarInitials: "FW",
    basicRate: "20000.00",
    startDate: "2026-10-01",
  }).returning({ id: employees.id });
  const [foreignAttendance] = await db.insert(attendanceExceptionEvents).values({
    organizationId: foreignOrg.id,
    employeeId: foreignEmployee.id,
    workDate: "2026-10-12",
    exceptionKind: "missing_time_in",
    severity: "warning",
    message: "Fictional existing foreign employer attendance",
    fingerprintSha256: createHash("sha256")
      .update("issue1015-foreign-" + nonce).digest("hex"),
    status: "open",
  }).returning({ id: attendanceExceptionEvents.id });
  assert.ok(Number.isSafeInteger(foreignAttendance?.id) && foreignAttendance.id > 0);
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
  return {
    org: foreignOrg.id, run: foreignRun.id,
    employeeId: foreignEmployee.id, attendanceEventId: foreignAttendance.id,
    cookie: "linaw_session=" + token,
  };
}

/**
 * Duplicate employer display/legal names must never turn a mixed database
 * into a writable public demo. This runs AFTER role logins and BEFORE adding
 * the separate foreign-tenant RBAC fixture, so no other non-demo employer
 * can make the denial pass for the wrong reason.
 */
async function verifyDuplicateDemoLabelDenied(demoOwner) {
  guardEnvironment();
  const original = await db.select().from(employees)
    .where(eq(employees.organizationId, demoOwner.org));
  assert.ok(original.length > 0, "A real fictional worker fixture is required");
  const [collision] = await db.insert(organizations).values({
    name: "Loom & Local", legalName: "Loom & Local Philippines Inc.",
  }).returning({ id: organizations.id });
  assert.notEqual(collision.id, demoOwner.org);
  let deniedForDuplicate = false;
  try {
    await ensurePublicDemoTenant();
  } catch (error) {
    deniedForDuplicate = error instanceof Error &&
      error.message === "PUBLIC_DEMO_TENANT_NOT_ISOLATED";
  }
  evidence("owner", "duplicate-demo-label-provisioning-denied", 200, 200, deniedForDuplicate);
  const afterward = await db.select().from(employees)
    .where(eq(employees.organizationId, demoOwner.org));
  evidence("owner", "duplicate-demo-label-workers-unchanged", 200, 200,
    isDeepStrictEqual(afterward, original));
  await db.delete(organizations).where(eq(organizations.id, collision.id));
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

  const direct = await request("/api/payroll-runs?runId=" + foreign.run +
    "&include=entries", foreign.cookie);
  const directBody = await direct.json().catch(() => null);
  evidence("foreign-owner", "payroll-own-existing-run-direct", direct.status, 200,
    directBody?.runId === foreign.run && directBody?.organizationId === foreign.org &&
    Array.isArray(directBody?.entries));

  const attendance = await request("/api/workforce/attendance-exception-events?organizationId=" +
    foreign.org + "&" + ATTENDANCE_DATES, foreign.cookie);
  const attendanceBody = await attendance.json().catch(() => null);
  evidence("foreign-owner", "attendance-own-existing-event", attendance.status, 200,
    attendanceBody?.organizationId === foreign.org &&
    attendanceBody?.summary?.open >= 1 &&
    Array.isArray(attendanceBody.exceptions) &&
    attendanceBody.exceptions.some(row => row.id === foreign.attendanceEventId &&
      row.employeeId === foreign.employeeId && row.organizationId === foreign.org));

  const attendanceBefore = await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId, foreign.org))
    .orderBy(attendanceExceptionEvents.id);
  assert.ok(attendanceBefore.some(row => row.id === foreign.attendanceEventId));
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
    ["cross-tenant-attendance", "/api/workforce/attendance-exception-events?organizationId=" +
      foreign.org + "&" + ATTENDANCE_DATES],
  ]) {
    await probe("owner", name, path, 403, demoOwner.cookie, demoOwner.org);
  }

  const after = await db.select().from(payrollRuns).where(eq(payrollRuns.id, foreign.run)).limit(1);
  evidence("foreign-owner", "run-unchanged-after-denials", 200, 200,
    isDeepStrictEqual(after, snapshot));
  const attendanceAfter = await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId, foreign.org))
    .orderBy(attendanceExceptionEvents.id);
  evidence("foreign-owner", "attendance-unchanged-after-denials", 200, 200,
    isDeepStrictEqual(attendanceAfter, attendanceBefore));
}

/**
 * Synthetic PG16 acceptance for two missing #1015 access boundaries:
 *  - an existing privileged Owner session must fail after membership revoke
 *  - unit-scoped HR must see its own attendance, not a second unit's record
 *
 * The original memberships are restored in finally blocks on the disposable
 * database. Neither operation is executed against Neon or any public host.
 */
async function verifyAttendanceRevocationAndUnitScope(demoOwner, demoHr) {
  guardEnvironment();
  assert.equal(demoOwner.org, demoHr.org);
  const organizationId = demoOwner.org;
  const path = "/api/workforce/attendance-exception-events?organizationId=" +
    organizationId + "&" + ATTENDANCE_DATES;
  const before = await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId, organizationId))
    .orderBy(attendanceExceptionEvents.id);
  assert.ok(before.some(row => row.id === seededAttendanceEventId));
  assert.ok(before.some(row => row.id === seededOutsideUnitEventId));

  const ownerMembership = await db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.userId, demoOwner.userId),
      eq(userOrganizations.organizationId, organizationId))).limit(1);
  assert.equal(ownerMembership.length, 1);
  assert.equal(ownerMembership[0].active, true);
  try {
    await db.update(userOrganizations).set({ active: false })
      .where(eq(userOrganizations.id, ownerMembership[0].id));
    await probe("owner", "attendance-revoked-denied", path, 403,
      demoOwner.cookie, organizationId);
  } finally {
    await db.update(userOrganizations).set({ active: true })
      .where(eq(userOrganizations.id, ownerMembership[0].id));
  }
  const afterRevocation = await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId, organizationId))
    .orderBy(attendanceExceptionEvents.id);
  evidence("owner", "attendance-revocation-unchanged", 200, 200,
    isDeepStrictEqual(afterRevocation, before));

  const hrMembership = await db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.userId, demoHr.userId),
      eq(userOrganizations.organizationId, organizationId))).limit(1);
  assert.equal(hrMembership.length, 1);
  assert.equal(hrMembership[0].role, "hr");
  assert.equal(hrMembership[0].active, true);
  assert.equal(hrMembership[0].orgUnitId, null,
    "The demo HR must be company-wide before scoped acceptance");
  assert.ok(Number.isSafeInteger(seededScopedOrgUnitId) && seededScopedOrgUnitId > 0);
  try {
    await db.update(userOrganizations).set({ orgUnitId: seededScopedOrgUnitId })
      .where(eq(userOrganizations.id, hrMembership[0].id));
    const response = await request(path, demoHr.cookie);
    const body = await response.json().catch(() => null);
    evidence("hr", "attendance-unit-scope-only", response.status, 200,
      body?.organizationId === organizationId &&
      body?.summary?.open >= 1 &&
      Array.isArray(body.exceptions) &&
      body.exceptions.some(row => row.id === seededAttendanceEventId &&
        row.employee?.orgUnitId === seededScopedOrgUnitId) &&
      !body.exceptions.some(row => row.id === seededOutsideUnitEventId) &&
      body.exceptions.every(row => row.employee?.orgUnitId === seededScopedOrgUnitId));
  } finally {
    await db.update(userOrganizations).set({ orgUnitId: hrMembership[0].orgUnitId })
      .where(eq(userOrganizations.id, hrMembership[0].id));
  }
  const afterScope = await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId, organizationId))
    .orderBy(attendanceExceptionEvents.id);
  evidence("hr", "attendance-unit-scope-unchanged", 200, 200,
    isDeepStrictEqual(afterScope, before));
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
    "/api/workforce/attendance-exception-events?organizationId=1&" + ATTENDANCE_DATES,
    "/api/payroll-runs?organizationId=1"]) {
    await probe("anonymous", "deny-" + new URL(path, ORIGIN).pathname,
      path, 401, null, 1);
  }

  let demoOwner = null, demoHr = null;
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
      if (valid && cookies.length > 0) {
        assert.ok(Number.isSafeInteger(body.user?.id) && body.user.id > 0);
        session = { org, cookie: cookies.join("; "), userId: body.user.id };
      }
    } catch {
      evidence(role, "demo-session", 0, 200, false);
    }
    if (!session) continue;
    if (role === "owner") {
      demoOwner = session;
      await seedAttendanceExceptionForDemo(session.org);
    }
    if (role === "hr") demoHr = session;

    const org = session.org, cookie = session.cookie;
    const query = "organizationId=" + org;
    const paths = {
      dashboard: "/api/dashboard?" + query,
      bi: "/api/bi-exports?" + query,
      planning: "/api/workforce-planning?" + query,
      allocations: "/api/workforce-planning/allocations?" + query,
      timesheets: "/api/workforce/timesheets?" + query + "&" + PERIOD,
      attendance: "/api/workforce/attendance-exception-events?" + query + "&" + ATTENDANCE_DATES,
      payroll: "/api/payroll-runs?" + query,
      payslips: "/api/self/payslips",
    };
    for (const [name, path] of Object.entries(paths)) {
      await probe(role, name, path, ACCESS[role][name], cookie, org);
    }
  }
  assert.ok(demoOwner && demoHr,
    "Fictional Owner and HR must authenticate before attendance boundary QA");
  await verifyAttendanceRevocationAndUnitScope(demoOwner, demoHr);
  await verifyDuplicateDemoLabelDenied(demoOwner);
  await verifyExistingForeignEmployerDenials(demoOwner);
  // No role may silently drop out of the matrix and leave a green subset.
  // 2 private + 6 anonymous + 6*9 role + 4 revocation/scope + 2 demo
  // provisioning + 4 foreign positive + 6 foreign denials + 2 unchanged DB.
  const expected = 2 + 6 + ROLES.length * 9 + 4 + 2 + 4 + 6 + 2;
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
