import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  requireDisposableSsoDiscovery, assertNoStore, assertFound, assertUnavailable,
} from "../scripts/qa/tenant-sso-discovery-proof.mjs";

const routeFile = "src/app/api/auth/sso/resolve/route.ts";
function gitBlobSha(content) {
  return createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0" + content).digest("hex");
}
const fakeHeaders = new Map([["cache-control", "no-store, max-age=0"]]);
function fake(json, status = 200, headers = fakeHeaders) {
  return { json, status, text: JSON.stringify(json), headers };
}

test("SSO fixture rejects remote databases, development servers, real credentials and worker/money flags", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_SSO_DISCOVERY_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  assert.equal(requireDisposableSsoDiscovery(safe), true);
  for (const [key, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"], ["NODE_ENV", "development"],
    ["TENANT_SSO_DISCOVERY_MODE", ""],
    ["DATABASE_URL", "postgresql://prod.example.invalid/customer"],
    ["SECURITY_SMOKE_URL", "http://other.example.invalid:3000"],
    ["APP_BASE_URL", "https://prod.example.invalid"],
    ["DEMO_MODE", "true"], ["WORKER_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["OPENAI_API_KEY", "live-example"], ["NEON_DATABASE_URL", "postgresql://prod.invalid/x"],
  ]) {
    assert.throws(() => requireDisposableSsoDiscovery({ ...safe, [key]: value }),
      /SSO_DISCOVERY_REFUSED/, key);
  }
});

test("positive discovery contains only the intended provider; wrong provider or victim marker is refused", () => {
  const expected = { id: 8, name: "Fictional own OIDC" };
  const email = "worker+ci@own.example.invalid";
  const success = fake({
    available: true, providerId: 8, providerName: expected.name,
    startUrl: "/api/auth/sso/start?providerId=8&loginHint=worker%2Bci%40own.example.invalid",
  });
  assert.doesNotThrow(() => assertFound(success, expected, email, ["Foreign OIDC"]));
  assert.throws(() => assertFound(success, { ...expected, id: 9 }, email), /8 !== 9/);
  assert.throws(() => assertFound({ ...success, text: success.text + "Foreign OIDC" },
    expected, email, ["Foreign OIDC"]), /foreign organization/);
  assert.throws(() => assertNoStore(new Map([["cache-control", "public, max-age=30"]])),
    /must not be cached/);
});

test("invalid and foreign-domain records return the same non-disclosing unavailable object", () => {
  const unavailable = fake({ available: false });
  assert.doesNotThrow(() => assertUnavailable(unavailable, ["Foreign OIDC"]));
  assert.throws(() => assertUnavailable(fake({ available: false, providerId: 6 })),
    /deep-equal/);
  assert.throws(() => assertUnavailable({ ...unavailable, text: "Foreign OIDC" },
    ["Foreign OIDC"]), /tenant marker leaked/);
});

test("real HTTP proof has two employer positives, a higher-ID victim, a cross-org FK and immutable SQL", () => {
  const route = readFileSync(routeFile, "utf8");
  const runner = readFileSync("scripts/qa/tenant-sso-discovery-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-sso-discovery-http.yml", "utf8");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles[routeFile];
  assert.equal(entry.gitBlobSha, gitBlobSha(route));
  assert.equal(entry.methods.find(m => m.name === "POST")?.status, "GAP");
  const start = runner.indexOf("requireDisposableSsoDiscovery();");
  const dbImport = runner.indexOf('import("../../src/db/index.ts")');
  assert.ok(start >= 0 && dbImport > start, "DB import must follow explicit disposable-only guard");
  for (const fragment of [
    'seedEmployer("SSOA"', 'seedEmployer("SSOB"', 'seedEmployer("SSO_VICTIM"',
    "victim.org.id > Math.max(a.org.id, b.org.id)",
    "victim.owner.id > Math.max(a.owner.id, b.owner.id)",
    "providerV.id > Math.max(providerA.id, providerB.id)",
    "providerId: providerV.id", "assertUnavailable(await post(",
    "assertFound(own", "assert.deepEqual(await snapshot(), mismatched",
    "samlAndUnverifiedDomainsDenied: true",
    "completeMethodCredits: 0",
  ]) assert.ok(runner.includes(fragment), "missing actual HTTP proof: " + fragment);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-sso-discovery-http\.mjs/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: 'false'/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: 'false'/);
});
