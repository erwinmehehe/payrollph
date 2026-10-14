import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/live-rbac-sandbox-smoke.yml", import.meta.url),
  "utf8",
);
const roleStep = workflow.split("- name: Verify all six RBAC personas on production")[1];

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
  assert.match(demo, /trap 'rm -f -- "\$page_file"' EXIT/);
  assert.doesNotMatch(readiness + demo, /cat\s+.*(?:html|json|body|headers)/);
  assert.match(readiness, /\.deploymentSha \| test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(demo, /--max-time 15/);
});
