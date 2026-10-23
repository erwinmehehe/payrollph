import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import {
  payrollMonthCloseSchemaSpec,
  doleReportingSchemaSpec,
  separationSchemaSpec,
  marketingLeadSchemaSpec,
  marketingLeadSchemaForRuntime,
  workforceAttendanceSchemaSpec,
  migrationSchemaSpec,
  outboxDeliverySchemaSpec,
  statutoryCorrectionSchemaSpec,
  statutoryMonthCloseSchemaSpec,
  verifyRequestSchemaReadOnly,
} from "../src/lib/request-schema-readonly";

// Integration evidence comes exclusively from the disposable GitHub Actions
// PostgreSQL 16 service after db:push. Never contact staging or production.
const url = process.env.DATABASE_URL;
let isolated = false;
try {
  if (url) {
    const parsed = new URL(url);
    isolated = process.env.CI === "true"
      && process.env.GITHUB_ACTIONS === "true"
      && ["127.0.0.1", "localhost"].includes(parsed.hostname)
      && parsed.port === "5432"
      && parsed.pathname === "/app_db"
      && parsed.username === "postgres"
      && !parsed.search && !parsed.hash;
  }
} catch {
  isolated = false;
}

test("actual PostgreSQL index ordering: flag on canonical-only, flag off accepts both real shapes",{skip:!isolated},async()=>{
 const client=new Client({connectionString:url,connectionTimeoutMillis:4000,query_timeout:8000});
 await client.connect();
 const canonical=marketingLeadSchemaForRuntime({REQUEST_SCHEMA_READONLY_ENABLED:"true"});
 const legacy=marketingLeadSchemaForRuntime({REQUEST_SCHEMA_READONLY_ENABLED:"false"});
 const verify=(spec:typeof canonical)=>verifyRequestSchemaReadOnly((sql,parameters)=>client.query(sql,parameters),spec);
 const indexes=(nulls:string)=>client.query(`DROP INDEX marketing_leads_status_created_idx;
  DROP INDEX marketing_leads_kind_created_idx;
  CREATE INDEX marketing_leads_status_created_idx ON marketing_leads(status,created_at DESC ${nulls});
  CREATE INDEX marketing_leads_kind_created_idx ON marketing_leads(kind,created_at DESC ${nulls})`);
 try{
  await verify(canonical);
  await verify(legacy);
  await indexes("NULLS LAST");
  await verify(legacy);
  await assert.rejects(()=>verify(canonical),/REQUEST_SCHEMA_READONLY_MARKETING_INCOMPATIBLE/);
  // An ascending index is neither shape and fails in both modes.
  await client.query(`DROP INDEX marketing_leads_status_created_idx;
   CREATE INDEX marketing_leads_status_created_idx ON marketing_leads(status,created_at)`);
  await assert.rejects(()=>verify(legacy),/REQUEST_SCHEMA_READONLY_MARKETING_INCOMPATIBLE/);
  await assert.rejects(()=>verify(canonical),/REQUEST_SCHEMA_READONLY_MARKETING_INCOMPATIBLE/);
 }finally{try{await indexes("NULLS FIRST");}finally{await client.end();}}
});

test("PostgreSQL 16 catalog accepts money-close, DOLE and separation schema after isolated Drizzle push", {
  skip: !isolated,
}, async () => {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 4000, query_timeout: 8000 });
  await client.connect();
  try {
    for (const spec of [payrollMonthCloseSchemaSpec, doleReportingSchemaSpec, separationSchemaSpec]) {
      await verifyRequestSchemaReadOnly(
        (sql, parameters) => client.query(sql, parameters),
        spec,
      );
    }
    const status = await client.query(
      "SELECT current_setting('transaction_read_only') = 'off' AS normal",
    );
    assert.equal(status.rows[0]?.normal, true,
      "Preflight transaction must not leak to following operations");
  } finally {
    await client.end();
  }
});


test("PostgreSQL 16 catalog audits all six additional request-schema writers after disposable db:push", {
  skip: !isolated,
}, async () => {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 4000, query_timeout: 8000 });
  await client.connect();
  try {
    const specs = [
      marketingLeadSchemaSpec,
      workforceAttendanceSchemaSpec,
      migrationSchemaSpec,
      outboxDeliverySchemaSpec,
      statutoryCorrectionSchemaSpec,
      statutoryMonthCloseSchemaSpec,
    ];
    const incompatible: string[] = [];
    for (const spec of specs) {
      try {
        await verifyRequestSchemaReadOnly(
          (sql, parameters) => client.query(sql, parameters),
          spec,
        );
      } catch (error) {
        if (spec.label === "marketing") {
          // Synthetic, disposable PostgreSQL only; metadata, never employer
          // records or SQL parameter values. Useful when Drizzle drifts.
          const indexes = await client.query(
            "SELECT idx.relname AS name, pg_catalog.pg_get_indexdef(i.indexrelid) AS ddl " +
            "FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid " +
            "JOIN pg_catalog.pg_class t ON t.oid=i.indrelid " +
            "WHERE t.relname='marketing_leads' ORDER BY idx.relname",
          );
          const constraints = await client.query(
            "SELECT conname AS name, pg_catalog.pg_get_constraintdef(oid) AS definition " +
            "FROM pg_catalog.pg_constraint WHERE conrelid='public.marketing_leads'::regclass " +
            "ORDER BY conname",
          );
          const indexKeys = await client.query(
            "SELECT idx.relname AS name, tbl.relname AS \"tableName\", " +
            "i.indisunique AS \"isUnique\", i.indisvalid AS \"isValid\", " +
            "i.indisready AS \"isReady\", " +
            "ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, n, true) " +
            "FROM pg_catalog.generate_series(1, i.indnkeyatts) AS n ORDER BY n) AS keys, " +
            "pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate " +
            "FROM pg_catalog.pg_index i " +
            "JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid " +
            "JOIN pg_catalog.pg_class tbl ON tbl.oid=i.indrelid " +
            "WHERE tbl.relname='marketing_leads' ORDER BY idx.relname",
          );
          const columns = await client.query(
            "SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, " +
            "a.attnotnull AS \"notNull\", pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS \"columnDefault\" " +
            "FROM pg_catalog.pg_attribute a " +
            "JOIN pg_catalog.pg_class t ON t.oid=a.attrelid " +
            "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum " +
            "WHERE t.relname='marketing_leads' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
          );
          console.error("Synthetic marketing catalog mismatch:", JSON.stringify({
            indexDDL: indexes.rows, indexKeys: indexKeys.rows, columns: columns.rows,
            constraints: constraints.rows,
            expectedIndexKeys: marketingLeadSchemaSpec.indexes,
          }));
        }
        incompatible.push(spec.label + ": " + (error instanceof Error ? error.message : String(error)));
      }
      const after = await client.query(
        "SELECT current_setting('transaction_read_only') = 'off' AS normal",
      );
      assert.equal(after.rows[0]?.normal, true,
        "A failed " + spec.label + " catalog preflight must still roll back");
    }
    assert.deepEqual(incompatible, [], "Drizzle-pushed source schema requires reviewed migration adoption");
  } finally {
    await client.end();
  }
});
