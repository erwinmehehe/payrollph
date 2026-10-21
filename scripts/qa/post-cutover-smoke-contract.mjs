// Shared, metadata-only post-cutover assertions. No connection is opened by import.
// Keep errors/report output allowlisted: PostgreSQL errors may contain connection material.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FORBIDDEN_TARGET_BRANCHES, cutoverManifest } from "../lib/clean-baseline-cutover.mjs";

export const PROJECT = "calm-wave-70219564";
export const DATABASE = "payrollph_clean_baseline";
export const ROLES = Object.freeze({
  app: "payrollph_app", planner: "payrollph_migration_planner",
  sealer: "payrollph_sealer_login", group: "payrollph_audit_sealing",
});
export const GENESIS = "0".repeat(64);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const PIN = /^(?:br|ep)-[a-z0-9-]{6,60}$/;
const SHA = /^[a-f0-9]{40}$/;

export function requireLiveOperator(env, argv) {
  assert.ok(env.CI !== "true" && env.GITHUB_ACTIONS !== "true",
    "LIVE_OPERATOR_ONLY_NOT_IN_CI");
  assert.ok(!argv.includes("--write") && !argv.includes("--fictional-write") &&
    !argv.includes("--confirm"), "LIVE_WRITES_NOT_IMPLEMENTED_REFUSED");
  assert.equal(env.EXPECTED_PRODUCTION_DATABASE_NAME, DATABASE,
    "PIN_DATABASE_MUST_BE_CLEAN_BASELINE");
  assert.equal(env.EXPECTED_PRODUCTION_NEON_PROJECT_ID, PROJECT,
    "PIN_PROJECT_MISMATCH");
  assert.match(env.EXPECTED_PRODUCTION_NEON_BRANCH_ID ?? "", PIN,
    "PIN_BRANCH_REQUIRED");
  assert.match(env.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID ?? "", PIN,
    "PIN_ENDPOINT_REQUIRED");
  assert.ok(!FORBIDDEN_TARGET_BRANCHES.includes(env.EXPECTED_PRODUCTION_NEON_BRANCH_ID),
    "PIN_FORBIDDEN_BRANCH");
  assert.equal(env.EXPECTED_PRODUCTION_RUNTIME_DB_ROLE, ROLES.app,
    "PIN_RUNTIME_ROLE_MUST_BE_RESTRICTED_APP");
  assert.match(env.EXPECTED_PRODUCTION_COMMIT_SHA ?? "", SHA,
    "PIN_REVIEWED_COMMIT_REQUIRED");
}

export function validateDatabaseUrl(url, expectedRole, env, local = false) {
  assert.ok(IDENTIFIER.test(expectedRole), "ROLE_IDENTIFIER_INVALID");
  let parsed;
  try { parsed = new URL(url); } catch { assert.fail("DATABASE_URL_INVALID"); }
  assert.ok(["postgresql:", "postgres:"].includes(parsed.protocol), "DATABASE_SCHEME_INVALID");
  assert.equal(decodeURIComponent(parsed.username), expectedRole, "DATABASE_LOGIN_MISMATCH");
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), DATABASE, "DATABASE_NAME_MISMATCH");
  assert.ok(parsed.password, "DATABASE_AUTH_REQUIRED");
  assert.ok(!parsed.hash && [...parsed.searchParams.keys()].every(key => key === "sslmode"),
    "DATABASE_STARTUP_OVERRIDES_REFUSED");
  if (local) {
    assert.equal(parsed.hostname, "127.0.0.1", "CI_MUST_USE_LOOPBACK");
    assert.equal(parsed.port || "5432", "5432", "CI_PORT_MUST_BE_DISPOSABLE");
    assert.equal(env.CI, "true", "CI_MARKER_REQUIRED");
    assert.equal(env.GITHUB_ACTIONS, "true", "ACTIONS_MARKER_REQUIRED");
  } else {
    assert.ok(parsed.hostname.endsWith(".neon.tech") && parsed.hostname !== ".neon.tech",
      "LIVE_DATABASE_MUST_USE_NEON_HOST");
    assert.ok(["require", "verify-full", "verify-ca"].includes(parsed.searchParams.get("sslmode")),
      "LIVE_TLS_REQUIRED");
  }
  return { host: parsed.hostname, port: parsed.port || "5432", database: DATABASE };
}

export function assertSameDatabase(locations) {
  assert.deepEqual([...new Set(locations.map(l => [l.host, l.port, l.database].join("|")))].length,
    1, "APP_PLANNER_SEALER_DIFFERENT_DATABASE_ENDPOINTS");
}

