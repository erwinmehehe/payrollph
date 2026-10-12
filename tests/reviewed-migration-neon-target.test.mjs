import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  requirePinnedNeonMigrationTarget, requireProtectedMainForMigrationApply,
} from "../scripts/lib/migration-neon-target.mjs";

const productionHost = "ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech";
const base = {
  EXPECTED_PRODUCTION_DATABASE_NAME: "neondb",
  EXPECTED_PRODUCTION_NEON_PROJECT_ID: "calm-wave-70219564",
  EXPECTED_PRODUCTION_NEON_BRANCH_ID: "br-lucky-sound-b79i56jw",
  EXPECTED_PRODUCTION_NEON_ENDPOINT_ID: "ep-cool-hat-b7e7gpoo",
  MIGRATION_TARGET_DATABASE_URL:
    "postgresql://reviewer:synthetic@" + productionHost + "/neondb?sslmode=require",
};

test("accept only explicitly pinned direct Neon production endpoint before opening a connection", () => {
  assert.deepEqual(requirePinnedNeonMigrationTarget(base), {
    projectId: base.EXPECTED_PRODUCTION_NEON_PROJECT_ID,
    branchId: base.EXPECTED_PRODUCTION_NEON_BRANCH_ID,
    endpointId: base.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID,
  });
});

test("node-postgres routing overrides cannot bypass the URL pin", () => {
  const prefix = "postgresql://reviewer:synthetic@" + productionHost + "/neondb";
  // Executed driver parsing proves this was an actual routing bypass,
  // without opening a connection or using any real credentials.
  assert.equal(new pg.Client({ connectionString: prefix + "?host=wrong.invalid" })
    .connectionParameters.host, "wrong.invalid");
  for (const query of ["host=wrong.invalid", "port=5433", "user=owner", "password=wrong",
    "options=-c%20neon.branch_id%3Dbr-forged", "sslcert=/tmp/private.pem",
    "sslkey=/tmp/private.key", "sslrootcert=/tmp/private.pem", "ssl=0",
    "sslmode=disable", "sslmode=require&sslmode=disable", "uselibpqcompat=true"]) {
    assert.throws(() => requirePinnedNeonMigrationTarget({ ...base,
      MIGRATION_TARGET_DATABASE_URL: prefix + "?" + query,
    }), /CONNECTION_OPTIONS_REJECTED/);
  }
  const safe = prefix + "?sslmode=verify-full&channel_binding=require";
  assert.doesNotThrow(() => requirePinnedNeonMigrationTarget({ ...base, MIGRATION_TARGET_DATABASE_URL: safe }));
  assert.equal(new pg.Client({ connectionString: safe }).connectionParameters.host, productionHost);
});

test("a missing project, branch or endpoint id refuses the runner before any SQL", () => {
  for (const key of [
    "EXPECTED_PRODUCTION_NEON_PROJECT_ID",
    "EXPECTED_PRODUCTION_NEON_BRANCH_ID",
    "EXPECTED_PRODUCTION_NEON_ENDPOINT_ID",
  ]) {
    assert.throws(() => requirePinnedNeonMigrationTarget({ ...base, [key]: "" }),
      /NEON_TARGET_PIN_REQUIRED/);
  }
});

test("wrong database, other Neon endpoint, pooled host, wrong protocol and invalid URLs fail closed", () => {
  for (const url of [
    "postgresql://a:b@ep-dry-dew-b7liu3o6.c-13.us-east-1.aws.neon.tech/neondb",
    "postgresql://a:b@ep-cool-hat-b7e7gpoo-pooler.c-13.us-east-1.aws.neon.tech/neondb",
    "postgresql://a:b@" + productionHost + "/otherdb",
    "postgresql://a:b@127.0.0.1/neondb",
    "https://a:b@" + productionHost + "/neondb",
    "postgresql://a:b@" + productionHost + "/neondb#bad",
  ]) {
    assert.throws(() => requirePinnedNeonMigrationTarget({
      ...base, MIGRATION_TARGET_DATABASE_URL: url,
    }), /NEON_CONNECTION_TARGET_MISMATCH/);
  }
  assert.throws(() => requirePinnedNeonMigrationTarget({
    ...base, MIGRATION_TARGET_DATABASE_URL: "not-a-postgres-url",
  }), /NEON_CONNECTION_URL_INVALID/);
});

test("SQL apply requires GitHub-protected main, while read-only planning remains allowed", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
  };
  assert.doesNotThrow(() => requireProtectedMainForMigrationApply(env, "apply"));
  assert.doesNotThrow(() => requireProtectedMainForMigrationApply({
    ...env, GITHUB_REF_PROTECTED: "false",
  }, "plan"));
  for (const candidate of [
    { ...env, GITHUB_REF_PROTECTED: "false" },
    { ...env, GITHUB_REF_PROTECTED: "" },
    { ...env, GITHUB_REF: "refs/heads/feature" },
    { ...env, GITHUB_ACTIONS: "false" },
  ]) {
    assert.throws(
      () => requireProtectedMainForMigrationApply(candidate, "apply"),
      /REVIEWED_MIGRATION_PROTECTED_MAIN_REQUIRED/,
    );
  }
});
