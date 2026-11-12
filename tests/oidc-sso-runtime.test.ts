import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  OIDC_SSO_RUNTIME_POLICY, oidcSsoDisabledResponse, oidcSsoRuntimeEnabled,
} from "../src/lib/oidc-sso-runtime";

test("OIDC mode defaults OFF; only exact enabled value permits entry", () => {
  assert.equal(OIDC_SSO_RUNTIME_POLICY.env, "OIDC_SSO_RUNTIME_MODE");
  assert.equal(OIDC_SSO_RUNTIME_POLICY.enabledValue, "enabled");
  assert.ok(OIDC_SSO_RUNTIME_POLICY.owner && OIDC_SSO_RUNTIME_POLICY.approval);
  for (const value of [undefined, "", "1", "on", "TRUE", "True", "false", " true", "enabled "]) {
    assert.equal(oidcSsoRuntimeEnabled({ OIDC_SSO_RUNTIME_MODE: value }), false);
  }
  assert.equal(oidcSsoRuntimeEnabled({ OIDC_SSO_RUNTIME_MODE: "enabled" }), true);
});

test("disabled SSO is non-cacheable, does not set cookies, and reveals no provider metadata", async () => {
  const response = oidcSsoDisabledResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    error: "SSO sign-in is not available.",
    code: "OIDC_SSO_RUNTIME_DISABLED",
  });
});

test("each SSO handler checks runtime hold before request, database and cookie access", () => {
  const sources = [
    ["src/app/api/auth/sso/start/route.ts", "new URL(request.url)"],
    ["src/app/api/auth/sso/callback/route.ts", "new URL(request.url)"],
    ["src/app/api/auth/sso/resolve/route.ts", "enforceSameOriginMutation(request)"],
  ] as const;
  for (const [path, nextOperation] of sources) {
    const src = readFileSync(path, "utf8");
    const gate = src.indexOf("if (!oidcSsoRuntimeEnabled()) return oidcSsoDisabledResponse();");
    assert.ok(gate > 0, path);
    assert.ok(src.indexOf(nextOperation) > gate, path);
    for (const downstream of ["await db.", "await cookies()", "await createSession("]) {
      const found = src.indexOf(downstream);
      assert.ok(found === -1 || found > gate, path + ": " + downstream);
    }
  }
});
