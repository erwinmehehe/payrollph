import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tenantReadinessUnavailable } from "../src/lib/workspace-readiness-boundary";

test("employer workspace fails closed without readiness metrics, gates or a success response", async () => {
  for (const organizationId of [41, 42]) {
    const response = tenantReadinessUnavailable(organizationId);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body, {
      code: "WORKSPACE_READINESS_UNAVAILABLE",
      error: "Readiness evidence is unavailable for this employer. No launch or pilot status has been verified.",
    });
    for (const field of ["status", "gates", "counts", "manualLaunch", "launchBlockersRemaining", "scaleGapsRemaining"]) {
      assert.equal(Object.hasOwn(body, field), false, field);
    }
  }
  for (const org of [0, -1, NaN, Infinity, 2.5]) {
    const response = tenantReadinessUnavailable(org);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("tenant-selected route never invokes global readiness builder", () => {
  const route = readFileSync("src/app/api/readiness/workspace/route.ts", "utf8");
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /assertOrganizationRole\(/);
  assert.match(route, /ORG_ADMIN_ROLES/);
  assert.match(route, /!access\?\.companyWide/);
  assert.match(route, /return tenantReadinessUnavailable\(organizationId\)/);
  assert.doesNotMatch(route, /buildReadinessPayload|operational-readiness/);
  const panel = readFileSync("src/components/workspace/launch-readiness-panel.tsx", "utf8");
  assert.match(panel, /Workspace readiness unavailable/);
  assert.match(panel, /Retry readiness check/);
});

test("internal operations diagnostics continue requiring their existing token", () => {
  const internal = readFileSync("src/app/api/readiness/route.ts", "utf8");
  const pilot = readFileSync("src/app/api/readiness/pilot-status/route.ts", "utf8");
  assert.match(internal, /constantTimeSecretEqual\(supplied, expected\)/);
  assert.match(internal, /buildReadinessPayload\(\)/);
  assert.match(pilot, /constantTimeSecretEqual\(request\.headers\.get\("x-readiness-token"\), expected\)/);
  assert.match(pilot, /buildReadinessPayload\(\)/);
});
