import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pool } from "../src/db";
import { decryptBankAccount, encryptBankAccount } from "../src/lib/bank-account-crypto";

test("0110 rehearses on empty and encrypted synthetic schemas without changing bank evidence", async () => {
  const client = await pool.connect();
  const key: NodeJS.ProcessEnv = { NODE_ENV: "test", BANK_DATA_ENCRYPTION_KEY: "11".repeat(32) };
  const account = encryptBankAccount("PILOT-MIGRATION-ONLY", key);
  const migration = readFileSync("drizzle/0110_provider_events_inbox.sql", "utf8");
  try {
    for (const populated of [false, true]) {
      const schema = `inbox_rehearsal_${randomUUID().replaceAll("-", "")}`;
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query("CREATE TABLE organizations (id integer PRIMARY KEY); CREATE TABLE payroll_runs (id integer PRIMARY KEY); CREATE TABLE employees (id integer PRIMARY KEY, bank_account text)");
      if (populated) {
        await client.query("INSERT INTO organizations VALUES (1); INSERT INTO payroll_runs VALUES (1)");
        await client.query("INSERT INTO employees VALUES (1, $1)", [account]);
      }
      await client.query(migration);
      await client.query(migration); // Operator replay must retain the constraints.
      if (!populated) {
        await client.query("INSERT INTO organizations VALUES (1); INSERT INTO payroll_runs VALUES (1)");
      }
      await client.query("INSERT INTO provider_events (provider,event_id,organization_id,payroll_run_id,event_type) VALUES ('paymongo','synthetic-event',1,1,'transfer.updated')");
      for (const [eventId, orgId, runId, code] of [
        ["synthetic-event", 1, 1, "23505"],
        ["missing-org", 2, 1, "23503"],
        ["missing-run", 1, 2, "23503"],
      ] as const) {
        await client.query("SAVEPOINT rejected_delivery");
        await assert.rejects(client.query("INSERT INTO provider_events (provider,event_id,organization_id,payroll_run_id,event_type) VALUES ('paymongo',$1,$2,$3,'transfer.updated')", [eventId, orgId, runId]), { code });
        await client.query("ROLLBACK TO SAVEPOINT rejected_delivery");
      }
      assert.equal((await client.query("SELECT count(*)::int AS count FROM provider_events")).rows[0].count, 1);
      if (populated) {
        const stored = (await client.query("SELECT bank_account FROM employees")).rows[0].bank_account;
        assert.equal(stored, account);
        assert.equal(decryptBankAccount(stored, key), "PILOT-MIGRATION-ONLY");
      }
      await client.query("ROLLBACK"); // Remove every synthetic object, including the schema.
      assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1", [schema])).rows[0].count, 0);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
