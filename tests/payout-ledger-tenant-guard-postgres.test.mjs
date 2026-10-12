import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

const syntheticCI = process.env.CI === "true" &&
  process.env.PAYOUT_LEDGER_REHEARSAL_MODE === "isolated-ci-only";

function syntheticTarget() {
  const value = process.env.DATABASE_URL;
  if (!value) throw Error("PAYOUT_LEDGER_SYNTHETIC_DATABASE_URL_REQUIRED");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
      url.port !== "5432" || url.pathname !== "/app_db" ||
      url.username !== "postgres" || url.search || url.hash) {
    throw Error("PAYOUT_LEDGER_SYNTHETIC_LOCALHOST_ONLY");
  }
  return value;
}

/**
 * Executes exactly the two checked-in source SQL files, not a manually
 * reconstructed or simplified schema. No network calls, bank data or payouts.
 */
test("A-1/A-2 real Postgres rehearsal: unique/replay/tenant/immutable and rollback", {
  skip: !syntheticCI,
  timeout: 90_000,
}, async () => {
  const client = new pg.Client({ connectionString: syntheticTarget(), connectionTimeoutMillis: 4000 });
  await client.connect();
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query("CREATE TABLE public.organizations(id integer PRIMARY KEY)");
    await client.query("CREATE TABLE public.payroll_runs(id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.organizations(id))");
    await client.query("CREATE TABLE public.employees(id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.organizations(id))");
    await client.query("CREATE TABLE public.payroll_entries(id integer PRIMARY KEY, payroll_run_id integer NOT NULL REFERENCES public.payroll_runs(id), employee_id integer NOT NULL REFERENCES public.employees(id))");
    await client.query("INSERT INTO public.organizations(id) VALUES (101),(102)");
    await client.query("INSERT INTO public.payroll_runs(id,organization_id) VALUES (201,101),(202,102),(203,101)");
    await client.query("INSERT INTO public.employees(id,organization_id) VALUES (301,101),(302,102)");
    await client.query("INSERT INTO public.payroll_entries(id,payroll_run_id,employee_id) VALUES (401,201,301),(402,202,302)");
    await client.query(readFileSync("drizzle/0110_provider_events_inbox.sql", "utf8"));
    await client.query(readFileSync("drizzle/0116_payout_ledger_foundation.sql", "utf8"));
    await client.query("COMMIT");
    transaction = false;

    // A-1: two independent PostgreSQL connections race the SAME provider ID.
    // Unique(provider,event_id) must persist exactly one inbox record.
    const left = new pg.Client({connectionString: syntheticTarget()});
    const right = new pg.Client({connectionString: syntheticTarget()});
    try {
      await Promise.all([left.connect(), right.connect()]);
      const cmd = "INSERT INTO public.provider_events(provider,event_id,organization_id,payroll_run_id,event_type) " +
        "VALUES ('synthetic-race','E-concurrent',101,201,'fixture') " +
        "ON CONFLICT (provider,event_id) DO NOTHING RETURNING id";
      const results = await Promise.all([left.query(cmd), right.query(cmd)]);
      assert.equal(results.reduce((sum, result) => sum + result.rows.length, 0), 1,
        "at most one concurrent request can persist the same provider event");
      const proof = await client.query("SELECT count(*)::int AS count FROM public.provider_events " +
        "WHERE provider='synthetic-race' AND event_id='E-concurrent'");
      assert.equal(proof.rows[0].count, 1);
    } finally {
      await Promise.allSettled([left.end(), right.end()]);
    }
    // Only the isolated CI fixture is ever touched.
    await client.query("DELETE FROM public.provider_events WHERE provider='synthetic-race' AND event_id='E-concurrent'");

    const checks = await client.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_trigger t " +
      "JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid " +
      "WHERE NOT t.tgisinternal AND c.relname IN ('payout_batches','payout_transfers','payout_batch_transfers') " +
      "AND t.tgname LIKE '%tenant_guard'");
    assert.equal(checks.rows[0].count, 3, "all three tenancy guard triggers must be installed");

    await client.query("BEGIN");
    transaction = true;
    async function rejected(sql, expectedCode) {
      await client.query("SAVEPOINT before_negative");
      let caught = false;
      try { await client.query(sql); } catch (error) {
        assert.equal(error.code, expectedCode, error.message);
        caught = true;
      }
      await client.query("ROLLBACK TO SAVEPOINT before_negative");
      await client.query("RELEASE SAVEPOINT before_negative");
      assert.ok(caught, "unsafe write must be rejected");
    }

    await client.query("INSERT INTO public.provider_events(provider,event_id,organization_id,payroll_run_id,event_type) VALUES ('synthetic','E-1',101,201,'fixture')");
    await rejected(
      "INSERT INTO public.provider_events(provider,event_id,organization_id,payroll_run_id,event_type) VALUES ('synthetic','E-1',101,201,'fixture')",
      "23505"
    );

    await client.query("INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES (101,201,'B-1',repeat('a',64),1,123)");
    await rejected(
      "INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES (101,201,'B-1',repeat('a',64),1,123)",
      "23505"
    );
    await rejected(
      "INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES (102,201,'B-wrong',repeat('a',64),1,123)",
      "23514"
    );
    await client.query("INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) VALUES (101,201,401,301,'T-1',123)");
    await rejected(
      "INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) VALUES (102,201,401,301,'T-wrong',123)",
      "23514"
    );
    await rejected(
      "INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) VALUES (101,201,401,301,'T-duplicate',123)",
      "23505"
    );
    await rejected(
      "INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) VALUES (101,201,402,302,'T-cross-entry',123)",
      "23514"
    );
    await rejected("UPDATE public.payout_transfers SET amount_cents=124 WHERE reference_number='T-1'", "23514");
    await rejected("UPDATE public.payout_batches SET total_amount_cents=124 WHERE idempotency_key='B-1'", "23514");

    await client.query("INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES (101,203,'B-other-run',repeat('a',64),1,123)");
    await rejected(
      "INSERT INTO public.payout_batch_transfers(organization_id,payout_batch_id,payout_transfer_id) SELECT 101,b.id,t.id FROM public.payout_batches b CROSS JOIN public.payout_transfers t WHERE b.idempotency_key='B-other-run' AND t.reference_number='T-1'",
      "23514"
    );
    await client.query("INSERT INTO public.payout_batch_transfers(organization_id,payout_batch_id,payout_transfer_id) " +
      "SELECT 101,b.id,t.id FROM public.payout_batches b CROSS JOIN public.payout_transfers t WHERE b.idempotency_key='B-1' AND t.reference_number='T-1'");
    await rejected(
      "INSERT INTO public.payout_batch_transfers(organization_id,payout_batch_id,payout_transfer_id) SELECT 102,b.id,t.id FROM public.payout_batches b CROSS JOIN public.payout_transfers t WHERE b.idempotency_key='B-1' AND t.reference_number='T-1'",
      "23514"
    );

    await client.query("ROLLBACK");
    transaction = false;
    const rows = await client.query(
      "SELECT (SELECT count(*)::int FROM public.provider_events) AS event_count, " +
      "(SELECT count(*)::int FROM public.payout_batches) AS batch_count, " +
      "(SELECT count(*)::int FROM public.payout_transfers) AS transfer_count, " +
      "(SELECT count(*)::int FROM public.payout_batch_transfers) AS link_count");
    assert.deepEqual(rows.rows[0], {event_count:0,batch_count:0,transfer_count:0,link_count:0});
  } finally {
    if (transaction) { try {await client.query("ROLLBACK");} catch {} }
    await client.end();
  }
});

test("A-2 canonical source-only 0116 never activates payout providers", () => {
  const sql = readFileSync("drizzle/0116_payout_ledger_foundation.sql", "utf8");
  assert.match(sql, /DO NOT APPLY ON NEON MAIN/i);
  assert.match(sql, /validate_payout_batch_scope/);
  assert.match(sql, /validate_payout_transfer_scope/);
  assert.match(sql, /validate_payout_batch_transfer_scope/);
  assert.match(sql, /PAYOUT_TRANSFER_TENANT_OR_ENTRY_MISMATCH/);
  assert.doesNotMatch(sql, /\b(?:http|https):\/\//i);
});