export function assessChain(rows, heads) {
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.organization_id ?? 0);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const headMap = new Map(heads.map(h => [String(h.chain_key), h]));
  const allKeys = new Set([...grouped.keys(), ...headMap.keys()]);
  const problems = [];
  let sealed = 0, pending = 0;
  for (const key of allKeys) {
    const chain = grouped.get(key) ?? [];
    const ordered = chain.filter(row => row.chain_seq !== null).sort(
      (a, b) => Number(a.chain_seq) - Number(b.chain_seq));
    let previous = GENESIS, next = 1;
    for (const row of ordered) {
      const seq = Number(row.chain_seq);
      if (!Number.isSafeInteger(seq) || seq !== next) problems.push("sequence_gap");
      if (row.prev_hash !== previous) problems.push("link_broken");
      if (!row.row_hash || row.row_hash !== row.expected_hash) problems.push("row_altered");
      previous = row.row_hash ?? "";
      next = seq + 1;
      sealed++;
    }
    for (const row of chain.filter(r => r.chain_seq === null)) {
      pending++;
      if (row.prev_hash !== null || row.row_hash !== null || row.expected_hash !== null)
        problems.push("pending_evidence");
    }
    const head = headMap.get(key);
    if (!head && ordered.length) problems.push("head_missing");
    if (head) {
      const anchor = ordered.at(-1);
      if (Number(head.last_seq) !== (anchor ? Number(anchor.chain_seq) : 0) ||
        head.last_hash !== (anchor ? anchor.row_hash : GENESIS))
        problems.push("head_mismatch");
    }
  }
  return { verified: problems.length === 0, breaks: [...new Set(problems)].sort(),
    sealedEvents: sealed, pendingEvents: pending, chainsChecked: allKeys.size };
}

export async function readAuditChain(client) {
  const { rows } = await client.query(`SELECT organization_id, id, chain_seq, prev_hash, row_hash,
    CASE WHEN chain_seq IS NULL THEN NULL ELSE public.audit_event_row_hash(
      prev_hash, chain_seq, id, organization_id, actor, action, resource, metadata, created_at
    ) END AS expected_hash FROM public.audit_events ORDER BY organization_id NULLS FIRST, id`);
  const heads = (await client.query(
    "SELECT chain_key, last_seq, last_hash FROM public.audit_chain_heads")).rows;
  return assessChain(rows, heads);
}

