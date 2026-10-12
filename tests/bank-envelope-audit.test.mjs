import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BANK_AUDIT_PAGE_SIZE, BANK_AUDIT_STORES,
  requireProtectedBankAudit, auditBankEnvelopesReadOnly,
} from "../scripts/lib/bank-envelope-audit.mjs";

const env = Object.freeze({
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  REVIEWED_SHA: "a".repeat(40),
  EXPECTED_PRODUCTION_DATABASE_NAME: "app_db",
});
const classify = value => value == null || value === ""
  ? "empty"
  : typeof value !== "string" ? "unreadable"
    : value === "enc:v1:synthetic-current"
      ? "authenticated"
      : value.startsWith("enc:v1:") ? "unreadable" : "plaintext";

function fakeClient({
  sources = {}, identity = {}, rejectAt = "", overridePage,
} = {}) {
  const calls = [];
  const names = Object.fromEntries(BANK_AUDIT_STORES.map(s => [s.id, s.query]));
  const rows = Object.fromEntries(
    BANK_AUDIT_STORES.map(s => [s.id, [...(sources[s.id] ?? [])]]),
  );
  return {
    calls,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql.includes(rejectAt) && rejectAt) throw new Error("synthetic query failure");
      if (sql.includes('AS "databaseMatches"')) {
        return { rows: [{
          databaseMatches: true, readOnly: true,
          elevated: false, hasWritePrivileges: false, ...identity,
        }] };
      }
      const source = Object.entries(names).find(([, query]) => sql === query);
      if (source) {
        if (overridePage) return { rows: overridePage(source[0], args) };
        const [after, limit] = args;
        return { rows: rows[source[0]].filter(row => row.id > after).slice(0, limit) };
      }
      return { rows: [] };
    },
  };
}
const inputs = client => ({ client, env, classify });

test("P0-2 bank audit refuses unreviewed commit, non-main or invalid target before querying", async () => {
  assert.equal(requireProtectedBankAudit(env), "app_db");
  for (const broken of [
    { GITHUB_ACTIONS: undefined }, { GITHUB_ACTIONS: "false" },
    { GITHUB_REF: "refs/pull/42/merge" },
    { GITHUB_SHA: "b".repeat(40) }, { REVIEWED_SHA: "bad" },
    { EXPECTED_PRODUCTION_DATABASE_NAME: "prod-db?ssl=false" },
  ]) {
    const bad = { ...env, ...broken };
    assert.throws(() => requireProtectedBankAudit(bad), /BANK_AUDIT_PROTECTED_EXACT_MAIN_REQUIRED/);
    const db = fakeClient();
    await assert.rejects(() => auditBankEnvelopesReadOnly({
      client: db, env: bad, classify,
    }), /BANK_AUDIT_PROTECTED_EXACT_MAIN_REQUIRED/);
    assert.equal(db.calls.length, 0, "no database request before authorized exact SHA");
  }
});

test("four stores are scanned under one repeatable-read transaction with rollback and projected bank fields only", async () => {
  const db = fakeClient({ sources: {
    employees: [{ id: 1, value: "enc:v1:synthetic-current" }],
    payroll_payment_snapshots: [{ id: 4, value: "enc:v1:synthetic-current" }],
    legal_entity_disbursement_accounts: [{ id: 6, value: null }],
    payout_change_proposals: [{ id: 9, value: "enc:v1:synthetic-current" }],
  } });
  const result = await auditBankEnvelopesReadOnly({ ...inputs(db), mode: "require-zero" });
  assert.equal(result.verificationSucceeded, true);
  assert.equal(result.allCurrentKeyAuthenticated, true);
  assert.equal(result.authenticated, 3);
  assert.equal(result.plaintext, 0);
  assert.equal(result.unreadable, 0);
  assert.equal(Object.keys(result.stores).length, 4);
  assert.equal(result.productionReleaseApproved, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.changesApplied, false);
  assert.match(db.calls[0].sql, /REPEATABLE READ, READ ONLY/);
  assert.ok(db.calls.some(c => c.sql.includes("SET LOCAL row_security = off")));
  assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  assert.equal(db.calls.filter(c => c.sql.startsWith("SELECT id")).length, 4);
  assert.ok(BANK_AUDIT_STORES.find(s => s.id === "payroll_payment_snapshots").query.includes("trace #> '{payment,bankAccount}'"));
  assert.ok(db.calls.every(c => !/^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|COMMIT)\b/i.test(c.sql)));
});

