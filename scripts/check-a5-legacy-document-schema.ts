import assert from "node:assert/strict";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { documents } from "../src/db/schema";
import {
  compatibleDocumentColumns, legacyDocumentInsertTable, legacyVisibleDocumentWhere,
} from "../src/lib/document-schema-compat";

// Must never connect this acceptance test to a real employer DB.
assert.equal(process.env.CI, "true");
assert.equal(process.env.A5_DISPOSABLE_SCHEMA_ONLY, "true");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) &&
  url.pathname === "/app_db" && (url.port === "5432" || url.port === ""),
  "Only a disposable local PostgreSQL app_db is allowed");

const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query("BEGIN");
  // Shadow public.documents ONLY on this connection; rollback removes it.
  // This is the original document schema, without either A-5 column.
  await client.query(`CREATE TEMP TABLE documents (
    id serial PRIMARY KEY,
    organization_id integer NOT NULL, employee_id integer,
    kind varchar(40) NOT NULL, file_name varchar(200) NOT NULL,
    mime_type varchar(100) NOT NULL, byte_size integer NOT NULL,
    sha256 varchar(64) NOT NULL, scanned_clean boolean NOT NULL DEFAULT false,
    scan_note varchar(200) NOT NULL DEFAULT '',
    source_type varchar(24) NOT NULL DEFAULT 'upload', source_key varchar(160),
    generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    uploaded_by varchar(120) NOT NULL, content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  ) ON COMMIT DROP`);

  const synthetic = drizzle(client);
  const [created] = await synthetic.insert(legacyDocumentInsertTable).values({
    organizationId: 123, employeeId: 456, kind: "contract",
    fileName: "synthetic-only.pdf", mimeType: "application/pdf",
    byteSize: 4, sha256: "a".repeat(64), scannedClean: true,
    uploadedBy: "Fictional HR", content: "JVBERg==",
  }).returning({ id: legacyDocumentInsertTable.id });
  assert.ok(created.id > 0);

  const [legacy] = await synthetic.select(compatibleDocumentColumns).from(documents)
    .where(eq(documents.id, created.id)).limit(1);
  assert.equal(legacy.fileName, "synthetic-only.pdf");
  assert.equal(legacy.objectStorageKey, null);
  assert.equal(legacy.uploadedByUserId, null);
  assert.equal((await synthetic.select({ id: documents.id }).from(documents)
    .where(legacyVisibleDocumentWhere)).length, 1);

  await client.query("ALTER TABLE documents ADD COLUMN uploaded_by_user_id integer");
  await client.query("ALTER TABLE documents ADD COLUMN object_storage_key varchar(512)");
  await client.query("UPDATE documents SET uploaded_by_user_id = 33, object_storage_key = 'private/synthetic/id'");

  const [migrated] = await synthetic.select(compatibleDocumentColumns).from(documents)
    .where(eq(documents.id, created.id)).limit(1);
  assert.equal(migrated.uploadedByUserId, 33);
  assert.equal(migrated.objectStorageKey, "private/synthetic/id");
  assert.equal((await synthetic.select({ id: documents.id }).from(documents)
    .where(legacyVisibleDocumentWhere)).length, 0,
    "Legacy non-HR lists must hide object-backed metadata after feature rollback");
  console.log("PASS A-5 legacy-schema read/insert, additive fields and rollback privacy");
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
