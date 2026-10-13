import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { legacyDocumentInsertTable } from "../src/lib/document-schema-compat";

test("legacy document writer and returning execute without proposed A5 columns", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(url.hostname, "127.0.0.1", "Disposable loopback PostgreSQL only");
  assert.equal(url.pathname, "/app_db");
  const pool = new Pool({ connectionString: url.toString() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE documents (
      id serial PRIMARY KEY, organization_id integer NOT NULL, employee_id integer,
      kind varchar(40) NOT NULL, file_name varchar(200) NOT NULL, mime_type varchar(100) NOT NULL,
      byte_size integer NOT NULL, sha256 varchar(64) NOT NULL, scanned_clean boolean DEFAULT false,
      scan_note varchar(200) DEFAULT '', source_type varchar(24) DEFAULT 'upload',
      source_key varchar(160), generation_metadata jsonb DEFAULT '{}', uploaded_by varchar(120) NOT NULL,
      content text NOT NULL, created_at timestamptz DEFAULT now()
    ) ON COMMIT DROP`);
    const db = drizzle(client);
    const [row] = await db.insert(legacyDocumentInsertTable).values({
      organizationId: 1, employeeId: 2, kind: "employment_decision_evidence",
      fileName: "fictional.txt", mimeType: "text/plain", byteSize: 4,
      sha256: "a".repeat(64), scannedClean: true, uploadedBy: "Synthetic checker", content: "dGVzdA==",
    }).returning();
    assert.equal(row.content, "dGVzdA==");
    const [read] = await db.select().from(legacyDocumentInsertTable).where(eq(legacyDocumentInsertTable.id, row.id));
    assert.equal(read.organizationId, 1);
    assert.equal(read.kind, "employment_decision_evidence");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
