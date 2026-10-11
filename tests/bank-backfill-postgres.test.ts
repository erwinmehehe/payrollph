import assert from "node:assert/strict";
import test from "node:test";
import { replaceEmployeeBankAccount, replacePayrollSnapshotBankAccount } from "../scripts/lib/bank-backfill-writes";

// Only the repository's disposable, loopback CI service may run this fixture.
// Temp tables shadow the public names on this one connection; rollback removes
// them. No application rows, credentials or real bank accounts are fixture data.
const ciDatabase = process.env.CI === "true" && Boolean(process.env.DATABASE_URL);
test("PostgreSQL backfill preserves edits after scanning and rejects stale accounts", {
  skip: !ciDatabase, timeout: 20_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "CI database must be loopback");
  assert.equal(url.pathname, "/app_db", "use only the repository CI service database");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE employees (id integer PRIMARY KEY, bank_account text) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE payroll_entries (id integer PRIMARY KEY, trace jsonb) ON COMMIT DROP");
    const original = "  SYNTHETIC-OLD  ";
    const encrypted = "enc:v1:synthetic-envelope";
    await client.query("INSERT INTO employees VALUES (1, $1), (2, $1)", [original]);
    // Simulate a real edit committed after the operator read the old account.
    await client.query("UPDATE employees SET bank_account = 'SYNTHETIC-NEW' WHERE id = 1");
    await assert.rejects(replaceEmployeeBankAccount(client, { id: 1, original, encrypted }), /changed during backfill/);
    assert.equal((await client.query("SELECT bank_account FROM employees WHERE id = 1")).rows[0].bank_account, "SYNTHETIC-NEW");
    await replaceEmployeeBankAccount(client, { id: 2, original, encrypted });
    await assert.rejects(replaceEmployeeBankAccount(client, { id: 2, original, encrypted }), /changed during backfill/);

    const trace = { payment: { bankAccount: original, bankCode: "TEST", mobile: "SYNTHETIC" }, gross: "120.00", evidence: { version: 1 } };
    await client.query("INSERT INTO payroll_entries VALUES (1, $1::jsonb), (2, $1::jsonb)", [JSON.stringify(trace)]);
    await client.query("UPDATE payroll_entries SET trace = jsonb_set(trace, '{evidence,version}', '2') WHERE id = 1");
    await replacePayrollSnapshotBankAccount(client, { id: 1, original, encrypted });
    const preserved = (await client.query("SELECT trace FROM payroll_entries WHERE id = 1")).rows[0].trace;
    assert.deepEqual(preserved, { ...trace, payment: { ...trace.payment, bankAccount: encrypted }, evidence: { version: 2 } });
    await assert.rejects(replacePayrollSnapshotBankAccount(client, { id: 1, original, encrypted }), /changed during backfill/);

    await client.query("UPDATE payroll_entries SET trace = jsonb_set(trace, '{payment,bankAccount}', '\"SYNTHETIC-NEW\"') WHERE id = 2");
    await assert.rejects(replacePayrollSnapshotBankAccount(client, { id: 2, original, encrypted }), /changed during backfill/);
    assert.equal((await client.query("SELECT trace FROM payroll_entries WHERE id = 2")).rows[0].trace.payment.bankAccount, "SYNTHETIC-NEW");
    for (const invalid of [{}, { payment: {} }, { payment: { bankAccount: 123 } }, { payment: { bankAccount: null } }]) {
      await client.query("UPDATE payroll_entries SET trace = $1::jsonb WHERE id = 2", [JSON.stringify(invalid)]);
      await assert.rejects(replacePayrollSnapshotBankAccount(client, { id: 2, original: "123", encrypted }), /changed during backfill/);
      assert.deepEqual((await client.query("SELECT trace FROM payroll_entries WHERE id = 2")).rows[0].trace, invalid);
    }
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
