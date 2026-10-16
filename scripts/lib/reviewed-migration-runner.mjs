import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reconcileMigrationReceipts } from "./migration-receipt-audit.mjs";
import { assertModernSchemaLineage } from "./schema-lineage-preflight.mjs";
import { assertHistoricalCatalog } from "./historical-catalog-gate.mjs";
import { ISSUE1054_MIGRATION_PATH, ISSUE1054_PREFLIGHT_SQL, ISSUE1054_POSTFLIGHT_SQL } from "./issue-1054-protected-preflight.mjs";

const MIGRATION_PATH = /^drizzle\/([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
// Match top-level SQL statement *starts*, not words within legitimate DML.
// UPDATE ... SET is valid transactional SQL; a standalone SET is not.
const DISALLOWED_STATEMENT_START = /^(?:ABORT|BEGIN|COMMIT|END|ROLLBACK|START\s+TRANSACTION|SAVEPOINT|RELEASE\s+SAVEPOINT|SET|RESET|DISCARD|VACUUM|REINDEX|CREATE\s+DATABASE|DROP\s+DATABASE|ALTER\s+SYSTEM|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY|REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY|PREPARE\s+TRANSACTION)\b/i;

function containsSqlTransactionEscape(content) {
  return sqlExecutableTokens(content).split(";").some(statement =>
    DISALLOWED_STATEMENT_START.test(statement.trim()));
}

/** SQL token view outside strings, dollar-quoted function bodies and comments.
 * Any unclosed quote/comment aborts the migration before DB access.
 */
function sqlExecutableTokens(text) {
  let tokens = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      while (i < text.length && text[i] !== "\n") i += 1;
      tokens += " ";
      continue;
    }
    if (text.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text.startsWith("/*", i)) { depth += 1; i += 2; }
        else if (text.startsWith("*/", i)) { depth -= 1; i += 2; }
        else i += 1;
      }
      if (depth !== 0) refuse("SQL_UNTERMINATED_COMMENT");
      tokens += " ";
      continue;
    }
    if (text[i] === "'" || text[i] === '"') {
      const escapeString = text[i] === "'" && i > 0 && /[eE]/.test(text[i - 1]) &&
        (i < 2 || !/[A-Za-z0-9_$]/.test(text[i - 2]));
      const quote = text[i++];
      let closed = false;
      while (i < text.length) {
        if (text[i] === quote) {
          if (text[i + 1] === quote) { i += 2; continue; }
          i += 1; closed = true; break;
        }
        if (quote === "'" && escapeString && text[i] === "\\" && text[i + 1] !== undefined) {
          i += 2; continue;
        }
        i += 1;
      }
      if (!closed) refuse("SQL_UNTERMINATED_LITERAL");
      tokens += " ";
      continue;
    }
    if (text[i] === "$") {
      const match = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) {
        const end = text.indexOf(match[0], i + match[0].length);
        if (end < 0) refuse("SQL_UNTERMINATED_DOLLAR_QUOTE");
        i = end + match[0].length;
        tokens += " ";
        continue;
      }
    }
    tokens += text[i];
    i += 1;
  }
  return tokens;
}

function refuse(reason) {
  throw new Error("REVIEWED_MIGRATION_" + reason);
}

export function requireOrderedMigrationApplyEnabled(env = process.env) {
  if (env.ORDERED_RELEASE_MIGRATIONS_ENABLED !== "true") refuse("FLAG_DISABLED");
}

function evidence(value) {
  return typeof value === "string" && value.trim().length >= 8 &&
    value.length <= 240 && !/[\r\n\0]/.test(value);
}

export function cutoverSourceManifest(inventory, throughPrefix) {
  if (!Number.isInteger(throughPrefix) || throughPrefix < 1 || throughPrefix > 9999 ||
      !Array.isArray(inventory?.files) || inventory.files.length === 0) {
    refuse("CUTOVER_INVALID");
  }
  const files = inventory.files.filter(file => Number(file.prefix) <= throughPrefix);
  if (!files.length || !files.some(file => Number(file.prefix) === throughPrefix)) {
    refuse("CUTOVER_PREFIX_NOT_IN_SOURCE");
  }
  const canonical = files.map(file => file.path + "\0" + file.sha256 + "\n").join("");
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return {
    files,
    digest,
    throughPrefix,
    duplicatePrefixes: inventory.duplicatePrefixes.filter(group => Number(group.prefix) <= throughPrefix),
  };
}

/**
 * This is the single source of plan decisions. It cannot adopt old SQL by
 * guessing: a DBA-reviewed cutover hash and every historic full-path receipt
 * must match before even one forward migration becomes eligible.
 */