test("inventory identifies plaintext without declaring the encryption gate green", async () => {
  const db = fakeClient({ sources: {
    employees: [{ id: 1, value: "SYNTHETIC-LEGACY" }],
  } });
  const inventory = await auditBankEnvelopesReadOnly({ ...inputs(db), mode: "inventory" });
  assert.equal(inventory.plaintext, 1);
  assert.equal(inventory.allCurrentKeyAuthenticated, false);
  assert.equal(inventory.requiresBackfill, true);
  assert.equal(inventory.inventoryCompleted, true, "dry run still gives actionable totals");
  assert.equal(inventory.verificationSucceeded, false, "plaintext must never produce a green gate");
  const requireZero = await auditBankEnvelopesReadOnly({
    ...inputs(fakeClient({ sources: { employees: [{ id: 1, value: "SYNTHETIC-LEGACY" }] } })),
    mode: "require-zero",
  });
  assert.equal(requireZero.verificationSucceeded, false);
});

test("unreadable ciphertext fails inventory and require-zero even if there are no plaintext rows", async () => {
  for (const mode of ["inventory", "require-zero"]) {
    const db = fakeClient({ sources: {
      payroll_payment_snapshots: [{ id: 10, value: "enc:v1:synthetic-old-key" }],
      payout_change_proposals: [{ id: 11, value: { invalid: true } }],
    } });
    const r = await auditBankEnvelopesReadOnly({ ...inputs(db), mode });
    assert.equal(r.unreadable, 2);
    assert.equal(r.plaintext, 0);
    assert.equal(r.verificationSucceeded, false);
    assert.equal(r.allCurrentKeyAuthenticated, false);
  }
});

test("keyset paging processes every row including the final full page and never repeats a cursor", async () => {
  const db = fakeClient({ sources: {
    employees: Array.from({ length: BANK_AUDIT_PAGE_SIZE * 2 }, (_, i) => ({
      id: i + 1, value: "enc:v1:synthetic-current",
    })),
  } });
  const r = await auditBankEnvelopesReadOnly({ ...inputs(db), mode: "require-zero" });
  assert.equal(r.stores.employees.authenticated, 1000);
  const probes = db.calls.filter(c => c.sql.startsWith("SELECT id") && c.sql.includes("FROM public.employees"));
  assert.deepEqual(probes.map(c => c.args[0]), [0, 500, 1000]);
  assert.ok(probes.every(c => c.args[1] === 500));
});

test("role, host database name, and true read-only mode are mandatory", async () => {
  for (const identity of [
    { databaseMatches: false }, { readOnly: false },
    { elevated: true }, { hasWritePrivileges: true },
    { elevated: null }, { hasWritePrivileges: null },
  ]) {
    const db = fakeClient({ identity });
    await assert.rejects(() => auditBankEnvelopesReadOnly(inputs(db)),
      /BANK_AUDIT_TARGET_OR_ROLE_UNVERIFIED/);
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
    assert.equal(db.calls.filter(c => c.sql.startsWith("SELECT id")).length, 0);
  }
});

test("invalid page, cursor, classifier output and failed SQL all abort with rollback", async () => {
  const cases = [
    fakeClient({ overridePage: () => Array.from({ length: 501 }, (_, i) => ({ id: i+1, value: null })) }),
    fakeClient({ overridePage: () => [{ id: 0, value: null }] }),
    fakeClient({ overridePage: () => [{ id: 1, value: null }, { id: 1, value: null }] }),
    fakeClient({ rejectAt: "FROM public.payroll_entries" }),
  ];
  for (const db of cases) {
    await assert.rejects(() => auditBankEnvelopesReadOnly(inputs(db)));
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
  }
  const db = fakeClient({ sources: { employees: [{ id: 1, value: "SYNTHETIC" }] } });
  await assert.rejects(() => auditBankEnvelopesReadOnly({
    client: db, env, classify: () => "maybe-encrypted",
  }), /BANK_AUDIT_CLASSIFIER_INVALID/);
  assert.equal(db.calls.at(-1).sql, "ROLLBACK");
});

test("operator wrapper never shows SQL or sensitive records in errors or summary", () => {
  const source = readFileSync("scripts/audit-bank-envelopes-readonly.mjs", "utf8");
  const flow = readFileSync(".github/workflows/production-bank-encryption.yml", "utf8");
  assert.match(source, /currentBankKeyOnly/);
  assert.match(source, /bankEncryptionKeySource\(currentKey\) !== "dedicated"/);
  assert.match(source, /BANK_AUDIT_EXECUTION_FAILED/);
  assert.match(source, /JSON\.stringify/);
  assert.doesNotMatch(source, /console\.log\(.*(?:bankAccount|trace|row\.value)/);
  assert.match(flow, /PRODUCTION_BANK_AUDIT_DATABASE_URL/);
});
