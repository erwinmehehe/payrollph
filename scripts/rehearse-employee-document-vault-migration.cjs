/**
 * A-5 migration rehearsal on disposable local PostgreSQL only.
 * Never supply production or Neon credentials.
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Client } = require("pg");

(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true", "Disposable CI only");
  assert.equal(process.env.A5_DISPOSABLE_SCHEMA_ONLY, "true");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Refusing nonlocal databases");
  assert.equal(url.pathname, "/app_db", "Only disposable app_db may be used");

  const ddl = fs.readFileSync(
    "docs/engineering/migration-proposals/employee-document-vault-a5.sql", "utf8",
  );
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let transactional = false;
  try {
    await client.query("BEGIN");
    transactional = true;
    // db:push created the complete fresh schema. This transactional test
    // removes ONLY proposed A-5 columns/tables, then applies its real SQL.
    await client.query('DROP TABLE IF EXISTS "hcm_document_expiry_notices"');
    await client.query('ALTER TABLE "documents" DROP COLUMN IF EXISTS "object_storage_key"');
    await client.query('ALTER TABLE "documents" DROP COLUMN IF EXISTS "uploaded_by_user_id"');
    await client.query(ddl);
    await client.query(ddl); // source proposal must be idempotent
    const cols = await client.query(
      "SELECT column_name, is_nullable FROM information_schema.columns " +
      "WHERE table_schema='public' AND table_name='documents' " +
      "AND column_name IN ('object_storage_key','uploaded_by_user_id','content') ORDER BY column_name"
    );
    assert.deepEqual(cols.rows.map(row => row.column_name).sort(),
      ["content", "object_storage_key", "uploaded_by_user_id"]);
    assert.equal(cols.rows.find(row => row.column_name === "object_storage_key").is_nullable,
      "YES", "historical records must retain null object keys before backfill");
    assert.equal(cols.rows.find(row => row.column_name === "uploaded_by_user_id").is_nullable,
      "YES", "historical uploader identity cannot be inferred from display name");
    const idx = await client.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' " +
      "AND tablename='hcm_document_expiry_notices'"
    );
    const unique = idx.rows.find(row => row.indexname === "hcm_document_expiry_notice_unique");
    assert.ok(unique?.indexdef?.includes("compliance_id, document_id, expires_on, milestone_days"),
      "new document with same expiry must create a fresh notice");
    const constraints = await client.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint " +
      "WHERE conrelid='hcm_document_expiry_notices'::regclass AND contype='c'"
    );
    assert.ok(constraints.rows.some(row => /milestone_days/.test(row.definition)),
      "alert day milestone constraint is required");
    const table = await client.query(
      "SELECT to_regclass('public.hcm_document_expiry_notices')::text AS notices"
    );
    assert.equal(table.rows[0].notices, "hcm_document_expiry_notices");
    console.log("A-5 proposed SQL accepted and replayed in disposable PostgreSQL.");
  } finally {
    if (transactional) await client.query("ROLLBACK");
    await client.end();
  }
})().catch(error => {
  console.error("A-5 disposable SQL rehearsal failed:", error.message);
  process.exitCode = 1;
});
