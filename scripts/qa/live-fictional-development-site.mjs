import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

// Deployed public fictional demo ONLY. This is not real-customer UAT.
// The only POST starts the existing synthetic role session; all subsequent
// payroll, attendance, HR and tenant operations are GET requests.
const ORIGIN = "https://erwinmehehe-payrollph.vercel.app";
const roles = ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"];
const dateRange = "startDate=2026-10-01&endDate=2026-10-15";
const period = "periodStart=2026-10-01&periodEnd=2026-10-15";
const observations = [];
let failures = 0;

assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.LIVE_FICTIONAL_QA_MODE, "public-fictional-demo-readonly");
assert.equal(process.env.LIVE_FICTIONAL_QA_ORIGIN, ORIGIN);

function record(role, surface, status, expected, type = "required") {
  const ok = expected.includes(status);
  observations.push({ role, surface, status, expected, type, ok });
  console.log("LIVE_DEV " + role + " " + surface + " HTTP=" + status +
    " expected=" + expected.join("/") + " " + (ok ? "PASS" : "FAIL"));
  if (!ok) failures++;
  return ok;
}

async function request(path, { role, cookie } = {}) {
  assert.ok(path.startsWith("/") && !path.startsWith("//") && !path.includes(".."));
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN);
  const headers = { Accept: "application/json", "User-Agent": "PayrollPH-fictional-dev-QA" };
  const options = { headers, redirect: "manual", signal: AbortSignal.timeout(20000) };
  if (cookie) headers.Cookie = cookie;
  if (role) {
    assert.equal(path, "/api/auth/demo-switch");
    assert.ok(roles.includes(role));
    options.method = "POST";
    headers.Origin = ORIGIN;
    headers["Sec-Fetch-Site"] = "same-origin";
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify({ role });
  }
  return fetch(url, options);
}

async function probe(role, name, path, expected, cookie, type) {
  try {
    const response = await request(path, { cookie });
    let status = response.status;
    if (status === 200 && path.startsWith("/api/")) {
      if (!(response.headers.get("content-type") ?? "").includes("application/json"))
        status = -200;
      else {
        const obj = await response.json().catch(() => null);
        if (!obj || typeof obj !== "object") status = -201;
      }
    }
    record(role, name, status, expected, type);
  } catch {
    record(role, name, 0, expected, type);
  }
}

async function demoSession(role) {
  try {
    const response = await request("/api/auth/demo-switch", { role });
    if (response.status !== 200) {
      record(role, "demo-session", response.status, [200]); return null;
    }
    const payload = await response.json().catch(() => null);
    const org = payload?.organizationId;
    const valid = payload?.ok === true &&
      payload.demoDataMode === "synthetic-redacted" &&
      payload.sensitiveFieldsPersisted === false &&
      payload.redirectTo === "/app?demoRole=" + role &&
      Number.isSafeInteger(org) && org > 0;
    if (!valid) { record(role, "demo-contract", -201, [200]); return null; }
    const setCookies = response.headers.getSetCookie();
    const pairs = setCookies.map(x => x.split(";")[0]).filter(Boolean);
    if (!pairs.length || pairs.some(x => !/^[A-Za-z0-9_-]+=[^\r\n]*$/.test(x))) {
      record(role, "demo-cookie", -202, [200]); return null;
    }
    record(role, "demo-session", 200, [200]);
    return { organizationId: org, cookie: pairs.join("; ") };
  } catch {
    record(role, "demo-session", 0, [200]); return null;
  }
}

function inOrg(path, org) {
  return path + (path.includes("?") ? "&" : "?") + "organizationId=" + org;
}

const permission = {
  owner:      [200, 200, 200, 200, 200, 200, 200],
  hr:         [200, 200, 200, 200, 200, 200, 403],
  payroll:    [200, 403, 200, 403, 403, 403, 200],
  checker:    [200, 403, 403, 403, 403, 403, 403],
  bookkeeper: [200, 200, 200, 200, 200, 403, 200],
  employee:   [403, 403, 403, 200, 403, 403, 403],
};