export function evaluateReviewedMigration({
  inventory, cutover, receipts, applied, requestedPath, expectedSha256,
}) {
  const pathMatch = typeof requestedPath === "string" && requestedPath.match(MIGRATION_PATH);
  if (!pathMatch || !SHA256.test(expectedSha256 ?? "")) refuse("REQUEST_INVALID");
  const throughPrefix = Number(cutover?.historicalPrefix);
  const historic = cutoverSourceManifest(inventory, throughPrefix);
  if (!SHA256.test(cutover?.historicalManifestSha256 ?? "") ||
      historic.digest !== cutover.historicalManifestSha256 ||
      !evidence(cutover.evidenceRef) || !evidence(cutover.reviewedBy) ||
      !cutover.reviewedAt || !Number.isFinite(new Date(cutover.reviewedAt).getTime())) {
    refuse("CUTOVER_EVIDENCE_OR_HASH_MISMATCH");
  }
  if (!Array.isArray(receipts) || !Array.isArray(applied)) refuse("JOURNAL_MISSING");
  const historicReceipts = receipts.filter(row => {
    const match = String(row?.migrationPath ?? "").match(MIGRATION_PATH);
    if (!match) refuse("HISTORICAL_RECEIPT_PATH_INVALID");
    if (Number(match[1]) > throughPrefix) refuse("HISTORICAL_RECEIPT_OUTSIDE_BASELINE");
    return true;
  });
  const checked = reconcileMigrationReceipts(historic, historicReceipts);
  if (!checked.receiptsReconciled) refuse("HISTORICAL_RECEIPTS_UNRECONCILED");

  const nextFiles = inventory.files.filter(file => Number(file.prefix) > throughPrefix)
    .sort((a, b) => Number(a.prefix) - Number(b.prefix) || a.path.localeCompare(b.path, "en"));
  for (let index = 0; index < nextFiles.length; index += 1) {
    if (Number(nextFiles[index].prefix) !== throughPrefix + index + 1) {
      refuse("NEW_PREFIX_GAP_OR_DUPLICATE");
    }
  }
  if (applied.length > nextFiles.length) refuse("JOURNAL_EXCEEDS_SOURCE");
  const recorded = new Set();
  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index];
    const source = nextFiles[index];
    if (!source || row?.migrationPath !== source.path ||
        Number(row.migrationNumber) !== Number(source.prefix) ||
        row.sourceSha256 !== source.sha256 ||
        recorded.has(row.migrationPath) ||
        !evidence(row.appliedBy) || !evidence(row.changeRef) ||
        !row.appliedAt || !Number.isFinite(new Date(row.appliedAt).getTime())) {
      refuse("JOURNAL_DRIFT_OR_OUT_OF_ORDER");
    }
    recorded.add(row.migrationPath);
  }

  const requested = nextFiles.find(file => file.path === requestedPath);
  if (!requested || requested.sha256 !== expectedSha256) refuse("SOURCE_SHA_OR_PATH_MISMATCH");
  const appliedIndex = nextFiles.findIndex(file => file.path === requestedPath);
  if (appliedIndex > applied.length) refuse("PREVIOUS_MIGRATION_MISSING");
  return {
    status: appliedIndex < applied.length ? "already-applied" : "ready",
    path: requested.path,
    migrationNumber: Number(requested.prefix),
    sha256: requested.sha256,
    historicReceiptsVerified: checked.checkedFiles,
    historicCollisionGroups: checked.duplicatePrefixGroups,
    forwardMigrationsApplied: applied.length,
    cutoverManifestSha256: historic.digest,
    productionReleaseApproved: false,
  };
}

/** Reject psql meta-commands, transaction escapes and journal self-modification. */
export function loadReviewedSql(directory, file) {
  if (!file || !MIGRATION_PATH.test(file.path) || !SHA256.test(file.sha256 ?? "")) {
    refuse("SQL_IDENTITY_INVALID");
  }
  const filename = file.path.slice("drizzle/".length);
  const path = join(directory, filename);
  // Open one O_NOFOLLOW descriptor and read from that same descriptor. This
  // avoids the lstat(path) / readFileSync(path) TOCTOU and rejects symlinks.
  // A race replacing the pathname after open cannot change the pinned bytes.
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    refuse("SQL_NOFOLLOW_REQUIRED");
  }
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) refuse("SQL_NOT_REGULAR_FILE");
    bytes = readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) refuse("SQL_CHANGED_AFTER_PLAN");
  const content = bytes.toString("utf8");
  if (!content.trim() || content.includes("\0") || content.includes("\uFFFD") ||
      /(?:^|\n)\s*\\/.test(content) || containsSqlTransactionEscape(content) ||
      /\bpayrollph_(?:schema_migrations|migration_cutover|release_migration_receipts)\b/i.test(content)) {
    refuse("SQL_REQUIRES_NONTRANSACTIONAL_OR_MANUAL_REVIEW");
  }
  return content;
}

