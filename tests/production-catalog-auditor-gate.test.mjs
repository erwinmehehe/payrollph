import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  CATALOG_AUDITOR_GUARD_SQL, verifyCatalogAuditorFlags,
  assertCatalogAuditorPrivilegeBoundary, catalogAuditorConnectionOptions,
} from "../scripts/lib/production-catalog-auditor-gate.mjs";

const healthy = Object.freeze({
  databaseMatches: true, sessionMatches: true, withoutObjectOwnership: true, readOnly: true, targetMatches: true,
  restrictedAttributes: true, withoutMembership: true,
  withoutDatabaseCreate: true, withoutSchemaCreate: true,
  withoutUnexpectedRelationAccess: true,
  withoutSecurityDefinerExecution: true, journalsReadable: true,
});

test("catalog auditor cannot accept Neon owner, neon_superuser member, or writable role", () => {
  assert.equal(verifyCatalogAuditorFlags(healthy).catalogOnly, true);
  for (const key of [
    "restrictedAttributes", "withoutMembership", "withoutDatabaseCreate",
    "withoutSchemaCreate", "withoutUnexpectedRelationAccess",
    "withoutSecurityDefinerExecution", "targetMatches", "readOnly",
    "databaseMatches", "sessionMatches", "withoutObjectOwnership",
  ]) {
    assert.throws(() => verifyCatalogAuditorFlags({ ...healthy, [key]: false }),
      /P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED/, key);
    assert.throws(() => verifyCatalogAuditorFlags({ ...healthy, [key]: "true" }),
      /P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED/, key);
  }
  assert.throws(() => verifyCatalogAuditorFlags(null),
    /P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED/);
  assert.equal(verifyCatalogAuditorFlags({
    ...healthy, journalsReadable: false,
  }).catalogOnly, true, "pre-receipt schema diagnostics may use a catalog-only account");
  assert.throws(() => verifyCatalogAuditorFlags({
    ...healthy, journalsReadable: false,
  }, { requireJournals: true }), /P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED/);
});

test("privilege boundary fails closed on ambiguous, missing, or duplicate catalog rows", async () => {
  let called = 0;
  const client = { async query(sql, params) {
    called++;
    assert.equal(sql, CATALOG_AUDITOR_GUARD_SQL);
    assert.deepEqual(params, [
      "neondb", "calm-wave-70219564", "br-lucky-sound-b79i56jw",
      "ep-cool-hat-b7e7gpoo",
    ]);
    return { rows: [{ ...healthy }] };
  } };
  assert.equal((await assertCatalogAuditorPrivilegeBoundary(client, {
    expectedDatabase: "neondb", requireJournals: true,
  })).catalogOnly, true);
  assert.equal(called, 1);
  await assert.rejects(() => assertCatalogAuditorPrivilegeBoundary(client, {
    expectedDatabase: "another_database",
  }), /P0_4_CATALOG_AUDITOR_TARGET_NOT_PINNED/);
  assert.equal(called, 1, "wrong target cannot query any database");
  for (const rows of [[], [healthy, healthy], null, [{ ...healthy, withoutMembership: false }]]) {
    await assert.rejects(() => assertCatalogAuditorPrivilegeBoundary({
      async query() { return { rows }; },
    }, { expectedDatabase: "neondb" }), /P0_4_CATALOG_AUDITOR/);
  }
});

test("manual CLI rejects unreviewed source and transport overrides before connecting", () => {
  const sha = "a".repeat(40);
  const base = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "erwinmehehe/payrollph", GITHUB_REF: "refs/heads/main",
    REVIEWED_SHA: sha, GITHUB_SHA: sha,
    EXPECTED_PRODUCTION_DATABASE_NAME: "neondb",
    PRODUCTION_DATABASE_URL: "postgresql://fixture:DO_NOT_PRINT@127.0.0.1/neondb?sslmode=verify-full",
  };
  for (const change of [
    {}, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF: "refs/heads/topic" },
    { REVIEWED_SHA: "b".repeat(40) }, { EXPECTED_PRODUCTION_DATABASE_NAME: "other" },
    { PRODUCTION_DATABASE_URL: "postgresql://fixture:DO_NOT_PRINT@ep-cool-hat-b7e7gpoo.ap-southeast-1.aws.neon.tech/neondb?sslmode=disable" },
    { PRODUCTION_DATABASE_URL: "postgresql://fixture:DO_NOT_PRINT@localhost/neondb?sslmode=verify-full&options=-c%20role%3Dother" },
  ]) {
    const child = spawnSync(process.execPath, ["scripts/verify-production-catalog-auditor.mjs", "--verify"], {
      env: { ...base, ...change }, encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.match(child.stderr, /P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED_OR_TARGET_UNVERIFIED/);
    assert.ok(!child.stderr.includes("DO_NOT_PRINT"));
    assert.ok(!child.stderr.includes("postgresql://"));
  }
});

test("every caller's connection options require exact pinned verified TLS without overrides", () => {
  const host = "ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech";
  const valid = `postgresql://fixture:FICTIONAL@${host}/neondb?sslmode=verify-full`;
  const options = catalogAuditorConnectionOptions(valid, "neondb");
  assert.equal(options.connectionString, valid);
  assert.equal(options.ssl.rejectUnauthorized, true);
  for (const url of [valid + "&options=-c%20role%3Dother", valid + "&host=localhost",
    valid.replace(host, "127.0.0.1"), valid.replace(host, host.replace(".c-13", "-pooler.c-13")),
    valid.replace("verify-full", "require"), valid.replace("/neondb", "/other"), valid + "#fragment"]) {
    assert.throws(() => catalogAuditorConnectionOptions(url, "neondb"));
  }
  assert.throws(() => catalogAuditorConnectionOptions(valid, "other"));
  assert.throws(() => verifyCatalogAuditorFlags(healthy, { requireJournals: "" }));
});
