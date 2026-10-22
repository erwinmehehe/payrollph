import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PINNED_HOSTED_DEMO_URL, verifyProductionDemoEntrypoint } from
  "../scripts/qa/verify-production-demo-entrypoint.mjs";

const REAL_HEADING = "See Linaw from the seat you actually use";
const header = (status, locations = []) =>
  "HTTP/2 " + status + "\r\n" +
  locations.map(x => "location: " + x + "\r\n").join("") + "\r\n";
const check = (status, locations = [], boundaryMode = "blocked_non_demo_employer", body = "") =>
  verifyProductionDemoEntrypoint({
    status: String(status), responseHeaders: header(status, locations),
    responseBody: body, boundaryMode,
  });

test("customer-scope production accepts only the pinned HTTPS hosted demo redirect", () => {
  for (const status of [307, 308]) {
    assert.equal(check(status, [PINNED_HOSTED_DEMO_URL]), "pinned-hosted-redirect");
  }
});

test("an attested demo-only deployment can render the real local role picker", () => {
  assert.equal(check(200, [], "demo_only", "<h1>" + REAL_HEADING + "</h1>"),
    "attested-local-demo");
  assert.throws(() => check(200, [], "demo_only", "OK"),
    /genuine role-picker HTML/);
  assert.throws(() => check(200, [], "blocked_non_demo_employer", REAL_HEADING),
    /customer-scope database must redirect/);
});

test("wrong origins, malformed redirects and query-bearing destinations fail closed", () => {
  for (const destination of [
    "https://attacker.invalid/demo",
    "http://payrollph-fictional-demo-qa-three.vercel.app/demo",
    "https://payrollph-fictional-demo-qa-three.vercel.app.evil.invalid/demo",
    "https://payrollph-fictional-demo-qa-three.vercel.app@evil.invalid/demo",
    "/demo",
    PINNED_HOSTED_DEMO_URL + "?organizationId=123",
    PINNED_HOSTED_DEMO_URL + "#role=owner",
    PINNED_HOSTED_DEMO_URL + "/",
  ]) {
    assert.throws(() => check(307, [destination]), /reviewed HTTPS fictional-demo origin/);
  }
});

test("missing or duplicate Location and nonapproved HTTP codes fail closed", () => {
  assert.throws(() => check(307), /exactly one Location/);
  assert.throws(() => check(308, [PINNED_HOSTED_DEMO_URL, PINNED_HOSTED_DEMO_URL]),
    /exactly one Location/);
  for (const status of [0, 200, 301, 302, 303, 304, 401, 404, 500]) {
    assert.throws(() => check(status, [PINNED_HOSTED_DEMO_URL]), /./);
  }
});

test("a missing or invented protected demo-provisioning verdict always fails", () => {
  for (const mode of ["", "demo_enabled", "allowed", "unknown"]) {
    assert.throws(() => check(307, [PINNED_HOSTED_DEMO_URL], mode),
      /boundary must be attested/);
  }
});

test("CLI enforces checks without emitting HTML, response headers or secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "payrollph-hosted-demo-"));
  const helper = fileURLToPath(new URL("../scripts/qa/verify-production-demo-entrypoint.mjs",
    import.meta.url));
  const headersPath = join(dir, "headers");
  const bodyPath = join(dir, "body");
  const privateMarker = "FICTIONAL_PRIVATE_HTML_SENTINEL_XXXX";
  try {
    writeFileSync(headersPath, header(307, [PINNED_HOSTED_DEMO_URL]));
    writeFileSync(bodyPath, privateMarker);
    const call = (status = "307") => spawnSync(process.execPath,
      [helper, status, headersPath, bodyPath, "blocked_non_demo_employer"],
      { encoding: "utf8" });
    const pass = call();
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /pinned-hosted-redirect/);
    writeFileSync(headersPath, header(307, ["https://evil.invalid/demo"]));
    const denied = call();
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /response data withheld/);
    for (const output of [pass.stdout, pass.stderr, denied.stdout, denied.stderr]) {
      assert.ok(!output.includes(privateMarker));
      assert.ok(!output.includes("evil.invalid"));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow must not follow external redirects or log returned HTML", () => {
  const workflow = readFileSync(new URL("../.github/workflows/live-rbac-sandbox-smoke.yml",
    import.meta.url), "utf8");
  const step = workflow.split("- name: Wait for production demo page")[1]
    ?.split("\n      - name: Verify anonymous Workforce/BI reads")[0];
  assert.ok(step);
  assert.match(step, /verify-production-demo-entrypoint\.mjs/);
  assert.match(step, /VERIFIED_DEMO_BOUNDARY_MODE/);
  assert.match(step, /--proto '=https'/);
  assert.match(step, /--max-time 15/);
  assert.match(step, /-D "\$header_file"/);
  assert.doesNotMatch(step, /curl[^\n]*\s-L(?:\s|$)/);
  assert.doesNotMatch(step, /curl[^\n]*--location(?:\s|$)/);
  assert.doesNotMatch(step, /cat\s+.*(?:page_file|header_file|json|html)/);
});
