import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ROUTE, ROUTE_BLOB, requireIsolatedSamlProof,
  assertMetadata, assertSameMetadata, assertMissingMetadata,
} from "../scripts/qa/tenant-saml-metadata-public-contract.mjs";

function blobSha(text) {
  return createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0" + text).digest("hex");
}
function response(text, status = 200) {
  return {
    text, status,
    headers: new Map([["content-type", "application/samlmetadata+xml; charset=utf-8"]]),
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

test("unchanged SAML GET is GAP; selecting only public provider fields is source pinned", () => {
  const source = readFileSync(ROUTE, "utf8");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles[ROUTE];
  assert.equal(blobSha(source), ROUTE_BLOB, "new route source requires new public proof");
  assert.equal(entry.gitBlobSha, ROUTE_BLOB);
  const method = entry.methods.find(x => x.name === "GET");
  assert.equal(method.status, "GAP", "no unauthorized public-by-design credit");
  assert.equal(method.testedBy, null);
  assert.match(source, /export async function GET\(/);
  assert.match(source, /db\.select\(\{\s*id: identityProviders\.id,\s*protocol: identityProviders\.protocol/);
  assert.match(source, /eq\(identityProviders\.protocol, "saml"\)/);
  assert.match(source, /canonicalAppOrigin\(request\)/);
  assert.match(source, /buildSamlServiceProviderMetadata\(\{/);
  assert.doesNotMatch(source, /clientSecretEncrypted|passwordHash|samlX509Certificate|backupCodes/);
  assert.doesNotMatch(source, /getSessionUser|userOrganizations|payrollRuns|organizationId/);
});

test("environment guard refuses remote servers, real credentials or enabled workers", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_SAML_METADATA_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireIsolatedSamlProof(safe));
  for (const [key, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["DATABASE_URL", "postgresql://db.production.invalid/payroll"],
    ["SECURITY_SMOKE_URL", "https://live.invalid"],
    ["APP_BASE_URL", "https://live.invalid"],
    ["TENANT_SAML_METADATA_MODE", ""],
    ["WORKER_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "fake"], ["OPENAI_API_KEY", "fake"],
  ]) {
    assert.throws(() => requireIsolatedSamlProof({ ...safe, [key]: value }),
      /SAML_PROOF_REFUSED/, key);
  }
});

test("public XML contract rejects missing methods, wrong IDs and private provider fields", () => {
  const good = response(xml(7));
  assert.doesNotThrow(() => assertMetadata(good, 7, ["PRIVATE_MARKER"]));
  assert.throws(() => assertMetadata(response(xml(7), 404), 7), /return 200/);
  assert.throws(() => assertMetadata(good, 8), /Entity ID/);
  assert.throws(() => assertMetadata(response(xml(7) + "PRIVATE_MARKER"), 7,
    ["PRIVATE_MARKER"]), /marker leaked/);
  assert.doesNotThrow(() => assertMissingMetadata(response("SAML provider not found.", 404),
    ["PRIVATE_MARKER"]));
  assert.throws(() => assertMissingMetadata(good), /must not return/);
  assert.throws(() => assertMissingMetadata(response("PRIVATE_MARKER", 404),
    ["PRIVATE_MARKER"]), /marker leaked/);
});

test("metadata must match across different callers and forged employer selectors", () => {
  assert.doesNotThrow(() => assertSameMetadata(response(xml(7)), response(xml(7))));
  assert.throws(() => assertSameMetadata(response(xml(7)), response(xml(8))),
    /selector-independent/);
});

test("real HTTP runner proves high-ID victim and unchanged SQL before any credit", () => {
  const runner = readFileSync("scripts/qa/tenant-saml-metadata-public-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-saml-metadata-public-http.yml", "utf8");
  assert.ok(runner.indexOf("requireIsolatedSamlProof();") <
    runner.indexOf('import("../../src/db/index.ts")'), "guard must precede importing app DB");
  for (const token of [
    'seedEmployer("SAML_A"', 'seedEmployer("SAML_B"',
    'seedEmployer("SAML_VICTIM"', "victim.worker.id > Math.max",
    "assertSameMetadata(anonymous, actual)", "assertMissingMetadata",
    "assert.deepEqual(await snapshot(), before", "coverageCredits: 0",
    "independentlyAccepted: false",
    "providers.every(p => p.enabled === false)",
    "disabledSamlProviderMetadataIsAnonymous200: true",
    'disabledProviderPublicPolicy: "PENDING_IDENTITY_SECURITY_OWNER_DECISION"',
  ]) assert.ok(runner.includes(token), "missing PG16 invariant " + token);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-saml-metadata-public-http\.mjs/);
});
