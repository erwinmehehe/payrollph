#!/usr/bin/env node
/**
 * Companion, read-only #1031 evidence on the exact two disposable PG16
 * databases independently compared by Atlas. Structural-only; never a receipt.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import pg from "pg";

const SOURCE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const CANDIDATE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/atlas_candidate_db";
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE, "isolated-local-pg16");
assert.equal(process.env.DATABASE_URL, SOURCE_URL);
assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED, undefined);

const { generateSchemaManifest } = await import("./lib/issue-1031-schema-manifest.ts");
const { fullSchemaCatalogSql } = await import("./check-issue-1031-full-schema-diff.ts");
const { diffSchema, EVIDENCE } = await import("../src/lib/issue-1031-full-schema-diff.ts");
const manifest = generateSchemaManifest();

async function inspect(url, expectedName) {
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await db.connect();
  let started = false;
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    started = true;
    await db.query("SET LOCAL search_path=pg_catalog");
    await db.query("SET LOCAL statement_timeout='10s'");
    const identity = (await db.query(
      "SELECT current_database() AS name, inet_server_addr()::text AS host, " +
      "current_setting('server_version_num')::integer AS version"
    )).rows[0];
    assert.equal(identity.name, expectedName);
    assert.equal(identity.host, "127.0.0.1");
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
    return { database: expectedName, counts, checkedModels: manifest.tables.length,
      nonPassing: diff.filter(row => row.status !== "PASS"), readOnly: true,
      receiptsVerified: false, realProductionBaseline: false };
  } finally {
    if (started) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
}

const results = {
  evidenceScope: EVIDENCE,
  assertion: "SYNTHETIC_ONLY_NOT_PRODUCTION_PARITY",
  source: await inspect(SOURCE_URL, "app_db"),
  candidate: await inspect(CANDIDATE_URL, "atlas_candidate_db"),
};
writeFileSync("qa-artifacts/independent-pg16/issue-1031-side-by-side.json",
  JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({
  sourceCounts: results.source.counts,
  candidateCounts: results.candidate.counts,
  bothReadOnly: true,
  notReleaseApproval: true,
}));
