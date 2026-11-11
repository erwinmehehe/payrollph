import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ROUTE, ROUTE_BLOB, HIDDEN_PROVIDER_BODY, requireIsolatedSamlProof,
  assertMetadata, assertSameMetadata, assertMissingMetadata, assertHiddenMetadata,
} from "../scripts/qa/tenant-saml-metadata-public-contract.mjs";

function blobSha(text) {
  return createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0" + text).digest("hex");
}
function response(text, status = 200) {
  return {
    text, status,
    headers: new Map([
      ["content-type", status === 200 ? "application/samlmetadata+xml; charset=utf-8" : "application/json"],
      ["cache-control", "no-store"], ["x-content-type-options", "nosniff"],
    ]),
  };
}
function xml(id) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ' +
    'entityID="https://payroll.example.test/api/auth/saml/metadata/' + id + '">' +
    '<SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" ' +
    'protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">' +
    '<AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ' +
    'Location="https://payroll.example.test/api/auth/saml/acs/' + id +
    '" index="0" isDefault="true"/></SPSSODescriptor></EntityDescriptor>';
}

test("repaired SAML GET remains GAP and selects only public fields from enabled SAML providers", () => {
  const source = readFileSync(ROUTE, "utf8");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles[ROUTE];
  assert.equal(blobSha(source), ROUTE_BLOB, "new route source requires new public proof");
  assert.equal(entry.gitBlobSha, ROUTE_BLOB);
  assert.equal(entry.methods.length, 1);
  const method = entry.methods.find(x => x.name === "GET");
  assert.equal(method.status, "GAP", "no unauthorized public-by-design credit");
  assert.equal(method.testedBy, null);
  assert.match(source, /export async function GET\(/);
  assert.match(source, /db\.select\(\{\s*id: identityProviders\.id,\s*protocol: identityProviders\.protocol/);
  assert.match(source, /eq\(identityProviders\.protocol, "saml"\)/);
  assert.match(source, /eq\(identityProviders\.enabled, true\)/);
  assert.match(source, /canonicalAppOrigin\(request\)/);
  assert.match(source, /buildSamlServiceProviderMetadata\(\{/);
  assert.doesNotMatch(source, /clientSecretEncrypted|passwordHash|samlX509Certificate|backupCodes/);
  assert.doesNotMatch(source, /getSessionUser|userOrganizations|payrollRuns|organizationId/);
});

test("environment guard refuses remote servers, real credentials, workers and protected flags", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_SAML_METADATA_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000", APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED: "false", EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
    PAYROLL_CALCULATION_HISTORY_ENABLED: "false", NEXT_CSP_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireIsolatedSamlProof(safe));
  for (const [key, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["DATABASE_URL", "postgresql://db.production.invalid/payroll"],
    ["SECURITY_SMOKE_URL", "https://live.invalid"], ["APP_BASE_URL", "https://live.invalid"],
    ["TENANT_SAML_METADATA_MODE", ""], ["WORKER_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "fake"], ["OPENAI_API_KEY", "fake"],
    ...["FINAL_PAY_SIGNED_REVIEW_ENABLED", "EXACT_THIRTEENTH_CENTAVOS_ENABLED",
      "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED"].map(key => [key, "true"]),
  ]) assert.throws(() => requireIsolatedSamlProof({ ...safe, [key]: value }), /SAML_PROOF_REFUSED/, key);
});

test("enabled XML rejects errors, wrong IDs, private fields and cacheable responses", () => {
  const good = response(xml(7));
  assert.doesNotThrow(() => assertMetadata(good, 7, ["PRIVATE_MARKER"]));
  assert.throws(() => assertMetadata(response(xml(7), 404), 7), /return 200/);
  assert.throws(() => assertMetadata(good, 8), /Entity ID/);
  assert.throws(() => assertMetadata(response(xml(7) + "PRIVATE_MARKER"), 7, ["PRIVATE_MARKER"]), /marker leaked/);
  for (const [header, value] of [["cache-control", "private, max-age=300"], ["x-content-type-options", ""]]) {
    const unsafe = response(xml(7));
    unsafe.headers.set(header, value);
    assert.throws(() => assertMetadata(unsafe, 7));
  }
});

test("hidden provider requires exact generic 404, no XML and no-store", () => {
  const missing = response(HIDDEN_PROVIDER_BODY, 404);
  assert.doesNotThrow(() => assertHiddenMetadata(missing, missing, ["PRIVATE_MARKER"]));
  for (const bad of [response(xml(7)), response(HIDDEN_PROVIDER_BODY, 400),
    response(HIDDEN_PROVIDER_BODY, 500), response('{"error":"Provider disabled."}', 404),
    response("PRIVATE_MARKER", 404), response(xml(7), 404)]) {
    assert.throws(() => assertHiddenMetadata(bad, missing, ["PRIVATE_MARKER"]));
  }
  const cached = response(HIDDEN_PROVIDER_BODY, 404);
  cached.headers.set("cache-control", "public, max-age=300");
  assert.throws(() => assertHiddenMetadata(cached, missing), /must not be cached/);
});

test("production no-store normalization stays strict for enabled and hidden providers", () => {
  for (const cache of ["no-store", "no-store, max-age=0"]) {
    const enabled = response(xml(7));
    const hidden = response(HIDDEN_PROVIDER_BODY, 404);
    enabled.headers.set("cache-control", cache);
    hidden.headers.set("cache-control", cache);
    assert.doesNotThrow(() => assertMetadata(enabled, 7));
    assert.doesNotThrow(() => assertHiddenMetadata(hidden, hidden));
  }
  for (const cache of ["", "max-age=0", "no-cache", "public, max-age=300",
    "no-store, max-age=300", "no-store, s-maxage=300", "no-store, public"]) {
    const enabled = response(xml(7));
    const hidden = response(HIDDEN_PROVIDER_BODY, 404);
    enabled.headers.set("cache-control", cache);
    hidden.headers.set("cache-control", cache);
    assert.throws(() => assertMetadata(enabled, 7), /must not be cached/);
    assert.throws(() => assertHiddenMetadata(hidden, hidden), /must not be cached/);
  }
  const hidden = response(HIDDEN_PROVIDER_BODY, 404);
  const different = response(HIDDEN_PROVIDER_BODY, 404);
  different.headers.set("cache-control", "no-store, max-age=0");
  assert.throws(() => assertHiddenMetadata(different, hidden), /header differs/);
});

test("malformed IDs are specifically 400, not an arbitrary failure", () => {
  assert.doesNotThrow(() => assertMissingMetadata(response("Invalid ID", 400), [], 400));
  assert.throws(() => assertMissingMetadata(response("Invalid ID", 404), [], 400));
  assert.throws(() => assertMissingMetadata(response("Unavailable", 503), [], 400));
  assert.throws(() => assertMissingMetadata(response("PRIVATE_MARKER", 400), ["PRIVATE_MARKER"], 400), /marker leaked/);
});

test("metadata must match across callers and forged selectors including cache headers", () => {
  assert.doesNotThrow(() => assertSameMetadata(response(xml(7)), response(xml(7))));
  assert.throws(() => assertSameMetadata(response(xml(7)), response(xml(8))), /selector-independent/);
  const cached = response(xml(7));
  cached.headers.set("cache-control", "max-age=300");
  assert.throws(() => assertSameMetadata(response(xml(7)), cached), /header differs/);
});

test("real HTTP proof keeps three employers, enabled positives, privacy denials and unchanged SQL", () => {
  const runner = readFileSync("scripts/qa/tenant-saml-metadata-public-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-saml-metadata-public-http.yml", "utf8");
  assert.ok(runner.indexOf("requireIsolatedSamlProof();") < runner.indexOf('import("../../src/db/index.ts")'));
  for (const token of [
    'seedEmployer("SAML_A"', 'seedEmployer("SAML_B"', 'seedEmployer("SAML_VICTIM"',
    "victim.worker.id > Math.max", "assertSameMetadata(anonymous, actual)", "assertHiddenMetadata",
    "assert.deepEqual(await snapshot(), expectedState", "coverageCredits: 0", "independentlyAccepted: false",
    "providers.every(p => p.enabled === true)", "disabledProviders.every(p => p.enabled === false)",
    "enabledThenDisabledConcealed: true", "disabledAndMissingIdentical404: true",
    'disabledProviderPublicPolicy: "CONCEAL_DISABLED_PROVIDERS"', "fixtureProviderDisableWrites: 1",
    "assert.deepEqual(expectedState, expectedAfterToggle",
  ]) assert.ok(runner.includes(token), "missing PG16 invariant " + token);
  assert.doesNotMatch(runner, /disabledSamlProviderMetadataIsAnonymous200: true|PENDING_IDENTITY_SECURITY_OWNER_DECISION/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-saml-metadata-public-http\.mjs/);
  assert.match(workflow, /tests\/tenant-saml-metadata-disabled-route\.test\.mjs/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
});