/**
 * One migration/one transaction. Apply acquires a transaction-scoped lock
 * before reading the journal, and inserts the immutable receipt in the SAME
 * transaction as the SQL. A broken connection cannot commit a partial file.
 * The caller is responsible for authorizing the protected release workflow.
 */
export async function runReviewedMigrationOnClient({
  client, inventory, sourceDirectory = "drizzle", mode, requestedPath,
  expectedSha256, expectedDatabaseName, operator = "", approvalRef = "",
  allowElevatedRoleForIsolatedTest = false, expectedNeonIdentity = null,
  releaseEnvironment = process.env,
}) {
  if (mode !== "plan" && mode !== "apply") refuse("MODE_INVALID");
  if (mode === "apply") requireOrderedMigrationApplyEnabled(releaseEnvironment);
  if (!allowElevatedRoleForIsolatedTest &&
      (!/^([a-z0-9-]{1,60})$/.test(expectedNeonIdentity?.projectId ?? "") ||
       !/^br-[a-z0-9-]{6,60}$/.test(expectedNeonIdentity?.branchId ?? "") ||
       !/^ep-[a-z0-9-]{6,60}$/.test(expectedNeonIdentity?.endpointId ?? ""))) {
    refuse("NEON_TARGET_PIN_REQUIRED");
  }
  if (!/^[A-Za-z0-9_]{1,63}$/.test(expectedDatabaseName ?? "")) refuse("DATABASE_NAME_INVALID");
  if (mode === "apply" && (!evidence(operator) || !evidence(approvalRef))) {
    refuse("APPLY_EVIDENCE_MISSING");
  }
  let open = false;
  try {
    await client.query(mode === "plan"
      ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
      : "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE");
    open = true;
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '90000ms'");
    await client.query("SET LOCAL search_path = pg_catalog");
    // Match the lexer's ordinary-string semantics regardless of role defaults.
    await client.query("SET LOCAL standard_conforming_strings = on");
    if (mode === "apply") {
      await client.query("SELECT pg_catalog.pg_advisory_xact_lock(20261012, 4)");
    }
    const identity = (await client.query(
      "SELECT current_database() AS \"databaseName\", " +
      "current_setting('neon.project_id', true) AS \"neonProjectId\", " +
      "current_setting('neon.branch_id', true) AS \"neonBranchId\", " +
      "current_setting('neon.endpoint_id', true) AS \"neonEndpointId\", " +
      "current_setting('transaction_read_only') = 'on' AS \"readOnly\", " +
      "pg_catalog.pg_is_in_recovery() AS \"inRecovery\", " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user AND " +
      "(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls)) AS \"elevated\", " +
      "(pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') OR " +
      "pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') OR " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND " +
      "pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) " +
      "AS \"hasWritePrivileges\", " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY[" +
      "'employees','payroll_entries','payroll_runs','legal_entities','employee_payout_change_requests']) " +
      "AND pg_catalog.has_any_column_privilege(current_user, c.oid, 'SELECT')) " +
      "AS \"canReadSensitiveRows\""
    )).rows[0];
    if (identity?.databaseName !== expectedDatabaseName ||
        (!allowElevatedRoleForIsolatedTest &&
          (identity.neonProjectId !== expectedNeonIdentity.projectId ||
           identity.neonBranchId !== expectedNeonIdentity.branchId ||
           identity.neonEndpointId !== expectedNeonIdentity.endpointId)) ||
        identity.readOnly !== (mode === "plan") ||
        (mode === "apply" && identity.inRecovery) ||
        (identity.elevated && !allowElevatedRoleForIsolatedTest) ||
        (mode === "plan" && !allowElevatedRoleForIsolatedTest &&
          (identity.hasWritePrivileges || identity.canReadSensitiveRows))) {
      refuse("DATABASE_ROLE_OR_IDENTITY_REJECTED");
    }

    // This runner only evolves a verified contemporary organization-id/
    // integer-id database. It is NOT an in-place UUID/client-id converter.
    // Metadata preflight reads only pg_catalog, never employee or bank values.
    await assertModernSchemaLineage(client);

    const tables = (await client.query(
      "SELECT to_regclass('public.payrollph_release_migration_receipts') IS NOT NULL AS \"receipts\", " +
      "to_regclass('public.payrollph_migration_cutover') IS NOT NULL AS \"cutover\", " +
      "to_regclass('public.payrollph_schema_migrations') IS NOT NULL AS \"journal\""
    )).rows[0];
    if (!tables?.receipts || !tables?.cutover || !tables?.journal) refuse("DBA_BOOTSTRAP_REQUIRED");
    const integrity = (await client.query(
      "SELECT " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a " +
      "ON a.attrelid = k.conrelid WHERE k.conrelid = to_regclass('public.payrollph_schema_migrations') " +
      "AND k.contype = 'p' AND a.attname = 'migration_path' " +
      "AND k.conkey = ARRAY[a.attnum]::smallint[]) AS \"pathPrimaryKey\", " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a " +
      "ON a.attrelid = k.conrelid WHERE k.conrelid = to_regclass('public.payrollph_schema_migrations') " +
      "AND k.contype = 'u' AND a.attname = 'migration_number' " +
      "AND k.conkey = ARRAY[a.attnum]::smallint[]) AS \"numberUnique\", " +
      "EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a " +
      "ON a.attrelid = k.conrelid WHERE k.conrelid = to_regclass('public.payrollph_migration_cutover') " +
      "AND k.contype = 'p' AND a.attname = 'id' " +
      "AND k.conkey = ARRAY[a.attnum]::smallint[]) AS \"cutoverPrimaryKey\""
    )).rows[0];
    if (!integrity?.pathPrimaryKey || !integrity.numberUnique || !integrity.cutoverPrimaryKey) {
      refuse("LEDGER_CONSTRAINTS_MISSING");
    }
    const adopted = (await client.query(
      "SELECT historical_prefix AS \"historicalPrefix\", " +
      "historical_manifest_sha256 AS \"historicalManifestSha256\", evidence_ref AS \"evidenceRef\", " +
      "reviewed_by AS \"reviewedBy\", reviewed_at AS \"reviewedAt\" " +
      "FROM public.payrollph_migration_cutover"
    )).rows;
    if (adopted.length !== 1) refuse("CUTOVER_NOT_ADOPTED");

    // Historical receipts alone are insufficient. Even a DBA-reviewed
    // disposition cannot justify forwarding past missing source-implied
    // tables/columns/unique indexes in the *actual target database*.
    // The check reads pg_catalog only and fails closed on partial results.
    // It does NOT imply that the historical files actually ran.
    await assertHistoricalCatalog(client, Number(adopted[0].historicalPrefix));

    const receipts = (await client.query(
      "SELECT migration_path AS \"migrationPath\", source_sha256 AS sha256, disposition, " +
      "evidence_ref AS \"evidenceRef\", reviewed_by AS \"reviewedBy\", recorded_at AS \"recordedAt\" " +
      "FROM public.payrollph_release_migration_receipts ORDER BY migration_path"
    )).rows;
    const applied = (await client.query(
      "SELECT migration_path AS \"migrationPath\", migration_number AS \"migrationNumber\", " +
      "source_sha256 AS \"sourceSha256\", applied_by AS \"appliedBy\", " +
      "change_ref AS \"changeRef\", applied_at AS \"appliedAt\" " +
      "FROM public.payrollph_schema_migrations ORDER BY migration_number"
    )).rows;
    const decision = evaluateReviewedMigration({
      inventory, cutover: adopted[0], receipts, applied, requestedPath, expectedSha256,
    });
    // Plan validates the exact file and SQL transaction boundary too; no DB writes.
    const sql = loadReviewedSql(sourceDirectory, decision);
    // Preserve immutable 0125. Fail-closed preflight is mandatory and runs
    // in the same protected transaction before any 0125 DDL or ledger write.
    if (decision.status === "ready" &&
        decision.path === ISSUE1054_MIGRATION_PATH) {
      await client.query(ISSUE1054_PREFLIGHT_SQL);
    }
    let sqlApplied = false;
    if (mode === "apply" && decision.status === "ready") {
      // Leave pg_catalog implicit so built-ins resolve before public functions.
      // Put pg_temp last so temporary relations cannot shadow public FKs;
      // public remains the target for unqualified CREATE TABLE statements.
      await client.query("SET LOCAL search_path = public, pg_temp");
      await client.query(sql);
      // Catalog validation must precede the immutable apply receipt.
      if (decision.path === ISSUE1054_MIGRATION_PATH) {
        await client.query(ISSUE1054_POSTFLIGHT_SQL);
      }
      await client.query(
        "INSERT INTO public.payrollph_schema_migrations " +
        "(migration_path, migration_number, source_sha256, applied_by, change_ref) " +
        "VALUES ($1, $2, $3, $4, $5)",
        [decision.path, decision.migrationNumber, decision.sha256, operator, approvalRef],
      );
      sqlApplied = true;
    }
    await client.query(mode === "plan" ? "ROLLBACK" : "COMMIT");
    open = false;
    return { ...decision, mode, sqlApplied, databaseNameMatched: true };
  } catch (error) {
    if (open) {
      try { await client.query("ROLLBACK"); } catch { /* invalid/disconnected connection */ }
    }
    throw error;
  }
}