export async function readCatalog(client) {
  const tables = (await client.query(`SELECT c.relname AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows;
  const columns = (await client.query(`SELECT c.relname AS relation, a.attname AS column,
    a.atttypid::regtype::text AS type, a.attnotnull AS required, a.atttypmod AS modifier
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`)).rows;
  return { tableCount: tables.length,
    fingerprintSha256: createHash("sha256").update(JSON.stringify({tables,columns})).digest("hex") };
}

export async function inspectRoles(client) {
  const result = await client.query(`SELECT rolname, rolcanlogin, rolinherit,
    rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])`,
    [[ROLES.app, ROLES.planner, ROLES.sealer, ROLES.group]]);
  assert.equal(result.rows.length, 4, "ROLE_FOUR_REQUIRED");
  const map = new Map(result.rows.map(row => [row.rolname, row]));
  for (const [name, role] of map) {
    assert.equal(Boolean(role.rolsuper || role.rolcreatedb || role.rolcreaterole ||
      role.rolreplication || role.rolbypassrls), false, `ROLE_ELEVATED_${name}`);
    assert.equal(role.rolcanlogin, name !== ROLES.group, `ROLE_LOGIN_ATTRIBUTE_${name}`);
  }
  assert.equal(map.get(ROLES.group).rolinherit, false, "SEALING_GROUP_MUST_NOT_INHERIT");
  return { checked: map.size };
}

export async function inspectIdentity(client, env, expectedRole, local = false) {
  const r = (await client.query(`SELECT current_database() AS database,
    current_user AS role, session_user AS login,
    pg_catalog.current_setting('neon.project_id',true) AS project,
    pg_catalog.current_setting('neon.branch_id',true) AS branch,
    pg_catalog.current_setting('neon.endpoint_id',true) AS endpoint,
    pg_catalog.pg_is_in_recovery() AS replica`)).rows[0];
  assert.equal(r.database, DATABASE, "SESSION_DATABASE_MISMATCH");
  assert.equal(r.role, expectedRole, "SESSION_ROLE_MISMATCH");
  assert.equal(r.login, expectedRole, "SESSION_LOGIN_MISMATCH");
  assert.equal(r.replica, false, "SESSION_READ_REPLICA");
  if (!local) {
    assert.equal(r.project, env.EXPECTED_PRODUCTION_NEON_PROJECT_ID, "SESSION_PROJECT_MISMATCH");
    assert.equal(r.branch, env.EXPECTED_PRODUCTION_NEON_BRANCH_ID, "SESSION_BRANCH_MISMATCH");
    assert.equal(r.endpoint, env.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID, "SESSION_ENDPOINT_MISMATCH");
    assert.ok(!FORBIDDEN_TARGET_BRANCHES.includes(r.branch), "SESSION_FORBIDDEN_BRANCH");
  }
  return { role: expectedRole, pinned: !local };
}

export async function inspectLedger(client) {
  const { throughPrefix, manifest } = cutoverManifest();
  const rows = (await client.query(`SELECT historical_prefix, historical_manifest_sha256,
    (SELECT count(*)::int FROM public.payrollph_release_migration_receipts
      WHERE disposition='baseline-included') AS receipts
    FROM public.payrollph_migration_cutover`)).rows;
  assert.equal(rows.length, 1, "CUTOVER_SINGLE_ROW_REQUIRED");
  assert.equal(rows[0].historical_prefix, throughPrefix, "CUTOVER_PREFIX_MISMATCH");
  assert.equal(rows[0].historical_manifest_sha256.trim(), manifest.digest, "CUTOVER_MANIFEST_MISMATCH");
  assert.equal(rows[0].receipts, manifest.files.length, "CUTOVER_RECEIPT_COUNT_MISMATCH");
  return { throughPrefix, receipts: rows[0].receipts };
}

export async function inspectGrants(client) {
  const q = async (role, table, privilege) => (await client.query(
    "SELECT pg_catalog.has_table_privilege($1,$2,$3) AS allowed",
    [role, "public." + table, privilege])).rows[0]?.allowed;
  for (const privilege of ["UPDATE", "DELETE", "TRUNCATE", "TRIGGER"]) {
    assert.equal(await q(ROLES.app, "audit_events", privilege), false,
      `APP_AUDIT_${privilege}_MUST_BE_DENIED`);
  }
  for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
    assert.equal(await q(ROLES.app, "audit_chain_heads", privilege), false,
      `APP_HEAD_${privilege}_MUST_BE_DENIED`);
  }
  for (const table of ["payrollph_migration_cutover",
    "payrollph_schema_migrations", "payrollph_release_migration_receipts"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.equal(await q(ROLES.app, table, privilege), false,
        `APP_PROTECTED_LEDGER_${table}_${privilege}_MUST_BE_DENIED`);
    }
    assert.equal(await q(ROLES.planner, table, "SELECT"), true,
      `PLANNER_LEDGER_READ_REQUIRED_${table}`);
  }
  for (const table of ["organizations", "employees", "payroll_runs", "payroll_entries", "payslips"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.equal(await q(ROLES.app, table, privilege), true,
        `APP_BUSINESS_DML_REQUIRED_${table}_${privilege}`);
    }
  }
  for (const role of [ROLES.app, ROLES.planner, ROLES.sealer]) {
    assert.equal((await client.query(
      "SELECT pg_catalog.has_database_privilege($1,current_database(),'CREATE') AS allowed",
      [role])).rows[0].allowed, false, `ROLE_NO_DATABASE_CREATE_${role}`);
    assert.equal((await client.query(
      "SELECT pg_catalog.has_schema_privilege($1,'public','CREATE') AS allowed",
      [role])).rows[0].allowed, false, `ROLE_NO_SCHEMA_CREATE_${role}`);
  }
  return { checked: true };
}

export async function inspectExtension(client) {
  const rows = (await client.query(
    "SELECT extname FROM pg_catalog.pg_extension WHERE extname='btree_gist'")).rows;
  assert.equal(rows.length, 1, "BTREE_GIST_MISSING");
  return { btreeGist: true };
}

export function reportWriter(kind, path) {
  const ci = kind === "ci" || kind.includes("ci-smoke");
  const report = { kind, version: 1, checks: [], safe: true, databaseWrites: ci,
    productionReleaseApproved: false };
  const check = async (name, run, options = {}) => {
    try {
      const detail = await run();
      report.checks.push({ name, status: "PASS", ...(detail ? { detail } : {}) });
      return detail ?? true;
    } catch (error) {
      const message = error?.name === "AssertionError"
        ? String(error.message).split("\n")[0].slice(0, 200)
        : String(error?.message ?? "").startsWith("SMOKE_")
          ? String(error.message).slice(0, 200)
          : `UNEXPECTED_${/^[A-Z0-9]{4,6}$/.test(error?.code) ? error.code : "ERROR"}`;
      report.checks.push({ name, status: "FAIL", assertion: message });
      if (options.fatal) throw new Error("SMOKE_ROLE_PROOF_STOP_OWNER_REVIEW");
      return null;
    }
  };
  const finish = (extra = {}) => {
    report.passed = report.checks.filter(c => c.status === "PASS").length;
    report.failed = report.checks.filter(c => c.status === "FAIL").length;
    Object.assign(report, extra);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    if (process.env.GITHUB_STEP_SUMMARY && ci) {
      const summary = [
        "## Post-cutover smoke (disposable, no Neon)",
        "",
        `**Result:** ${report.failed ? "FAIL" : "PASS"} — ${report.passed} passed, ${report.failed} failed`,
        "",
        "| Check | Status | Assertion |", "| --- | --- | --- |",
        ...report.checks.map(c => `| ${c.name} | ${c.status} | ${c.assertion ?? "—"} |`),
        "",
      ].join("\n");
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    }
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
  };
  return { report, check, finish };
}
