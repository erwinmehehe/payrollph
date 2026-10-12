import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

const ciReady = process.env.CI === "true"
  && process.env.PAYOUT_TRAIN_REHEARSAL === "isolated-localhost-pg-only";

function localOnlyURL() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("PAYOUT_TRAIN_LOCAL_DATABASE_REQUIRED");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.port !== "5432" || url.pathname !== "/app_db"
    || url.username !== "postgres" || url.search || url.hash) {
    throw new Error("PAYOUT_TRAIN_ONLY_LOCAL_DISPOSABLE_POSTGRES_ALLOWED");
  }
  return value;
}

async function runFileAtomic(client, file) {
  const sql = readFileSync("drizzle/" + file, "utf8");
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im,
    "atomic reviewed SQL must be transaction-owned by the caller");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function mustReject(client, sql, pgCode) {
  await client.query("SAVEPOINT expected_negative");
  let caught;
  try { await client.query(sql); } catch (err) { caught = err; }
  await client.query("ROLLBACK TO SAVEPOINT expected_negative");
  await client.query("RELEASE SAVEPOINT expected_negative");
  assert.ok(caught, "unsafe insertion must fail");
  assert.equal(caught.code, pgCode);
}

test("0115 profiles then 0116 payout then 0119 Xendit: exact source, Postgres 16/18, no money out", {
  skip: !ciReady, timeout: 60_000,
}, async () => {
  const client = new pg.Client({
    connectionString: localOnlyURL(), connectionTimeoutMillis: 5000,
  });
  await client.connect();
  let inTxn = false;
  try {
    await client.query("BEGIN");
    inTxn = true;
    for (const sql of [
      "CREATE TABLE public.organizations(id integer PRIMARY KEY)",
      "CREATE TABLE public.legal_entities(id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.organizations(id))",
      "CREATE TABLE public.users(id integer PRIMARY KEY)",
      "CREATE TABLE public.bank_templates(id integer PRIMARY KEY)",
      "CREATE TABLE public.payroll_runs(id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.organizations(id))",
      "CREATE TABLE public.employees(id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.organizations(id))",
      "CREATE TABLE public.payroll_entries(id integer PRIMARY KEY, payroll_run_id integer NOT NULL REFERENCES public.payroll_runs(id), employee_id integer NOT NULL REFERENCES public.employees(id))",
      "INSERT INTO public.organizations(id) VALUES (101),(102)",
      "INSERT INTO public.legal_entities(id,organization_id) VALUES (201,101),(202,102)",
      "INSERT INTO public.users(id) VALUES (301)",
      "INSERT INTO public.bank_templates(id) VALUES (401)",
      "INSERT INTO public.payroll_runs(id,organization_id) VALUES (501,101),(502,102)",
      "INSERT INTO public.employees(id,organization_id) VALUES (601,101),(602,102)",
      "INSERT INTO public.payroll_entries(id,payroll_run_id,employee_id) VALUES (701,501,601),(702,502,602)",
    ]) await client.query(sql);
    await client.query("COMMIT");
    inTxn = false;

    await runFileAtomic(client, "0115_payout_profiles_foundation.sql");
    await runFileAtomic(client, "0116_payout_ledger_foundation.sql");
    await runFileAtomic(client, "0119_xendit_payout_provider.sql");

    const triggers = await client.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_trigger t " +
      "JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid " +
      "WHERE NOT t.tgisinternal AND t.tgname LIKE '%tenant_guard' " +
      "AND c.relname IN ('payout_profiles','payout_batches','payout_transfers','payout_batch_transfers')");
    assert.equal(triggers.rows[0].count, 4);

    await client.query("BEGIN");
    inTxn = true;
    await mustReject(client,
      "INSERT INTO public.payout_profiles(organization_id,legal_entity_id) VALUES(102,201)",
      "23514");
    await client.query(
      "INSERT INTO public.payout_profiles(organization_id,legal_entity_id) VALUES(101,201)");
    const profile = await client.query(
      "SELECT default_method,active FROM public.payout_profiles WHERE legal_entity_id=201");
    assert.deepEqual(profile.rows[0],{default_method:"bank_file",active:false});
    await client.query(
      "UPDATE public.payout_profiles SET default_method='xendit' WHERE legal_entity_id=201");
    await mustReject(client,
      "UPDATE public.payout_profiles SET default_method='unsupported' WHERE legal_entity_id=201",
      "23514");

    await mustReject(client,
      "INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES(102,501,'bad-org',repeat('a',64),1,123)",
      "23514");
    await client.query(
      "INSERT INTO public.payout_batches(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES(101,501,'safe-batch',repeat('a',64),1,123)");
    await client.query(
      "INSERT INTO public.payout_batches(organization_id,payroll_run_id,provider,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES(102,502,'xendit','synthetic-xendit',repeat('a',64),1,123)");
    await mustReject(client,
      "INSERT INTO public.payout_batches(organization_id,payroll_run_id,provider,idempotency_key,request_hash,transfer_count,total_amount_cents) VALUES(102,502,'bad-provider','bad-provider',repeat('a',64),1,123)",
      "23514");

    await client.query(
      "INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) VALUES (101,501,701,601,'synthetic-entry',123)");
    await mustReject(client,
      "INSERT INTO public.payout_transfers(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) VALUES (102,501,701,601,'synthetic-mismatched-org',123)",
      "23514");

    const tables = await client.query(
      "SELECT (SELECT count(*)::int FROM public.payout_profiles) AS p, " +
      "(SELECT count(*)::int FROM public.payout_batches) AS b, " +
      "(SELECT count(*)::int FROM public.payout_transfers) AS t");
    assert.deepEqual(tables.rows[0],{p:1,b:2,t:1});

    await client.query("ROLLBACK");
    inTxn = false;
    const clean = await client.query(
      "SELECT (SELECT count(*)::int FROM public.payout_profiles) AS p, " +
      "(SELECT count(*)::int FROM public.payout_batches) AS b, " +
      "(SELECT count(*)::int FROM public.payout_transfers) AS t");
    assert.deepEqual(clean.rows[0],{p:0,b:0,t:0});

    await client.query("BEGIN");
    inTxn = true;
    try {
      await client.query("CREATE TABLE public._payout_train_failed_ddl(id integer PRIMARY KEY)");
      await assert.rejects(() => client.query("SELECT 1/0"),err=>err?.code==="22012");
    } finally {
      await client.query("ROLLBACK");
      inTxn = false;
    }
    const rollback = await client.query(
      "SELECT to_regclass('public._payout_train_failed_ddl') IS NULL AS rolled_back");
    assert.equal(rollback.rows[0].rolled_back,true);
  } finally {
    if(inTxn) { try{await client.query("ROLLBACK");}catch{} }
    await client.end();
  }
});

test("proposed train is source-only; no implicit money activation", () => {
  const text = readFileSync("docs/engineering/pending-migration-release-train.md","utf8");
  assert.match(text,/DO NOT RUN ON NEON MAIN/);
  assert.match(text,/historical receipt/);
  assert.match(text,/Original endpoint/);
  const numbered = readFileSync("drizzle/0121_multi_entity_v2_scope_transfer.sql","utf8");
  assert.doesNotMatch(numbered,/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im);
  assert.match(numbered,/worker_employment_events/);
});
