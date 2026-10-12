import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { auditBankEnvelopesReadOnly } from "../scripts/lib/bank-envelope-audit.mjs";

/** Disposable PostgreSQL 16 job only. Absolutely no real employer data. */
const rehearsal = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.BANK_AUDIT_TEST_MODE === "isolated-ci-only";
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  REVIEWED_SHA: "a".repeat(40),
  EXPECTED_PRODUCTION_DATABASE_NAME: "app_db",
};
const recognize = value => value == null ? "empty"
  : typeof value !== "string" ? "unreadable"
    : value === "enc:v1:synthetic-current" ? "authenticated"
      : value.startsWith("enc:v1:") ? "unreadable" : "plaintext";

test("P0-2 PostgreSQL proof: catalog roles, real JSONB, four stores, fail-closed RLS", {
  skip: !rehearsal, timeout: 60000,
}, async () => {
  // Validate only the disposable CI service, before constructing ANY client.
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");

  const admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 4000 });
  const auditName = "synthetic_bank_audit_ro_20261012";
  const auditPassword = "synthetic-ci-only-not-a-real-secret";
  const reader = new pg.Client({
    connectionString: "postgresql://" + auditName + ":" + auditPassword + "@127.0.0.1:5432/app_db",
    connectionTimeoutMillis: 4000,
  });
  let adminConnected = false;
  let readerConnected = false;
  try {
    await admin.connect();
    adminConnected = true;
    await admin.query("CREATE TABLE public.employees(id integer PRIMARY KEY, bank_account text)");
    await admin.query("CREATE TABLE public.payroll_entries(id integer PRIMARY KEY, trace jsonb)");
    await admin.query("CREATE TABLE public.legal_entities(id integer PRIMARY KEY, disbursement_account text)");
    await admin.query("CREATE TABLE public.employee_payout_change_requests(id integer PRIMARY KEY, proposed_bank_account text)");
    await admin.query("CREATE ROLE " + auditName + " LOGIN PASSWORD '" + auditPassword + "'");
    await admin.query("GRANT USAGE ON SCHEMA public TO " + auditName);
    await admin.query("GRANT SELECT(id,bank_account) ON TABLE public.employees TO " + auditName);
    await admin.query("GRANT SELECT(id,trace) ON TABLE public.payroll_entries TO " + auditName);
    await admin.query("GRANT SELECT(id,disbursement_account) ON TABLE public.legal_entities TO " + auditName);
    await admin.query("GRANT SELECT(id,proposed_bank_account) ON TABLE public.employee_payout_change_requests TO " + auditName);
    await admin.query("INSERT INTO public.employees VALUES (1,'enc:v1:synthetic-current')");
    await admin.query("INSERT INTO public.payroll_entries VALUES (2,$1::jsonb)",
      [JSON.stringify({ payment: { bankAccount: "enc:v1:synthetic-current" }, gross: "DO-NOT-READ" })]);
    await admin.query("INSERT INTO public.legal_entities VALUES (3,'enc:v1:synthetic-current')");
    await admin.query("INSERT INTO public.employee_payout_change_requests VALUES (4,'enc:v1:synthetic-current')");

    await reader.connect();
    readerConnected = true;
    const first = await auditBankEnvelopesReadOnly({
      client: reader, env, mode: "require-zero", classify: recognize,
    });
    assert.equal(first.allCurrentKeyAuthenticated, true);
    assert.equal(first.authenticated, 4);
    assert.equal(first.changesApplied, false);
    assert.equal(first.readOnly, true);
    assert.equal(first.productionReleaseApproved, false);

    // New plaintext must make even the supposedly informational inventory RED.
    await admin.query("INSERT INTO public.employees VALUES (5,'synthetic-plaintext')");
    const plain = await auditBankEnvelopesReadOnly({
      client: reader, env, mode: "inventory", classify: recognize,
    });
    assert.equal(plain.plaintext, 1);
    assert.equal(plain.verificationSucceeded, false);
    await admin.query("DELETE FROM public.employees WHERE id = 5");

    // Stale-key-only records and malformed JSON cannot be accepted by prefix.
    await admin.query("UPDATE public.payroll_entries SET trace = $1::jsonb WHERE id = 2",
      [JSON.stringify({ payment: { bankAccount: "enc:v1:synthetic-old" } })]);
    const oldKey = await auditBankEnvelopesReadOnly({
      client: reader, env, mode: "require-zero", classify: recognize,
    });
    assert.equal(oldKey.unreadable, 1);
    assert.equal(oldKey.verificationSucceeded, false);
    await admin.query("UPDATE public.payroll_entries SET trace = '42'::jsonb WHERE id = 2");
    const wrongType = await auditBankEnvelopesReadOnly({
      client: reader, env, mode: "inventory", classify: recognize,
    });
    assert.equal(wrongType.unreadable, 1);

    // A role that can read the table but is filtered by RLS cannot certify "all".
    await admin.query("ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY");
    await assert.rejects(() => auditBankEnvelopesReadOnly({
      client: reader, env, mode: "require-zero", classify: recognize,
    }));
    await admin.query("ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY");

    // Superuser and wrong database identity must be refused before row scans.
    await assert.rejects(() => auditBankEnvelopesReadOnly({
      client: admin, env, mode: "require-zero", classify: recognize,
    }), /BANK_AUDIT_TARGET_OR_ROLE_UNVERIFIED/);
    await assert.rejects(() => auditBankEnvelopesReadOnly({
      client: reader, env: { ...env, EXPECTED_PRODUCTION_DATABASE_NAME: "other_db" },
      mode: "require-zero", classify: recognize,
    }), /BANK_AUDIT_TARGET_OR_ROLE_UNVERIFIED/);
  } finally {
    if (readerConnected) { try { await reader.end(); } catch {} }
    if (adminConnected) {
      try {
        await admin.query("DROP TABLE IF EXISTS public.employee_payout_change_requests");
        await admin.query("DROP TABLE IF EXISTS public.legal_entities");
        await admin.query("DROP TABLE IF EXISTS public.payroll_entries");
        await admin.query("DROP TABLE IF EXISTS public.employees");
        // Schema USAGE survives table cleanup and prevents DROP ROLE.
        // Revoke only the privilege this disposable test granted.
        await admin.query("REVOKE USAGE ON SCHEMA public FROM " + auditName);
        await admin.query("DROP ROLE IF EXISTS " + auditName);
      } finally {
        try { await admin.end(); } catch {}
      }
    }
  }
});
