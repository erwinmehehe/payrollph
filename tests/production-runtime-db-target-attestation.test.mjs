import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attestRuntimeTarget, compareRuntimeEvidence, validateExpectations, RUNTIME_PROBE_URL,
} from "../scripts/qa/verify-production-runtime-db-target.mjs";

const SHA = "a".repeat(40);
const TOKEN = "synthetic-do-not-use-for-prod-very-long-token";
const expected = Object.freeze({
  commitSha: SHA,
  databaseName: "neondb",
  projectId: "calm-wave-70219564",
  branchId: "br-lucky-sound-b79i56jw",
  endpointId: "ep-cool-hat-b7e7gpoo",
  roleName: "neondb_owner",
});
function payload() {
  return {
    deploymentSha: SHA,
    deploymentEnvironment: "production",
    evidenceScope: "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL",
    database: {
      databaseName: "neondb", projectId: "calm-wave-70219564",
      branchId: "br-lucky-sound-b79i56jw",
      endpointId: "ep-cool-hat-b7e7gpoo",
      roleName: "neondb_owner", inRecovery: false,
    },
    schemaPresence: {
      compensationTablesPresent: 0, compensationTablesExpected: 6,
      migrationLedgerTablesPresent: 0, migrationLedgerTablesExpected: 3,
      evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL",
    },
  };
}

test("#1198 fixed-origin authorized private GET with no redirection or secret output", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, RUNTIME_PROBE_URL);
    assert.equal(url, "https://erwinmehehe-payrollph.vercel.app/api/readiness/database-target");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["x-readiness-token"], TOKEN);
    assert.equal(options.headers.Accept, "application/json");
    return new Response(JSON.stringify(payload()), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const result = await attestRuntimeTarget({ token: TOKEN, expectations: expected, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(result.neonSessionIdentityMatchesIndependentConfiguration, true);
  assert.equal(result.compensationTablesPresent, 0);
  assert.equal(result.migrationLedgerTablesPresent, 0);
  assert.equal(result.productionMigrationApproved, false);
  assert.equal(result.historicalMigrationReceiptsProven, false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(JSON.stringify(result).includes("neondb_owner"), false);
});

test("post-cutover app role and clean baseline are attested only at the fixed Vercel origin", async () => {
  const target = { ...expected, databaseName: "payrollph_clean_baseline",
    branchId: "br-young-leaf-b7ae1g8v", endpointId: "ep-aged-surf-b7ru90rs", roleName: "payrollph_app" };
  const live = payload();
  Object.assign(live.database, target);
  delete live.database.commitSha;
  live.schemaPresence.compensationTablesPresent = 6;
  live.schemaPresence.migrationLedgerTablesPresent = 3;
  let calls = 0;
  const result = await attestRuntimeTarget({ token: TOKEN, expectations: target,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://erwinmehehe-payrollph.vercel.app/api/readiness/database-target");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(live), { status: 200, headers: { "content-type": "application/json" } });
    } });
  assert.equal(calls, 1);
  assert.equal(result.neonSessionIdentityMatchesIndependentConfiguration, true);
  assert.equal(result.compensationTablesPresent, 6);
  assert.equal(result.migrationLedgerTablesPresent, 3);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  await assert.rejects(attestRuntimeTarget({ token: TOKEN, expectations: target,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://unverified.invalid/" } }),
  }), /RUNTIME_DB_TARGET_ATTESTATION_BLOCKED/);
});

test("#1198 mismatched runtime, source, role, schema evidence fail closed", () => {
  const changes = [
    r => { r.deploymentSha = "b".repeat(40); },
    r => { r.deploymentEnvironment = "preview"; },
    r => { r.database.branchId = "br-another-branch"; },
    r => { r.database.endpointId = "ep-other-endpoint"; },
    r => { r.database.projectId = "wrong-project"; },
    r => { r.database.roleName = "another_role"; },
    r => { r.database.databaseName = "wrongdb"; },
    r => { r.database.inRecovery = true; },
    r => { r.evidenceScope = "CLAIM_RELEASE_APPROVAL"; },
    r => { r.schemaPresence.compensationTablesPresent = 7; },
    r => { r.schemaPresence.migrationLedgerTablesPresent = "0"; },
    r => { r.schemaPresence.migrationLedgerTablesExpected = 1; },
  ];
  for (const change of changes) {
    const altered = payload();
    change(altered);
    assert.throws(() => compareRuntimeEvidence(altered, expected),
      /RUNTIME_DB_TARGET_ATTESTATION_BLOCKED/);
  }
  assert.throws(() => validateExpectations({ ...expected, branchId: "" }));
  assert.throws(() => compareRuntimeEvidence({}, expected));
});

test("#1198 missing token refuses request; HTTP failures don't expose response body", async () => {
  let called = false;
  await assert.rejects(
    attestRuntimeTarget({ token: "missing", expectations: expected,
      fetchImpl: async () => { called = true; throw Error("should never be called"); } }),
    /RUNTIME_DB_TARGET_ATTESTATION_BLOCKED/,
  );
  assert.equal(called, false);
  await assert.rejects(attestRuntimeTarget({ token: TOKEN, expectations: expected,
    fetchImpl: async () => new Response("private database URL and secrets", {
      status: 404, headers: { "content-type": "text/plain" },
    }) }), /RUNTIME_DB_TARGET_ATTESTATION_BLOCKED/);
  await assert.rejects(attestRuntimeTarget({ token: TOKEN, expectations: expected,
    fetchImpl: async () => new Response("private database URL and secrets", {
      status: 503, headers: { "content-type": "application/json" },
    }) }), /RUNTIME_DB_TARGET_ATTESTATION_BLOCKED/);
});

test("#1198 protected manual-only workflow cannot use DB writer credentials or migrations", () => {
  const yaml = readFileSync(".github/workflows/production-runtime-db-target-attestation.yml", "utf8");
  const source = readFileSync("scripts/qa/verify-production-runtime-db-target.mjs", "utf8");
  assert.match(yaml, /\bworkflow_dispatch:/);
  assert.doesNotMatch(yaml, /^\s{2}pull_request:|^\s{2}push:/m);
  assert.match(yaml, /environment: production/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /secrets\.PRODUCTION_READINESS_TOKEN/);
  assert.match(yaml, /vars\.PRODUCTION_NEON_BRANCH_ID/);
  assert.match(yaml, /vars\.PRODUCTION_RUNTIME_DB_ROLE/);
  assert.doesNotMatch(yaml, /secrets\.(?:DATABASE_URL|PRODUCTION_DATABASE_URL|PRODUCTION_MIGRATION_WRITER_DATABASE_URL)/);
  assert.doesNotMatch(yaml, /\b(?:npm run db:push|psql|drizzle-kit|schema:push|migrate:apply)\b/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+(?:TABLE|INTO|FROM|ROLE)\b/i);
  assert.match(source, /redirect: "error"/);
});

test("#1198 external GitHub actions must use full immutable 40-character pins", () => {
  const yaml = readFileSync(".github/workflows/production-runtime-db-target-attestation.yml", "utf8");
  const pins = [...yaml.matchAll(/^[ \t]*uses:[ \t]*(actions\/[a-z0-9_-]+)@([^ \t#\r\n]+)/gm)];
  assert.equal(pins.length, 2, "Both GitHub Actions dependencies must be pinned");
  for (const [, action, ref] of pins) {
    assert.match(ref, /^[0-9a-f]{40}$/, action + " must use a complete immutable commit SHA");
  }
});
