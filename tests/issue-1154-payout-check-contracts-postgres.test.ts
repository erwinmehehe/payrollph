import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { payoutBatches, payoutTransfers } from "../src/db/schema";

// #1154 group C: five positivity-check records only. Never production parity,
// a source-model change, an applied receipt, or payout submission acceptance.
const sourcePath = "drizzle/0116_payout_ledger_foundation.sql";
const dialect = new PgDialect();
const cents = [null, "-9223372036854775808", "-1", "0", "1",
  "9007199254740993", "9223372036854775807"];
const counts = [null, "-1", "0", "1", "2147483647"];

test("source and exact 0116 payout positivity contracts agree on signed-cent boundaries", async t => {
  const url = process.env.ISSUE1154_DISPOSABLE_PG_URL;
  if (!url) {
    if (process.env.ISSUE1154_PG_REQUIRED === "true") throw Error("ISSUE1154_DATABASE_REQUIRED");
    t.skip("requires an explicitly provisioned empty disposable PostgreSQL database");
    return;
  }
  const target = new URL(url);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/issue1154_contracts");
  assert.equal(target.username, "fixture");
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await db.connect();
  let tx = false;
  try {
    await db.query("BEGIN"); tx = true;
    await db.query("SET LOCAL statement_timeout='15s'");
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query("SET LOCAL search_path=public,pg_catalog");
    const identity = (await db.query("SELECT current_database() AS db, current_user AS role, " +
      "current_setting('server_version_num')::integer / 10000 AS major, pg_is_in_recovery() AS recovery")).rows[0];
    assert.equal(identity.db, "issue1154_contracts");
    assert.equal(identity.role, "fixture");
    assert.ok([16, 18].includes(identity.major));
    assert.equal(identity.recovery, false);
    const relations = async () => (await db.query("SELECT n.nspname,c.relname,c.relkind FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' " +
      "AND n.nspname <> 'information_schema' ORDER BY 1,2,3")).rows;
    const before = await relations();
    assert.deepEqual(before, [], "refuse any nonempty database, even with a fixture-like name");
    await db.query(`CREATE TABLE public.organizations(id integer PRIMARY KEY);
      CREATE TABLE public.payroll_runs(id integer PRIMARY KEY, organization_id integer NOT NULL);
      CREATE TABLE public.employees(id integer PRIMARY KEY, organization_id integer NOT NULL);
      CREATE TABLE public.payroll_entries(id integer PRIMARY KEY, payroll_run_id integer NOT NULL, employee_id integer NOT NULL);
      INSERT INTO public.organizations VALUES (1),(2);
      INSERT INTO public.payroll_runs VALUES (1,1);
      INSERT INTO public.employees VALUES (1,1);
      INSERT INTO public.payroll_entries VALUES (1,1,1)`);
    const forward = readFileSync(new URL("../" + sourcePath, import.meta.url));
    await db.query(forward.toString("utf8")); // whole source, without rewriting SQL
    await db.query("CREATE SCHEMA source_model");
    const buildSource = async (table: typeof payoutBatches | typeof payoutTransfers,
      wantedColumns: string[], wantedCheck: string) => {
      const config = getTableConfig(table);
      const columns = config.columns.filter(c => wantedColumns.includes(c.name));
      assert.equal(columns.length, wantedColumns.length);
      assert.ok(columns.every(c => c.notNull && ["integer", "bigint"].includes(c.getSQLType())));
      const checks = config.checks.filter(c => c.name === wantedCheck);
      assert.equal(checks.length, 1);
      const expression = dialect.sqlToQuery(checks[0].value.inlineParams());
      assert.deepEqual(expression.params, []);
      await db.query(`CREATE TABLE source_model."${config.name}" (` +
        columns.map(c => `"${c.name}" ${c.getSQLType()} NOT NULL`).join(",") +
        `,CONSTRAINT "${wantedCheck}" CHECK (${expression.sql}))`);
    };
    await buildSource(payoutBatches, ["transfer_count", "total_amount_cents"], "payout_batches_positive_total_check");
    await buildSource(payoutTransfers, ["amount_cents"], "payout_transfers_positive_amount_check");
    const catalog = (await db.query(`SELECT n.nspname AS schema_name, c.relname AS table_name,
      con.conname AS name, pg_catalog.pg_get_constraintdef(con.oid) AS definition, con.convalidated
      FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE con.contype='c'
      AND con.conname=ANY($1::text[]) ORDER BY 1,2,3`, [[
      "payout_batches_positive_total_check", "payout_batches_total_amount_cents_check",
      "payout_batches_transfer_count_check", "payout_transfers_positive_amount_check",
      "payout_transfers_amount_cents_check",
    ]])).rows;
    assert.equal(catalog.length, 5, "retain all five distinct raw catalog records");
    assert.ok(catalog.every(c => c.convalidated));
    const witnesses: unknown[] = [];
    async function probe(schema: "public" | "source_model", kind: "batch" | "transfer",
      count: string | null, amount: string | null) {
      await db.query("SAVEPOINT boundary_case");
      let outcome: { code: string; amount?: string; count?: number };
      try {
        const result = kind === "batch"
          ? await db.query(schema === "public"
            ? `INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents)
               VALUES (1,1,'synthetic','synthetic',$1,$2) RETURNING total_amount_cents::text AS amount,transfer_count AS count`
            : "INSERT INTO source_model.payout_batches(transfer_count,total_amount_cents) VALUES ($1,$2) RETURNING total_amount_cents::text AS amount,transfer_count AS count", [count, amount])
          : await db.query(schema === "public"
            ? `INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents)
               VALUES (1,1,1,1,'synthetic',$1) RETURNING amount_cents::text AS amount`
            : "INSERT INTO source_model.payout_transfers(amount_cents) VALUES ($1) RETURNING amount_cents::text AS amount", [amount]);
        outcome = { code: "accepted", ...result.rows[0] };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "23514" && code !== "23502") throw error;
        outcome = { code };
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT boundary_case");
        await db.query("RELEASE SAVEPOINT boundary_case");
      }
      return outcome;
    }
    for (const kind of ["batch", "transfer"] as const) {
      for (const count of kind === "batch" ? counts : ["1"]) for (const amount of cents) {
        const observed = await probe("public", kind, count, amount);
        const model = await probe("source_model", kind, count, amount);
        assert.deepEqual(observed, model, `${kind}: ${count},${amount}`);
        const expected = amount === null || (kind === "batch" && count === null) ? "23502"
          : BigInt(amount) > BigInt(0) && BigInt(count!) > BigInt(0) ? "accepted" : "23514";
        assert.equal(observed.code, expected);
        if (expected === "accepted") assert.equal(observed.amount, amount, "never round bigint cents through Number");
        witnesses.push({ kind, count, amount, code: observed.code });
      }
    }
    // Exact forward SQL still denies a different employer; do not disable its triggers.
    await db.query("SAVEPOINT tenant_denial");
    await assert.rejects(() => db.query(`INSERT INTO public.payout_batches
      (organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents)
      VALUES (2,1,'cross-tenant','synthetic',1,1)`),
    (error: unknown) => (error as { code: string; message: string }).code === "23514" &&
      (error as Error).message.includes("PAYOUT_BATCH_TENANT_MISMATCH"));
    await db.query("ROLLBACK TO SAVEPOINT tenant_denial");
    await db.query("RELEASE SAVEPOINT tenant_denial");
    for (const table of ["public.payout_batches", "public.payout_transfers",
      "source_model.payout_batches", "source_model.payout_transfers"]) {
      assert.equal((await db.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n, 0);
    }
    await db.query("ROLLBACK"); tx = false;
    assert.deepEqual(await relations(), before, "complete rehearsal must roll back all created objects");
    assert.equal(witnesses.length, 42);
    const evidence = { scope: "SYNTHETIC_BOUNDARY_EQUIVALENCE_ONLY_NOT_PRODUCTION_DISPOSITION",
      postgresMajor: identity.major, sourcePath, sourceSha256: createHash("sha256").update(forward).digest("hex"),
      sourceModelSha256: createHash("sha256").update(readFileSync(new URL("../src/db/schema.ts", import.meta.url))).digest("hex"),
      catalog, witnesses, pairedBoundaryCases: witnesses.length, executedInserts: witnesses.length * 2,
      tenantDenial: true, rollbackVerified: true, rawCatalogDifferencesRemain: true,
      productionContact: false, historicalReceipt: false, approvedForDeployment: false };
    mkdirSync("qa-artifacts/issue1154", { recursive: true });
    writeFileSync(`qa-artifacts/issue1154/payout-check-contracts-pg${identity.major}.json`, JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ pairedBoundaryCases: 42, executedInserts: 84, tenantDenial: true,
      rollbackVerified: true, postgresMajor: identity.major, productionContact: false }));
  } finally {
    if (tx) await db.query("ROLLBACK");
    await db.end();
  }
});
