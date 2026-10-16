import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { posixShellTestSkipReason } from "./helpers/posix-shell-prerequisites.mjs";

const script = resolve("scripts/live-workforce-bi-rbac-smoke.sh");
const commit = "a".repeat(40);
const bashOnlySkip = posixShellTestSkipReason();
const bashJqSkip = posixShellTestSkipReason({ needsJq: true });

// These tests mock curl only to validate the shell matrix and fail-closed
// response contracts. REAL deployed HTTP evidence is emitted by the main-only
// Live RBAC Sandbox Smoke workflow, not by this offline unit test.
function mockCurl() {
  const fs = require("node:fs");
  const args = process.argv.slice(2);
  const outputFlagIndex = args.indexOf("-o");
  if (outputFlagIndex < 0 || !args[outputFlagIndex + 1]) process.exit(3);
  const file = args[outputFlagIndex + 1];
  const url = new URL(args[args.length - 1]);
  const route = url.pathname;
  const requestedOrg = Number(url.searchParams.get("organizationId"));
  const org = Number(process.env.MOCK_ORG || "777");
  const role = process.env.MOCK_ROLE || "anonymous";
  let status = 403;

  if (role === "anonymous") {
    status = 401;
  } else if (requestedOrg !== org) {
    status = 403;
  } else if (route === "/api/bi-exports") {
    status = ["owner", "hr", "payroll", "bookkeeper"].includes(role) ? 200 : 403;
  } else if (route === "/api/workforce-planning" ||
             route === "/api/workforce-planning/allocations") {
    status = ["owner", "hr", "bookkeeper"].includes(role) ? 200 : 403;
  }

  if (process.env.MOCK_WRONG_STATUS === "1" && role === "owner"
      && route === "/api/bi-exports" && requestedOrg === org) status = 403;

  let payload = { error: "Not authorized" };
  if (status === 200 && route === "/api/bi-exports") {
    payload = {
      datasets: [{ key: "synthetic" }],
      scopes: { legalEntities: [], orgUnits: [], dynamicGroups: [] },
      formats: ["json", "csv"],
    };
  }
  if (status === 200 && route === "/api/workforce-planning") {
    payload = {
      access: { role, organizationId: org, companyWide: true },
      profiles: [], plans: [{ organizationId: org }],
      positions: [{ organizationId: org }], orgUnits: [],
    };
    if (process.env.MOCK_WRONG_TENANT === "1" && role === "owner") {
      payload.plans = [{ organizationId: org + 1 }];
    }
  }
  if (status === 200 && route === "/api/workforce-planning/allocations") {
    payload = {
      access: { role, companyWide: true },
      allocations: [{ organizationId: org }],
      submissions: [{ organizationId: org }],
    };
  }
  if (status === 403 && process.env.MOCK_DENIED_DATA === "1") {
    payload.plans = [{ organizationId: org }];
  }
  fs.writeFileSync(file, JSON.stringify(payload));
  process.stdout.write(String(status));
}

function fixture(t, role) {
  const dir = mkdtempSync(join(tmpdir(), "wfbi-rbac-unit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const work = join(dir, "private");
  mkdirSync(bin);
  mkdirSync(work);
  const curl = join(bin, "curl");
  writeFileSync(curl, "#!/usr/bin/env node\n(" + mockCurl.toString() + ")();\n", { mode: 0o700 });
  chmodSync(curl, 0o700);
  const cookies = join(work, "cookies.txt");
  writeFileSync(cookies, "synthetic-placeholder-only\n", { mode: 0o600 });
  writeFileSync(join(work, "demo-switch.json"), JSON.stringify({
    ok: true, demoDataMode: "synthetic-redacted", sensitiveFieldsPersisted: false,
    organizationId: 777, user: { role },
  }), { mode: 0o600 });
  return {
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      BASE_URL: "https://erwinmehehe-payrollph.vercel.app",
      EXPECTED_COMMIT_SHA: commit,
      MOCK_ORG: "777",
      MOCK_ROLE: role,
    },
    cookies,
    work,
  };
}

function run(t, role, overrides = {}) {
  const f = fixture(t, role);
  const result = spawnSync("bash", [
    script, role, "777", f.cookies, f.work,
  ], { env: { ...f.env, ...overrides }, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.signal, null, "no timeout/signal");
  return result;
}

test("live GitHub job checks out the exact commit before running the repo script", () => {
  const workflow = readFileSync(resolve(".github/workflows/live-rbac-sandbox-smoke.yml"), "utf8");
  const checkout = workflow.indexOf("uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  const scriptProbe = workflow.indexOf("bash scripts/live-workforce-bi-rbac-smoke.sh --anonymous");
  const readiness = workflow.indexOf("name: Wait for exact production deployment");
  assert.ok(checkout >= 0, "the workflow must checkout source before invoking the test script");
  assert.ok(scriptProbe > checkout, "the test script must only run after checkout");
  assert.ok(readiness > checkout, "the checkout must occur before exact-deployment verification");
  assert.match(workflow, /persist-credentials: false/, "checkout must not persist GitHub credentials");
  assert.match(workflow, /EXPECTED_COMMIT_SHA: \$\{\{ github\.sha \}\}/, "the exact deployment SHA must remain pinned to the workflow event");
});

test("shell source is syntactically valid", { skip: bashOnlySkip }, () => {
  const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("anonymous calls require real denial shape for all three routes", { skip: bashJqSkip }, (t) => {
  const f = fixture(t, "anonymous");
  const result = spawnSync("bash", [script, "--anonymous"], {
    env: f.env, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/http_status=401/g) || []).length, 3);
});

for (const role of ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"]) {
  test("fictional " + role + " HTTP allow/deny matrix", { skip: bashJqSkip }, (t) => {
    const result = run(t, role);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal((result.stdout.match(/route=\/api\//g) || []).length, role === "owner" ? 6 : 3);
    assert.ok(result.stdout.includes("PASS:"), "expected a complete successful role run");
  });
}

test("refuses non-main and non-approved deployment URLs", { skip: bashOnlySkip }, (t) => {
  const result = run(t, "owner", { BASE_URL: "https://other.example", GITHUB_REF: "refs/heads/feature" });
  assert.equal(result.status, 2);
  assert.ok(!result.stdout.includes("http_status="), "must not issue any HTTP probe");
});

test("fails closed on unexpected authorized HTTP denial", { skip: bashJqSkip }, (t) => {
  const result = run(t, "owner", { MOCK_WRONG_STATUS: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /HTTP status mismatch/);
});

test("fails closed when a successful 200 carries foreign organization rows", { skip: bashJqSkip }, (t) => {
  const result = run(t, "owner", { MOCK_WRONG_TENANT: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /tenant-scoping check failed/);
});

test("fails closed when an unauthorized response includes planning records", { skip: bashJqSkip }, (t) => {
  const result = run(t, "employee", { MOCK_DENIED_DATA: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /denied response shape invalid/);
});

test("refuses a demo session not explicitly marked fictional and redacted", { skip: bashJqSkip }, (t) => {
  const f = fixture(t, "owner");
  writeFileSync(join(f.work, "demo-switch.json"), JSON.stringify({
    ok: true, organizationId: 777, user: { role: "owner" },
    demoDataMode: "real", sensitiveFieldsPersisted: true,
  }));
  const result = spawnSync("bash", [script, "owner", "777", f.cookies, f.work], {
    env: f.env, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 2);
  assert.ok(!result.stdout.includes("http_status="));
});