async function main() {
  for (const path of ["/", "/login", "/signup", "/demo"]) {
    try {
      const res = await request(path);
      record("anonymous", "public" + path, res.status, [200]);
      if (res.status === 200 && !(res.headers.get("content-type") ?? "").includes("text/html")) {
        record("anonymous", "public-html" + path, -200, [200]);
      }
    } catch { record("anonymous", "public" + path, 0, [200]); }
  }

  // No session: protected API must not reveal data.
  const anonymous = [
    ["dashboard", "/api/dashboard?organizationId=1"],
    ["payroll-runs", "/api/payroll-runs?organizationId=1"],
    ["compensation", "/api/compensation?organizationId=1"],
    ["schedules", "/api/workforce/schedules?organizationId=1"],
    ["attendance", "/api/workforce/attendance-exceptions?" +
      dateRange + "&organizationId=1"],
    ["payslips", "/api/self/payslips"],
  ];
  for (const [name, path] of anonymous)
    await probe("anonymous", name, path, [401]);

  for (const role of roles) {
    const session = await demoSession(role);
    if (!session) continue;
    const { organizationId: org, cookie } = session;
    await probe(role, "workspace", "/app?demoRole=" + role, [200], cookie);
    const paths = [
      ["dashboard", inOrg("/api/dashboard", org)],
      ["schedules", inOrg("/api/workforce/schedules", org)],
      ["attendance", inOrg("/api/workforce/attendance-exceptions?" + dateRange, org)],
      ["timesheets", inOrg("/api/workforce/timesheets?" + period, org)],
      ["live-floor", inOrg("/api/workforce/live-floor", org)],
      ["compensation", inOrg("/api/compensation", org)],
      ["payroll-runs", inOrg("/api/payroll-runs", org)],
    ];
    for (let i = 0; i < paths.length; i++)
      await probe(role, paths[i][0], paths[i][1], [permission[role][i]], cookie);

    if (role === "employee") {
      await probe(role, "self-payslips", "/api/self/payslips", [200], cookie);
      await probe(role, "self-workforce", "/api/self/workforce?" + dateRange,
        [200], cookie);
    }

    if (role === "owner" || role === "payroll") {
      // GET-only optional feature flags. 404 is disabled, 422 is an actual
      // safe blocked preview, 5xx is a failure. Do not imply a 404 is a pass
      // for first-payroll functionality; it is explicitly recorded.
      await probe(role, "first-payroll-progress",
        inOrg("/api/first-payroll/progress", org), [200, 404, 422],
        cookie, "feature-gated-observation");
      await probe(role, "first-payroll-preview",
        inOrg("/api/first-payroll/preview?" + period + "&payDate=2026-10-16", org),
        [200, 404, 422], cookie, "feature-gated-observation");
    }

    if (role === "owner") {
      const unassignedEmployer = 2147483647;
      assert.notEqual(org, unassignedEmployer);
      for (const [name, path] of [
        ["dashboard", inOrg("/api/dashboard", unassignedEmployer)],
        ["schedules", inOrg("/api/workforce/schedules", unassignedEmployer)],
        ["attendance", inOrg("/api/workforce/attendance-exceptions?" + dateRange, unassignedEmployer)],
        ["payroll-runs", inOrg("/api/payroll-runs", unassignedEmployer)],
        ["compensation", inOrg("/api/compensation", unassignedEmployer)],
      ]) await probe(role, "cross-tenant-" + name, path, [403], cookie);
    }
  }
}

try {
  await main();
} finally {
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/live-fictional-development-site.json",
    JSON.stringify({
      runType: "fictional-public-demo-live-site-read-only-acceptance",
      origin: ORIGIN,
      recordedAt: new Date().toISOString(),
      noPayrollOrCustomerWrites: true,
      observations,
      failures,
    }, null, 2));
  console.log("LIVE_DEV_SUMMARY checks=" + observations.length + " failed=" + failures);
}
if (failures > 0) process.exitCode = 1;
