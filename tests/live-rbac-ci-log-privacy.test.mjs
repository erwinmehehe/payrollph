import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posixShellTestSkipReason } from "./helpers/posix-shell-prerequisites.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/live-rbac-sandbox-smoke.yml", import.meta.url),
  "utf8",
);
const bashJqSkip = posixShellTestSkipReason({ needsJq: true });

// Limit the fixture to this step's YAML body. A following workflow step must
// never become part of the extracted Bash (or leak its private environment).
const roleStep = workflow.split("- name: Verify all six RBAC personas on production")[1]
  ?.split(/\n      - name: /, 1)[0];

test("production smoke keeps authenticated payloads out of GitHub Actions logs", () => {
  assert.ok(roleStep, "RBAC smoke step must be present");
  assert.match(roleStep, /umask 077/);
  assert.match(roleStep, /work_dir=\$\(mktemp -d\)/);
  assert.match(roleStep, /trap 'rm -rf -- "\$work_dir"' EXIT/);
  assert.doesNotMatch(roleStep, /cat\s+.*(?:json|cookies|body|headers)/);
  assert.doesNotMatch(roleStep, /echo\s+.*\$(?:\{)?(?:body|api_code|organization_id|sessionCookie)/);
  assert.doesNotMatch(roleStep, /-D\s+.*headers/);
  assert.doesNotMatch(roleStep, /jq\s+-r\s+.*\.code/);
  assert.match(roleStep, /jq -e --arg role "\$role"/);
  assert.match(roleStep, /\.sensitiveFieldsPersisted == false/);
  assert.match(roleStep, /\.redirectTo == \("\/app\?demoRole=" \+ \$role\)/);
  assert.match(roleStep, /--max-time 15/);
  assert.match(roleStep, /--proto '=https'/);
});

test("readiness and public demo probes never print remote response content", () => {
  const readiness = workflow.split("- name: Wait for exact production deployment")[1]
    ?.split("- name: Wait for production demo page")[0] ?? "";
  const demo = workflow.split("- name: Wait for production demo page")[1]
    ?.split("- name: Verify all six RBAC personas on production")[0] ?? "";
  assert.match(readiness, /trap 'rm -f -- "\$response_file"' EXIT/);
  assert.match(demo, /trap 'rm -f -- "\$page_file" "\$header_file"' EXIT/);
  assert.match(demo, /verify-production-demo-entrypoint\.mjs/);
  assert.match(demo, /VERIFIED_DEMO_BOUNDARY_MODE/);
  assert.doesNotMatch(readiness + demo, /cat\s+.*(?:html|json|body|headers)/);
  assert.match(readiness, /\.deploymentSha \| test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(demo, /--max-time 15/);
});

/** Exercise the actual Bash step with a local fake curl; no network or live auth. */
function runRoleSmoke(mode) {
  const match = roleStep.match(/\n        run: \|\n([\s\S]*)/);
  assert.ok(match, "the RBAC shell body must be discoverable");
  const roleScript = match[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  assert.doesNotMatch(roleScript, /- name: Verify deployed fictional HR compensation privacy/,
    "subsequent YAML step must not be injected into the Bash fixture");
  const directory = mkdtempSync(join(tmpdir(), "payrollph-rbac-private-"));
  try {
    const curlPath = join(directory, "curl");
    // This mock intentionally writes credential-like strings into the
    // response body and cookie jar to test log nondisclosure, not HTTP behavior.
    writeFileSync(curlPath, [
      "#!/usr/bin/env node",
      'const {writeFileSync, readFileSync, existsSync} = require("node:fs");',
      "const args = process.argv.slice(2);",
      'const value = flag => args[args.indexOf(flag) + 1];',
      'const output = value("-o");',
      'const cookie = args.includes("-c") ? value("-c") : null;',
      'const url = args.find(item => item.startsWith("https://")) || "";',
      'if (!output) process.exit(6);',
      'if (cookie) {',
      '  writeFileSync(cookie, "SYNTHETIC_PRIVATE_COOKIE_SENTINEL");',
      '  if (url.includes("/api/auth/demo-switch")) writeFileSync(cookie + ".role", JSON.parse(value("--data")).role);',
      '}',
      "let status = 200;",
      "let payload = {};",
      'if (url.includes("/api/auth/demo-switch")) {',
      '  const role = JSON.parse(value("--data")).role;',
      '  if (process.env.MOCK_RBAC_MODE === "reject" || process.env.MOCK_RBAC_MODE === "notFound") {',
      '    status = process.env.MOCK_RBAC_MODE === "notFound" ? 404 : 403;',
      '    payload = {error:"SYNTHETIC_PRIVATE_BODY_SENTINEL", token:"SYNTHETIC_PRIVATE_BODY_SENTINEL"};',
      '  } else {',
      '    payload = {ok:true,organizationId:1,user:{role},demoDataMode:"synthetic-redacted",sensitiveFieldsPersisted:false,redirectTo:"/app?demoRole="+role};',
      '  }',
      '} else if (url.includes("/api/self/payslips")) {',
      '  payload = {employee:{employeeNo:"DEMO-001"},employer:{id:1}};',
      '} else if (url.includes("/api/dashboard")) {',
      '  payload = {selectedOrganization:{id:1}};',
      '} else if (url.includes("/api/bi-exports") || url.includes("/api/workforce-planning")) {',
      '  const target = new URL(url);',
      '  const route = target.pathname;',
      '  const org = Number(target.searchParams.get("organizationId"));',
      '  const cookieJar = args.includes("-b") ? value("-b") : null;',
      '  const activeRole = cookieJar && existsSync(cookieJar + ".role") ? readFileSync(cookieJar + ".role", "utf8").trim() : "anonymous";',
      '  if (!cookieJar) status = 401;',
      '  else if (org !== 1) status = 403;',
      '  else if (route === "/api/bi-exports") status = ["owner","hr","payroll","bookkeeper"].includes(activeRole) ? 200 : 403;',
      '  else status = ["owner","hr","bookkeeper"].includes(activeRole) ? 200 : 403;',
      '  if (status !== 200) payload = {error:"SYNTHETIC_PRIVATE_BODY_SENTINEL"};',
      '  else if (route === "/api/bi-exports") payload = {',
      '    datasets:[{key:"fictional"}], scopes:{legalEntities:[],orgUnits:[],dynamicGroups:[]}, formats:["json"]',
      '  };',
      '  else if (route === "/api/workforce-planning") payload = {',
      '    access:{role:activeRole,organizationId:1,companyWide:true},profiles:[],plans:[{organizationId:1}],',
      '    positions:[{organizationId:1}],orgUnits:[]',
      '  };',
      '  else payload = {access:{role:activeRole,companyWide:true},allocations:[{organizationId:1}],submissions:[]};',
      '}',
      "writeFileSync(output, JSON.stringify(payload));",
      "process.stdout.write(String(status));",
    ].join("\n"), { mode: 0o700 });
    chmodSync(curlPath, 0o700);
    const sleepPath = join(directory, "sleep");
    writeFileSync(sleepPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const result = spawnSync("bash", ["-c", roleScript], {
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...process.env,
        PATH: directory + ":" + process.env.PATH,
        MOCK_RBAC_MODE: mode,
        // Every curl call is intercepted by the private fixture binary; these
        // mocked runner settings exercise the guarded script without a network.
        BASE_URL: "https://erwinmehehe-payrollph.vercel.app",
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/heads/main",
        EXPECTED_COMMIT_SHA: "a".repeat(40),
      },
    });
    if (result.error) throw result.error;
    const transcript = String(result.stdout ?? "") + String(result.stderr ?? "");
    assert.doesNotMatch(transcript, /SYNTHETIC_PRIVATE_(?:BODY|COOKIE)_SENTINEL/,
      "raw authentication data must never be written to CI output");
    return { status: result.status, transcript };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fictional rejected auth hides secret-like response and cookie contents", {
  skip: bashJqSkip,
}, () => {
  const { status, transcript } = runRoleSmoke("reject");
  assert.equal(status, 1);
  assert.match(transcript, /role=owner attempt=1 login_http=403/);
  assert.match(transcript, /body withheld/);
});

test("fictional success verifies all six roles without logging response bodies", {
  skip: bashJqSkip,
}, () => {
  const { status, transcript } = runRoleSmoke("success");
  assert.equal(status, 0, transcript);
  for (const role of ["owner", "hr", "payroll", "checker", "bookkeeper", "employee"]) {
    assert.match(transcript, new RegExp("role=" + role + " attempt=1 login_http=200"));
  }
});

test("unexpected demo 404 with a verified demo-only production boundary fails closed immediately", {
  skip: bashJqSkip,
}, () => {
  const { status, transcript } = runRoleSmoke("notFound");
  assert.equal(status, 1);
  assert.match(transcript, /role=owner attempt=1 login_http=404/);
  assert.match(transcript, /Unexpected demo auth 404/);
  assert.doesNotMatch(transcript, /SYNTHETIC_PRIVATE_(?:BODY|COOKIE)_SENTINEL/);
  assert.doesNotMatch(transcript, /role=owner attempt=2/);
});
