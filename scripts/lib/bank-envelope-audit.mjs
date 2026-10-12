/**
 * P0-2: read-only proof of *every* stored bank destination on the verified DB.
 * The caller injects the current-key crypto classifier. Never log row values.
 * This module is not imported by application request paths or workers.
 */
export const BANK_AUDIT_PAGE_SIZE = 500;
const MAX_ROWS_PER_STORE = 5_000_000;
const KEY_STATES = new Set(["empty", "plaintext", "authenticated", "unreadable"]);

export const BANK_AUDIT_STORES = Object.freeze([
  {
    id: "employees",
    query: "SELECT id, bank_account AS value FROM public.employees " +
      "WHERE id > $1 ORDER BY id LIMIT $2",
  },
  {
    id: "payroll_payment_snapshots",
    // Return only the bank field, not the full trace containing payroll/PII.
    // A non-object trace or non-object payment is unparseable, not "empty".
    query: "SELECT id, CASE " +
      "WHEN trace IS NULL OR pg_catalog.jsonb_typeof(trace) = 'null' THEN NULL " +
      "WHEN pg_catalog.jsonb_typeof(trace) <> 'object' THEN '0'::jsonb " +
      "WHEN trace ? 'payment' AND pg_catalog.jsonb_typeof(trace->'payment') NOT IN ('object','null') THEN '0'::jsonb " +
      "ELSE trace #> '{payment,bankAccount}' END AS value " +
      "FROM public.payroll_entries WHERE id > $1 ORDER BY id LIMIT $2",
  },
  {
    id: "legal_entity_disbursement_accounts",
    query: "SELECT id, disbursement_account AS value FROM public.legal_entities " +
      "WHERE id > $1 ORDER BY id LIMIT $2",
  },
  {
    id: "payout_change_proposals",
    query: "SELECT id, proposed_bank_account AS value FROM public.employee_payout_change_requests " +
      "WHERE id > $1 ORDER BY id LIMIT $2",
  },
]);

export function requireProtectedBankAudit(env) {
  if (env?.GITHUB_ACTIONS !== "true" ||
      env?.GITHUB_REF !== "refs/heads/main" ||
      !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") ||
      env.REVIEWED_SHA !== env.GITHUB_SHA ||
      !/^[A-Za-z0-9_]{1,63}$/.test(env.EXPECTED_PRODUCTION_DATABASE_NAME ?? "")) {
    throw new Error("BANK_AUDIT_PROTECTED_EXACT_MAIN_REQUIRED");
  }
  return env.EXPECTED_PRODUCTION_DATABASE_NAME;
}

function tally() {
  return { scanned: 0, empty: 0, authenticated: 0, plaintext: 0, unreadable: 0 };
}

export async function auditBankEnvelopesReadOnly({
  client, env, classify, mode = "inventory",
}) {
  const name = requireProtectedBankAudit(env);
  if (!["inventory", "require-zero"].includes(mode) || typeof classify !== "function" ||
      !client || typeof client.query !== "function") {
    throw new Error("BANK_AUDIT_INVALID_ARGUMENTS");
  }
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    // Fail if an RLS policy would silently filter tenants from a full-store audit.
    await client.query("SET LOCAL row_security = off");
    await client.query("SET LOCAL search_path = pg_catalog");

    const identity = (await client.query(
      "SELECT current_database() = $1::text AS \"databaseMatches\", " +
      "current_setting('transaction_read_only') = 'on' AS \"readOnly\", " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user AND " +
      "(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)) AS \"elevated\", " +
      "(pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') OR " +
      "pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') OR " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND " +
      "pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))) " +
      "AS \"hasWritePrivileges\"",
      [name],
    )).rows[0];
    if (!identity || identity.databaseMatches !== true ||
        identity.readOnly !== true || identity.elevated !== false ||
        identity.hasWritePrivileges !== false) {
      throw new Error("BANK_AUDIT_TARGET_OR_ROLE_UNVERIFIED");
    }

    const totals = {};
    for (const store of BANK_AUDIT_STORES) {
      const count = tally();
      let afterId = 0;
      while (true) {
        const response = await client.query(store.query, [afterId, BANK_AUDIT_PAGE_SIZE]);
        const rows = response?.rows;
        if (!Array.isArray(rows) || rows.length > BANK_AUDIT_PAGE_SIZE) {
          throw new Error("BANK_AUDIT_PAGE_INVALID");
        }
        for (const row of rows) {
          if (!Number.isSafeInteger(row?.id) || row.id <= afterId) {
            throw new Error("BANK_AUDIT_CURSOR_INVALID");
          }
          afterId = row.id;
          const state = classify(row.value);
          if (!KEY_STATES.has(state)) throw new Error("BANK_AUDIT_CLASSIFIER_INVALID");
          count[state] += 1;
          count.scanned += 1;
          if (count.scanned > MAX_ROWS_PER_STORE) {
            throw new Error("BANK_AUDIT_LIMIT_REACHED");
          }
        }
        if (rows.length < BANK_AUDIT_PAGE_SIZE) break;
      }
      totals[store.id] = count;
    }
    const plaintext = Object.values(totals).reduce((sum, item) => sum + item.plaintext, 0);
    const unreadable = Object.values(totals).reduce((sum, item) => sum + item.unreadable, 0);
    const authenticated = Object.values(totals).reduce((sum, item) => sum + item.authenticated, 0);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return {
      kind: "protected-bank-envelope-audit",
      mode, stores: totals, plaintext, unreadable, authenticated,
      allCurrentKeyAuthenticated: plaintext === 0 && unreadable === 0,
      requiresBackfill: plaintext > 0,
      inventoryCompleted: true,
      // A completed dry-run with remaining plaintext is still a RED gate.
      verificationSucceeded: plaintext === 0 && unreadable === 0,
      readOnly: true,
      changesApplied: false,
      productionReleaseApproved: false,
    };
  } finally {
    if (transactionOpen) {
      // A failed rollback makes this connection unsafe for pooling/reuse.
      try { await client.query("ROLLBACK"); } catch { /* caller closes connection */ }
    }
  }
}
