#!/usr/bin/env node
/**
 * Companion, read-only #1031 evidence on the exact two disposable PG16
 * databases independently compared by Atlas. Structural-only; never a receipt.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parse0128Renames, compare1031Stages, RECOVERY_TABLES } from "./lib/independent-reconciliation-evidence.mjs";
import { corroborateCascadeResiduals } from "./lib/independent-cascade-provenance.mjs";
import pg from "pg";

// Dedicated #1031 catalog-only login; Atlas uses a separate REFERENCES-only
// inspector. No application-row SELECT, CREATE, DML or elevated privileges.
const SOURCE_URL = "postgresql://atlas_auditor:synthetic_audit_only@127.0.0.1:5432/app_db";
const CANDIDATE_URL = "postgresql://atlas_auditor:synthetic_audit_only@127.0.0.1:5432/atlas_candidate_db";
const RECONCILED_URL = "postgresql://atlas_auditor:synthetic_audit_only@127.0.0.1:5432/atlas_reconciled_db";
const FIXTURE_WRITER_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE, "isolated-local-pg16");
assert.equal(process.env.DATABASE_URL, FIXTURE_WRITER_URL);
assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED, undefined);

const { generateSchemaManifest } = await import("./lib/issue-1031-schema-manifest.ts");
const { fullSchemaCatalogSql } = await import("./check-issue-1031-full-schema-diff.ts");
const { diffSchema, EVIDENCE } = await import("../src/lib/issue-1031-full-schema-diff.ts");
const manifest = generateSchemaManifest();
assert.equal(RECOVERY_TABLES.filter(name => manifest.tables.some(t => t.name===name)).length,
  10, "Ten recovery models must be in the #1031 source manifest");

async function inspect(url, expectedName) {
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await db.connect();
  let started = false;
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    started = true;
    await db.query("SET LOCAL search_path=pg_catalog");
    await db.query("SET LOCAL statement_timeout='30s'");
    const identity = (await db.query(
      "SELECT current_database() AS name, current_user AS role, " +
      "current_setting('server_version_num')::integer AS version, " +
      "current_setting('transaction_read_only') AS readonly, " +
      "(SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole " +
      "OR r.rolreplication OR r.rolbypassrls FROM pg_catalog.pg_roles r " +
      "WHERE r.rolname=current_user) AS elevated, " +
      "EXISTS(SELECT 1 FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
      "WHERE n.nspname='public' AND c.relkind IN ('r','p') " +
      "AND pg_catalog.has_table_privilege(current_user,c.oid, " +
      "'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS can_write, " +
      "EXISTS(SELECT 1 FROM pg_catalog.pg_class c " +
      "WHERE c.oid=ANY(ARRAY[to_regclass('public.employees')," +
      "to_regclass('public.payroll_entries'),to_regclass('public.payroll_runs')]) " +
      "AND pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT')) AS can_read_money"
    )).rows[0];
    assert.equal(identity.name, expectedName);
    // Docker service may use a bridge IP on the PostgreSQL server side.
    // Both literal connection URLs are forced to loopback on the CI host.
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.equal(identity.role, "atlas_auditor");
    assert.equal(identity.readonly, "on");
    assert.equal(identity.elevated, false);
    assert.equal(identity.can_write, false);
    assert.equal(identity.can_read_money, false);
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    const observed = (await db.query(fullSchemaCatalogSql)).rows.map(
      ({ table_name, kind, object_name, details }) => ({
        table_name, kind, object_name, ...details,
      })
    );
    const diff = diffSchema(manifest, observed);
    const counts = Object.fromEntries(["PASS", "MISSING", "DRIFT", "EXTRA"].map(
      status => [status, diff.filter(row => row.status === status).length]
    ));
    const recoveryCounts = Object.fromEntries(RECOVERY_TABLES.map(name => [
      name, Object.fromEntries(["PASS","MISSING","DRIFT","EXTRA"].map(status =>
        [status, diff.filter(row => row.table===name && row.status===status).length])),
    ]));
    return { database: expectedName, counts, checkedModels: manifest.tables.length,
      recoveryCounts, nonPassing: diff.filter(row => row.status !== "PASS"), readOnly: true,
      receiptsVerified: false, realProductionBaseline: false };
  } finally {
    if (started) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
}

const results = {
  evidenceScope: EVIDENCE,
  prHeadSha: process.env.PR_HEAD_SHA || null,
  githubWorkflowCommit: process.env.GITHUB_SHA || null,
  auditRole: "atlas_auditor",
  assertion: "SYNTHETIC_ONLY_NOT_PRODUCTION_PARITY",
  source: await inspect(SOURCE_URL, "app_db"),
  candidate: await inspect(CANDIDATE_URL, "atlas_candidate_db"),
  reconciled: await inspect(RECONCILED_URL, "atlas_reconciled_db"),
};
// Do not convert universal source comparator disagreements into PASS.
 // Preserve exact catalog rows AND separate common baseline disagreement from
 // synthetic candidate-only disagreement (which can include DROP CASCADE fallout).
const signature = row => JSON.stringify([
  row.table, row.object, row.kind, row.status, row.expected, row.actual,
]);
const original = new Set(results.source.nonPassing.map(signature));
const candidate = new Set(results.candidate.nonPassing.map(signature));
results.baselineComparison = {
  commonNonPassing: results.source.nonPassing.filter(x => candidate.has(signature(x))).length,
  sourceOnly: results.source.nonPassing.filter(x => !candidate.has(signature(x))),
  candidateOnly: results.candidate.nonPassing.filter(x => !original.has(signature(x))),
  explanation: "SYNTHETIC_DIFFERENCES_REQUIRE_REVIEW_NOT_APPROVAL",
};
const sql0128 = readFileSync(new URL("../drizzle/0128_recovery_foreign_key_names_forward.sql", import.meta.url), "utf8");
results.reconciliation = compare1031Stages({
  source: results.source,
  pre0128: results.candidate,
  post0128: results.reconciled,
  mappings: parse0128Renames(sql0128),
});
// This proves whether a candidate-only missing FK was removed in the local
// DROP CASCADE fixture; it does NOT resolve or exclude the discrepancy.
const cascadeTrace = JSON.parse(readFileSync(
  "qa-artifacts/independent-pg16/synthetic-cascade-provenance.json", "utf8"));
assert.equal(cascadeTrace.prHeadSha, process.env.PR_HEAD_SHA || null,
  "Cannot combine provenance from a different PR source head");
results.reconciliation.syntheticCascadeProvenance = corroborateCascadeResiduals(
  results.reconciliation.postCandidateOnlyObjects, cascadeTrace);
if (results.reconciliation.syntheticCascadeProvenance.unsupported.length > 0) {
  console.error("Unproven synthetic CASCADE cause; inspect original FK evidence");
  process.exitCode = 1;
}
writeFileSync("qa-artifacts/independent-pg16/issue-1031-side-by-side.json",
  JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({
  sourceCounts: results.source.counts,
  candidateCounts: results.candidate.counts,
  reconciledCounts: results.reconciled.counts,
  mappedFkPairs: results.reconciliation.verifiedSemanticFkRenames,
  beforeRecoveryNonPassing: results.reconciliation.beforeRecoveryNonPassing,
  afterRecoveryNonPassing: results.reconciliation.afterRecoveryNonPassing,
  postCandidateOnly: results.reconciliation.postCandidateOnly,
  post0128NameOnlyFkPairs: results.reconciliation.nameOnlyFkPairCountOutside0128,
  post0128ResidualByCategory: results.reconciliation.postCandidateOnlyByCategory,
  syntheticCascadeProvenance: results.reconciliation.syntheticCascadeProvenance,
  reconciliationGate: results.reconciliation.catalogReconciliationGate,
  commonNonPassing: results.baselineComparison.commonNonPassing,
  candidateOnly: results.baselineComparison.candidateOnly.length,
  sourceOnly: results.baselineComparison.sourceOnly.length,
  bothReadOnly: true,
  notReleaseApproval: true,
}));

if (results.reconciliation.catalogReconciliationGate !== "RECOVERY_0128_NAMES_PAIRED_ONLY") {
  console.error("0128 catalog-only pairing BLOCKED; inspect complete raw #1031 evidence");
  process.exitCode = 1;
}
