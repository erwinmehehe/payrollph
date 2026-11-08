import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LOCAL_METADATA_OPTIONS, requireDisposableDbTarget, assertPrivateDenial,
  assertRuntimeEvidence, assertImmutableSnapshots }
  from "../scripts/qa/tenant-runtime-db-target-contract.mjs";

const good = {
  CI: "true", GITHUB_ACTIONS: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_RUNTIME_DB_TARGET_MODE: "fictional-disposable-only",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PGOPTIONS: LOCAL_METADATA_OPTIONS,
  READINESS_TOKEN: "a".repeat(64),
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", DEMO_MODE: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
};

test("refuse non-GitHub, hosted database, missing token, provider, worker, or non-fictional GUC", () => {
  assert.doesNotThrow(() => requireDisposableDbTarget(good));
  const bad = {
    CI: "false", GITHUB_ACTIONS: "false", TENANT_SECOND_PASS_MODE: "",
    TENANT_RUNTIME_DB_TARGET_MODE: "", NODE_ENV: "production",
    SECURITY_SMOKE_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://postgres:postgres@db.example.invalid/app_db",
    PGOPTIONS: "-c neon.project_id=real-production-id",
    READINESS_TOKEN: "weak",
    WORKER_ENABLED: "true", CENTRAL_SCHEDULER_ENABLED: "true",
    DEMO_MODE: "true", PAYMONGO_DISBURSEMENTS_ENABLED: "true",
    XENDIT_PAYOUTS_ENABLED: "true", XENDIT_BILLING_ENABLED: "true",
    NEON_DATABASE_URL: "postgresql://neon.invalid",
    DATABASE_URL_UNPOOLED: "postgresql://neon.invalid",
    PAYMONGO_SECRET_KEY: "unsafe", XENDIT_SECRET_KEY: "unsafe",
    RESEND_API_KEY: "unsafe", SMTP_URL: "smtp://unsafe.invalid",
  };
  for (const [key, value] of Object.entries(bad)) {
    assert.throws(() => requireDisposableDbTarget({ ...good, [key]: value }),
      /DB_TARGET_QA_REFUSED/, key + " must refuse");
  }
});

function makeResponse(status, json, headers) {
  return { status, json, text: JSON.stringify(json),
    headers: new Headers(headers || { "cache-control": "no-store",
      vary: "x-readiness-token" }) };
}

test("readiness token denials are opaque, equal and cannot disclose tenant markers", () => {
  const denied = makeResponse(404, { error: "Not found." });
  assert.doesNotThrow(() => assertPrivateDenial(denied, ["VICTIM-SECRET"]));
  assert.doesNotThrow(() => assertPrivateDenial(makeResponse(
    404, { error: "Not found." }, {
      "cache-control": "no-store, max-age=0", vary: "x-readiness-token",
    }), ["VICTIM-SECRET"]));
  assert.throws(() => assertPrivateDenial(makeResponse(
    404, { error: "Not found." }, {
      "cache-control": "no-store, max-age=60", vary: "x-readiness-token",
    })));
  assert.throws(() => assertPrivateDenial(makeResponse(
    404, { error: "Not found." }, {
      "cache-control": "no-store, public", vary: "x-readiness-token",
    })));
  assert.throws(() => assertPrivateDenial(makeResponse(
    404, { error: "Not found." }, {
      "cache-control": "no-store, s-maxage=60", vary: "x-readiness-token",
    })));
  assert.throws(() => assertPrivateDenial(makeResponse(200, { error: "Not found." })));
  assert.throws(() => assertPrivateDenial(makeResponse(404, { database: "app_db" })));
  assert.throws(() => assertPrivateDenial(makeResponse(404, { error: "VICTIM-SECRET" }),
    ["VICTIM-SECRET"]));
  assert.throws(() => assertPrivateDenial(makeResponse(404, { error: "Not found." },
    { "cache-control": "public", vary: "x-readiness-token" })));
});

test("authenticated response must carry only session metadata and catalog counts", () => {
  const expected = {
    database: { databaseName: "app_db", projectId: "ci-fictional-project",
      branchId: "br-fictional-branch", endpointId: "ep-fictional-endpoint",
      roleName: "postgres", inRecovery: false },
    schemaPresence: { compensationTablesPresent: 6, compensationTablesExpected: 6,
      migrationLedgerTablesPresent: 2, migrationLedgerTablesExpected: 3,
      evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL" },
  };
  const valid = makeResponse(200, {
    deploymentSha: null, deploymentEnvironment: null,
    database: expected.database, schemaPresence: expected.schemaPresence,
    evidenceScope: "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL",
    generatedAt: new Date().toISOString(),
  });
  assert.doesNotThrow(() => assertRuntimeEvidence(valid, expected,
    ["VICTIM-SECRET", "postgres:postgres"]));
  assert.throws(() => assertRuntimeEvidence(makeResponse(200, {
    ...valid.json, database: { ...valid.json.database, databaseName: "other" } }),
    expected));
  assert.throws(() => assertRuntimeEvidence(makeResponse(200, {
    ...valid.json, connectionString: "postgres:postgres" }), expected));
  assert.throws(() => assertRuntimeEvidence(makeResponse(200, {
    ...valid.json, schemaPresence: { ...valid.json.schemaPresence,
      compensationTablesPresent: 5 } }), expected));
  const before = { employee: [{ id: 1 }], payroll: [{ id: 2 }] };
  assert.doesNotThrow(() => assertImmutableSnapshots(before, structuredClone(before)));
  assert.throws(() => assertImmutableSnapshots(before, {
    ...before, payroll: [{ id: 3 }] }));
});

test("standalone family pins inspected runtime source and does not claim tenant coverage", () => {
  const files = {
    "src/app/api/readiness/database-target/route.ts": "bda08317ec9600d9434491a1376908d36d978b92",
    "src/lib/runtime-database-identity.ts": "2969b7d2371434d1e146184413f29b28e1fe73bc",
    "src/lib/operational-secret.ts": "02d83b4c996e7934c9c3838dcc4cedb85e42c168",
  };
  for (const [path, expectedSha] of Object.entries(files)) {
    const content = readFileSync(path);
    const hash = createHash("sha1").update("blob " + content.length + "\0")
      .update(content).digest("hex");
    assert.equal(hash, expectedSha, path + " changed; re-review before accepting proof");
  }
  const route = readFileSync("src/app/api/readiness/database-target/route.ts", "utf8");
  for (const marker of ["operationalSecret(\"readiness\")",
    "constantTimeSecretEqual", "await import(\"@/db\")",
    "current_setting('neon.project_id', true)",
    "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL",
    "normalizeRuntimeCompensationTableEvidence"]) {
    assert.ok(route.includes(marker), "missing audited runtime barrier " + marker);
  }
  const runner = readFileSync("scripts/qa/tenant-runtime-db-target-http.mjs", "utf8");
  for (const marker of ["requireDisposableDbTarget(process.env)",
    "seedEmployer(\"ATTA\"", "seedEmployer(\"ATTB\"",
    "seedEmployer(\"VICTIM\"", "expectedDatabaseProof()", "assertPrivateDenial(",
    "assertRuntimeEvidence(", "assertImmutableSnapshots(",
    "coverageCredits: 0", "realDataUsed: false"]) {
    assert.ok(runner.includes(marker), "missing independent proof " + marker);
  }
});
