import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("0075 adds protocol-specific SAML metadata and replay-resistant login state", () => {
  const migration = read("drizzle/0075_saml_enterprise_identity_foundation.sql");
  assert.ok(migration.includes('ALTER COLUMN "issuer" DROP NOT NULL'));
  assert.ok(migration.includes('"saml_entity_id"'));
  assert.ok(migration.includes('"saml_sso_url"'));
  assert.ok(migration.includes('"saml_x509_certificate"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "saml_login_states"'));
  assert.ok(migration.includes('"request_id_hash" text NOT NULL UNIQUE'));
  assert.ok(migration.includes('"relay_state_hash" text NOT NULL UNIQUE'));
});

test("fresh database schema mirrors SAML identity foundation", () => {
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  for (const source of [schema, baseline]) {
    assert.ok(source.includes("saml_entity_id"));
    assert.ok(source.includes("saml_sso_url"));
    assert.ok(source.includes("saml_x509_certificate"));
    assert.ok(source.includes("saml_login_states"));
  }
  assert.ok(schema.includes("export const samlLoginStates"));
});

test("SAML helpers validate X509 certificates and emit signed-assertion-required metadata", () => {
  const saml = read("src/lib/saml.ts");
  assert.ok(saml.includes("new X509Certificate"));
  assert.ok(saml.includes("validFrom"));
  assert.ok(saml.includes("validTo"));
  assert.ok(saml.includes('WantAssertionsSigned="true"'));
  assert.ok(saml.includes("SAML_RUNTIME_BLOCK_REASON"));
  assert.ok(saml.includes("samlRuntimeReady()"));
  assert.ok(saml.includes("return false"));
});

test("SAML ACS and start routes fail closed until XML signature verification is installed", () => {
  const acs = read("src/app/api/auth/saml/acs/[providerId]/route.ts");
  const start = read("src/app/api/auth/saml/start/[providerId]/route.ts");
  for (const source of [acs, start]) {
    assert.ok(source.includes("SAML_RUNTIME_BLOCK_REASON"));
    assert.ok(source.includes("SAML_RUNTIME_NOT_READY"));
    assert.ok(source.includes("status: 503"));
  }
  assert.equal(acs.includes("createSession("), false);
  assert.equal(start.includes("Response.redirect("), false);
});

test("public SAML SP metadata exposes only service-provider integration coordinates", () => {
  const metadata = read("src/app/api/auth/saml/metadata/[providerId]/route.ts");
  assert.ok(metadata.includes("buildSamlServiceProviderMetadata"));
  assert.ok(metadata.includes("application/samlmetadata+xml"));
  assert.ok(metadata.includes("/api/auth/saml/acs/"));
  assert.equal(metadata.includes("samlX509Certificate"), false);
});

test("enterprise administration can configure but not enable SAML providers", () => {
  const enterprise = read("src/app/api/enterprise/route.ts");
  assert.ok(enterprise.includes('action === "create-saml-provider"'));
  assert.ok(enterprise.includes('protocol: "saml"'));
  assert.ok(enterprise.includes("normalizeSamlCertificate"));
  assert.ok(enterprise.includes("validateSamlSsoUrl"));
  assert.ok(enterprise.includes("samlCertificateFingerprintSha256"));
  assert.ok(enterprise.includes('provider.protocol === "saml"'));
  assert.ok(enterprise.includes('"SAML_RUNTIME_NOT_READY"'));
  assert.ok(enterprise.includes("runtimeReady: false"));
});

test("OIDC routes remain protocol-specific after provider schema normalization", () => {
  const start = read("src/app/api/auth/sso/start/route.ts");
  const callback = read("src/app/api/auth/sso/callback/route.ts");
  for (const source of [start, callback]) {
    assert.ok(source.includes('eq(identityProviders.protocol, "oidc")'));
    assert.ok(source.includes("configuration is incomplete"));
  }
});

test("enterprise UI labels SAML as configured but runtime blocked", () => {
  const panel = read("src/components/enterprise-controls-panel.tsx");
  assert.ok(panel.includes("Enterprise SAML configuration"));
  assert.ok(panel.includes("create-saml-provider"));
  assert.ok(panel.includes("SP metadata:"));
  assert.ok(panel.includes("ACS:"));
  assert.ok(panel.includes("Cert SHA-256:"));
  assert.ok(panel.includes("Enable blocked"));
  assert.ok(panel.includes("runtime blocked"));
});
