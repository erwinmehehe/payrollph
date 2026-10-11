import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import {
  payrollMonthCloseSchemaSpec,
  doleReportingSchemaSpec,
  separationSchemaSpec,
  marketingLeadSchemaSpec,
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
          console.error("Synthetic marketing catalog mismatch:", JSON.stringify({
            indexes: indexes.rows, constraints: constraints.rows,
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
