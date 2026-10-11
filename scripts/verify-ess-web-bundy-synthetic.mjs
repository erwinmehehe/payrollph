/**
 * Synthetic HTTP acceptance for the employee Web Bundy flow.
 * Runs ONLY against the disposable PostgreSQL 16 CI container and localhost app.
 * Never point this at a Vercel preview, customer tenant, or production environment.
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";

const base = process.env.QA_URL;
const connectionString = process.env.DATABASE_URL;
const dbUrl = new URL(connectionString || "postgresql://invalid@invalid/invalid");
assert.equal(process.env.GITHUB_ACTIONS, "true", "Must run inside GitHub Actions");
assert.equal(process.env.CI, "true", "Must run with CI=true");
assert.equal(process.env.SYNTHETIC_WFM_HTTP_REHEARSAL, "isolated-ci-only", "Explicit dry-run guard is required");
assert.equal(base, "http://localhost:3000", "Refuse non-local app target");
assert.equal(dbUrl.hostname, "127.0.0.1", "Refuse non-local database host");
assert.equal(dbUrl.port, "5432", "Refuse unknown database port");
assert.equal(dbUrl.pathname, "/app_db", "Refuse an unknown database");
assert.equal(dbUrl.username, "postgres", "Refuse non-CI database account");
assert.equal(process.env.DEMO_MODE, "false", "Do not enable broad demo seeding");
const client = new pg.Client({ connectionString });
let secondOrganizationId = null;
let periodLockId = null;
let punchId = null;
let ownOrganizationId = null;
let ownEmployeeId = null;
let ownWorkDate = null;
let membershipId = null;
const passes = [];

function checked(condition, name) {
  assert.ok(condition, name);
  passes.push(name);
}
function requestOptions(method, cookie, data) {
  return {
    method,
    headers: {
      "Origin": base,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...(cookie ? { "Cookie": cookie } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    redirect: "manual",
  };
}
async function call(path, method = "GET", cookie = "", data) {
  const response = await fetch(base + path, requestOptions(method, cookie, data));
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, response };
}
async function payrollDigest(organizationId) {
  const result = await client.query(
    "SELECT count(pe.id)::text AS entries, coalesce(sum(pe.net_pay), 0)::text AS net_total " +
    "FROM payroll_runs pr LEFT JOIN payroll_entries pe ON pe.payroll_run_id = pr.id " +
    "WHERE pr.organization_id = $1 AND pr.status = 'Released'",
    [organizationId],
  );
  return JSON.stringify(result.rows[0]);
}

try {
  await client.connect();
  const orgs = await client.query("SELECT name FROM organizations ORDER BY id");
  checked(orgs.rows.length === 1 && orgs.rows[0].name === "Loom & Local",
    "Only the fictional Loom & Local demo tenant exists before QA mutations");

  const launch = await call("/api/auth/demo-switch", "POST", "", { role: "employee" });
  assert.equal(launch.status, 200, "Synthetic employee demo login must succeed");
  checked(launch.payload?.demoDataMode === "synthetic-redacted"
    && launch.payload?.sensitiveFieldsPersisted === false,
    "Demo session carries synthetic-redacted evidence, never persistent secrets");
  const cookies = launch.response.headers.getSetCookie();
  const sessionCookie = cookies.map(value => value.split(";")[0])
    .find(value => /(?:^|^__Host-)linaw_session=/.test(value));
  assert.ok(sessionCookie, "Synthetic login must yield a session cookie");

  const own = await call("/api/self/payslips", "GET", sessionCookie);
  assert.equal(own.status, 200);
  ownOrganizationId = own.payload?.employer?.id;
  ownEmployeeId = own.payload?.employee?.id;
  assert.ok(Number.isSafeInteger(ownOrganizationId) && ownOrganizationId > 0);
  assert.ok(Number.isSafeInteger(ownEmployeeId) && ownEmployeeId > 0);
  checked(own.payload?.employee?.firstName === "Jonas",
    "Own ESS endpoint exposes exactly the linked fictional employee identity");

  ownWorkDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const existing = await client.query(
    "SELECT count(*)::int AS n FROM time_punches WHERE organization_id = $1 AND employee_id = $2 AND work_date = $3",
    [ownOrganizationId, ownEmployeeId, ownWorkDate],
  );
  assert.equal(existing.rows[0].n, 0, "Current-day synthetic employee punch must not exist before test");

  const payrollBefore = await payrollDigest(ownOrganizationId);
  const other = await client.query(
    "INSERT INTO organizations (name,legal_name) VALUES ($1,$2) RETURNING id",
    ["WFM Synthetic Tenant B - isolated CI", "WFM Synthetic Tenant B - isolated CI"],
  );
  secondOrganizationId = other.rows[0].id;
  const spoofEmployeeId = ownEmployeeId + 99999;

  const noCookie = await call("/api/web-bundy?organizationId=" + ownOrganizationId, "GET");
  checked(noCookie.status === 401, "Unauthenticated attendance read is denied");

  const foreignGet = await call(
    "/api/web-bundy?organizationId=" + secondOrganizationId + "&employeeId=" + ownEmployeeId,
    "GET", sessionCookie,
  );
  const foreignPost = await call(
    "/api/web-bundy", "POST", sessionCookie,
    { organizationId: secondOrganizationId, employeeId: ownEmployeeId, actionType: "clock_in" },
  );
  checked(foreignGet.status === 403 && foreignPost.status === 403,
    "Cross-tenant employee attendance reads and writes are denied");

  // Set an active payroll cutoff lock in disposable CI and prove it blocks even an authenticated employee.
  const lock = await client.query(
    "INSERT INTO workforce_attendance_period_locks " +
    "(organization_id,period_start,period_end,lock_type,status,reason,locked_by) " +
    "VALUES ($1,$2,$2,'payroll_cutoff','locked','Synthetic cutoff test','Isolated CI') RETURNING id",
    [ownOrganizationId, ownWorkDate],
  );
  periodLockId = lock.rows[0].id;
  const denied = await call(
    "/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: spoofEmployeeId, actionType: "clock_in" },
  );
  checked(denied.status === 423 && denied.payload?.code === "ATTENDANCE_PERIOD_LOCKED",
    "Active payroll cutoff lock prevents a time punch");
  await client.query("DELETE FROM workforce_attendance_period_locks WHERE id = $1", [periodLockId]);
  periodLockId = null;

  // The spoofed employee ID must be ignored by the server, never an employee selector.
  const clockIn = await call(
    "/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: spoofEmployeeId, actionType: "clock_in" },
  );
  assert.ok([200,201].includes(clockIn.status), "Own clock-in must succeed in disposable tenant");
  checked(clockIn.payload?.punch?.employeeId === ownEmployeeId
    && clockIn.payload?.punch?.organizationId === ownOrganizationId,
    "Spoofed employee ID is overwritten by session-linked identity on clock-in");
  punchId = clockIn.payload.punch.id;
  assert.ok(Number.isSafeInteger(punchId) && punchId > 0);

  const ownGetSpoof = await call(
    "/api/web-bundy?organizationId=" + ownOrganizationId + "&employeeId=" + spoofEmployeeId,
    "GET", sessionCookie,
  );
  checked(ownGetSpoof.status === 200
    && Array.isArray(ownGetSpoof.payload?.punches)
    && ownGetSpoof.payload.punches.some(punch => punch.id === punchId)
    && ownGetSpoof.payload.punches.every(punch => punch.employeeId === ownEmployeeId),
    "Spoofed employee ID is overwritten by session-linked identity on attendance read");

  const duplicate = await call("/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: ownEmployeeId, actionType: "clock_in" });
  checked(duplicate.status === 409, "Duplicate clock-in fails closed");

  for (const actionType of ["break_start", "break_end", "clock_out"]) {
    const step = await call("/api/web-bundy", "POST", sessionCookie,
      { organizationId: ownOrganizationId, employeeId: spoofEmployeeId, actionType });
    checked(step.status === 200
      && step.payload?.punch?.employeeId === ownEmployeeId
      && step.payload?.punch?.id === punchId,
      "Employee's " + actionType + " is recorded only against their own synthetic punch");
  }
  const afterOut = await call("/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: ownEmployeeId, actionType: "clock_out" });
  checked(afterOut.status === 409, "Duplicate clock-out fails closed");

  // A legitimate missing-IN attendance exception may produce a clock-out-only
  // record. A later IN or second OUT must not mutate it into negative paid
  // time or attempt another INSERT for the same employer/employee/workDate.
  await client.query(
    "DELETE FROM time_punches WHERE id=$1 AND organization_id=$2 AND employee_id=$3 AND work_date=$4",
    [punchId, ownOrganizationId, ownEmployeeId, ownWorkDate],
  );
  punchId = null;
  const noInClockOut = await call("/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: spoofEmployeeId, actionType: "clock_out" });
  checked(noInClockOut.status === 201
    && noInClockOut.payload?.punch?.employeeId === ownEmployeeId
    && noInClockOut.payload.punch.timeIn === null
    && Boolean(noInClockOut.payload.punch.timeOut),
    "An explicit first clock-out without IN is recorded as an incomplete correction case");
  punchId = noInClockOut.payload.punch.id;

  const impossibleClockIn = await call("/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: spoofEmployeeId, actionType: "clock_in" });
  checked(impossibleClockIn.status === 409
    && impossibleClockIn.payload?.code === "ATTENDANCE_CORRECTION_REQUIRED",
    "Late clock-in cannot invert an existing clock-out-only record");

  const duplicatedOrphanOut = await call("/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: spoofEmployeeId, actionType: "clock_out" });
  checked(duplicatedOrphanOut.status === 409
    && duplicatedOrphanOut.payload?.code === "ATTENDANCE_ALREADY_CLOCKED_OUT",
    "Second clock-out without IN is refused without duplicate insertion");

  const orphanStored = await client.query(
    "SELECT time_in AS \"timeIn\", time_out AS \"timeOut\" FROM time_punches " +
    "WHERE id=$1 AND organization_id=$2 AND employee_id=$3 AND work_date=$4",
    [punchId, ownOrganizationId, ownEmployeeId, ownWorkDate],
  );
  checked(orphanStored.rowCount === 1
    && orphanStored.rows[0].timeIn === null
    && orphanStored.rows[0].timeOut !== null,
    "Rejected orphan-out retries preserve exactly one time-order-safe source record");

  checked(await payrollDigest(ownOrganizationId) === payrollBefore,
    "Released payroll totals remain immutable after clock-in, break and clock-out");

  const member = await client.query(
    "SELECT uo.id FROM user_organizations uo JOIN users u ON u.id=uo.user_id " +
    "WHERE u.employee_id=$1 AND uo.organization_id=$2 AND u.role='employee' AND uo.active=true LIMIT 1",
    [ownEmployeeId, ownOrganizationId],
  );
  assert.equal(member.rowCount, 1, "Synthetic linked membership must exist");
  membershipId = member.rows[0].id;
  await client.query("UPDATE user_organizations SET active=false WHERE id=$1", [membershipId]);
  const revokedRead = await call("/api/self/payslips", "GET", sessionCookie);
  const revokedWrite = await call("/api/web-bundy", "POST", sessionCookie,
    { organizationId: ownOrganizationId, employeeId: ownEmployeeId, actionType: "clock_in" });
  checked([401,403].includes(revokedRead.status) && [401,403].includes(revokedWrite.status),
    "Revoked employee membership denies own ESS read and attendance write");
  await client.query("UPDATE user_organizations SET active=true WHERE id=$1", [membershipId]);
  membershipId = null;

  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/ess-wfm-http-synthetic.json", JSON.stringify({
    mode: "isolated-ci-only",
    scope: "disposable PostgreSQL 16 and localhost HTTP",
    sourceSha: process.env.GITHUB_SHA || null,
    passed: passes,
    count: passes.length,
    protectedStagingUat: "NOT_RUN",
    physicalDeviceTest: "NOT_RUN",
    humanPayrollReview: "NOT_RUN",
    productionRelease: "NOT_AUTHORIZED",
  }, null, 2));
  console.log("Synthetic ESS Web Bundy HTTP: " + passes.length + " assertions passed. No live tenant was contacted.");
} finally {
  if (membershipId !== null) await client.query(
    "UPDATE user_organizations SET active=true WHERE id=$1", [membershipId]);
  if (periodLockId !== null) await client.query(
    "DELETE FROM workforce_attendance_period_locks WHERE id=$1", [periodLockId]);
  if (punchId !== null) await client.query(
    "DELETE FROM time_punches WHERE id=$1 AND organization_id=$2 AND employee_id=$3 AND work_date=$4",
    [punchId, ownOrganizationId, ownEmployeeId, ownWorkDate]);
  if (secondOrganizationId !== null) await client.query(
    "DELETE FROM organizations WHERE id=$1", [secondOrganizationId]);
  await client.end();
}
