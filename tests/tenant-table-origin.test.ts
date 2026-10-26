import assert from "node:assert/strict";
import test from "node:test";
import { TENANT_TABLE_BASE_ENV } from "../scripts/qa/tenant-table-env.mjs";
import { canonicalAppOrigin, enforceSameOriginMutation } from "../src/lib/security-request";

test("disposable table probes use localhost transport with production-valid HTTPS canonical metadata", () => {
  const keys = ["NODE_ENV", "APP_BASE_URL", "TRUSTED_APP_ORIGINS", "VERCEL_PROJECT_PRODUCTION_URL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = TENANT_TABLE_BASE_ENV.NODE_ENV;
  env.APP_BASE_URL = TENANT_TABLE_BASE_ENV.APP_BASE_URL;
  delete env.TRUSTED_APP_ORIGINS; delete env.VERCEL_PROJECT_PRODUCTION_URL;
  try {
    const transport = new URL(TENANT_TABLE_BASE_ENV.SECURITY_SMOKE_URL);
    assert.equal(transport.protocol, "http:"); assert.equal(transport.hostname, "127.0.0.1");
    assert.equal(new URL(TENANT_TABLE_BASE_ENV.DATABASE_URL).hostname, "127.0.0.1");
    assert.equal(new URL(TENANT_TABLE_BASE_ENV.APP_BASE_URL).protocol, "https:");
    assert.notEqual(transport.origin, TENANT_TABLE_BASE_ENV.APP_BASE_URL);
    const request = (origin: string, site: string) => new Request(new URL("/api/enterprise", transport), {
      method: "POST", headers: { origin, "sec-fetch-site": site },
    });
    const own = request(transport.origin, "same-origin");
    assert.equal(canonicalAppOrigin(own), "https://payroll.example.test");
    assert.equal(enforceSameOriginMutation(own), null);
    assert.equal(enforceSameOriginMutation(request("https://attacker.invalid", "cross-site"))?.status, 403);
    assert.equal(enforceSameOriginMutation(request("https://attacker.invalid", "same-origin"))?.status, 403);
    assert.equal(enforceSameOriginMutation(new Request(new URL("/api/enterprise", transport), { method: "POST" }))?.status, 403);
    env.APP_BASE_URL = transport.origin;
    assert.throws(() => canonicalAppOrigin(own), /must use HTTPS in production/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete env[key]; else env[key] = previous[key];
    }
  }
});
