import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CATALOG_AUDITOR_GUARD_SQL, verifyCatalogAuditorFlags,
  assertCatalogAuditorPrivilegeBoundary,
} from "../scripts/lib/production-catalog-auditor-gate.mjs";

const healthy = Object.freeze({
  databaseMatches: true, readOnly: true, targetMatches: true,
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
    "databaseMatches",
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

test("catalog-only SQL tests effective privileges in EVERY user schema", () => {
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /pg_catalog\.pg_auth_members/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /rolbypassrls/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /rolinherit/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /has_any_column_privilege/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /has_sequence_privilege/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /has_schema_privilege/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /pg_catalog\.pg_proc/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /prosecdef/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /neon\.project_id/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /neon\.endpoint_id/);
  assert.match(CATALOG_AUDITOR_GUARD_SQL, /payrollph_schema_migrations/);
  assert.doesNotMatch(CATALOG_AUDITOR_GUARD_SQL, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  assert.doesNotMatch(CATALOG_AUDITOR_GUARD_SQL,
    /\bFROM\s+(?:public|neon_auth)\.(?:employees|payroll_entries|user)\b/i);
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

test("manual production paths gate the actual role before schema or receipt reads", () => {
  const verify = readFileSync("scripts/verify-production-catalog-auditor.mjs", "utf8");
  assert.match(verify, /workflow_dispatch/);
  assert.match(verify, /refs\/heads\/main/);
  assert.match(verify, /verify-full/);
  assert.match(verify, /REPEATABLE READ, READ ONLY/);
  assert.match(verify, /assertCatalogAuditorPrivilegeBoundary/);
  assert.doesNotMatch(verify, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/im);
  for (const path of [
    ".github/workflows/issue-1031-full-schema-diff.yml",
    ".github/workflows/production-schema-inventory.yml",
  ]) {
    const workflow = readFileSync(path, "utf8");
    const guard = workflow.indexOf("node scripts/verify-production-catalog-auditor.mjs --verify");
    const check = workflow.indexOf(path.includes("full-schema")
      ? "tsx scripts/check-issue-1031-full-schema-diff.ts"
      : "tsx scripts/check-production-schema-preflight.ts");
    assert.ok(guard >= 0 && guard < check, path + " must fail before schema catalog scan");
  }
  const receipts = readFileSync("scripts/audit-production-migration-receipts.mjs", "utf8");
  assert.match(receipts, /assertCatalogAuditorPrivilegeBoundary/);
  assert.ok(receipts.indexOf("assertCatalogAuditorPrivilegeBoundary") <
    receipts.indexOf("const receipts = await client.query("));
});
