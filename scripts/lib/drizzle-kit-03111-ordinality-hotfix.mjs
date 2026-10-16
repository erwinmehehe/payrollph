/**
 * #1019: tightly scoped local development patch for pinned drizzle-kit@0.31.11.
 * Fixes the upstream PG composite-key introspection ordering/pairing defect.
 *
 * The patch is NOT a migration, an alter/drop workaround, or a no-op bypass.
 * The real drizzle-kit push still runs through strict-db-push.mjs and MUST
 * report an unambiguous DDL-free second push. Refuse unknown layouts.
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const VERSION = "0.31.11";
const RC = "1.0.0-rc.4";
const KEY_MARKER = "PAYROLLPH_1019_ORDERED_KEY_COLUMNS_V1";
const FK_MARKER = "PAYROLLPH_1019_PAIRED_FOREIGN_COLUMNS_V1";
const INDEX_MARKER = "PAYROLLPH_1019_INDEX_COLUMN_EXPRESSION_V1";

const keyQuery = /SELECT\s+c\.column_name,\s+c\.data_type,\s+constraint_type,\s+constraint_name,\s+constraint_schema\s+FROM\s+information_schema\.table_constraints\s+tc\s+JOIN\s+information_schema\.constraint_column_usage\s+AS\s+ccu\s+USING\s*\(constraint_schema,\s*constraint_name\)\s+JOIN\s+information_schema\.columns\s+AS\s+c\s+ON\s+c\.table_schema\s*=\s*tc\.constraint_schema\s+AND\s+tc\.table_name\s*=\s*c\.table_name\s+AND\s+ccu\.column_name\s*=\s*c\.column_name\s+WHERE\s+tc\.table_name\s*=\s*'\$\{[^}]+\}'\s+and\s+constraint_schema\s*=\s*'\$\{[^}]+\}'\s*;/g;

const keyJoin = /JOIN\s+information_schema\.constraint_column_usage\s+AS\s+ccu\s+USING\s*\(constraint_schema,\s*constraint_name\)\s+JOIN\s+information_schema\.columns\s+AS\s+c\s+ON\s+c\.table_schema\s*=\s*tc\.constraint_schema\s+AND\s+tc\.table_name\s*=\s*c\.table_name\s+AND\s+ccu\.column_name\s*=\s*c\.column_name/;

const fkQuery = /SELECT\s+con\.contype\s+AS\s+constraint_type,[\s\S]*?FROM\s+pg_catalog\.pg_constraint\s+con[\s\S]*?AND\s+con\.contype\s+IN\s*\('f'\)\s*;/g;

const fkJoin = /LEFT\s+JOIN\s+pg_catalog\.pg_attribute\s+att\s+ON\s+att\.attnum\s*=\s*ANY\s*\(con\.conkey\)\s+AND\s+att\.attrelid\s*=\s*con\.conrelid\s+LEFT\s+JOIN\s+pg_catalog\.pg_class\s+frel\s+ON\s+frel\.oid\s*=\s*con\.confrelid\s+LEFT\s+JOIN\s+pg_catalog\.pg_namespace\s+fnsp\s+ON\s+fnsp\.oid\s*=\s*frel\.relnamespace\s+LEFT\s+JOIN\s+pg_catalog\.pg_attribute\s+fatt\s+ON\s+fatt\.attnum\s*=\s*ANY\s*\(con\.confkey\)\s+AND\s+fatt\.attrelid\s*=\s*con\.confrelid/;

// Pin to the known 0.31.11 index query only: checking i.indexprs marks
// every column of a mixed-expression index as an expression. k.attnum=0
// identifies the individual expression key without changing any index DDL.
const indexExpression = /CASE\s+WHEN\s+(?:pg_catalog\.)?pg_get_expr\(i\.indexprs,\s*i\.indrelid\)\s+IS\s+NOT\s+NULL\s+THEN\s+1\s+ELSE\s+0\s+END\s+AS\s+is_expression/gi;

function fail(code) { throw new Error("DRIZZLE_1019_" + code); }
function occurrences(s, marker) { return s.split(marker).length - 1; }

export function patchPinnedIntrospectionBinary(binary) {
  if (typeof binary !== "string") fail("BAD_BINARY");
  if (binary.includes(KEY_MARKER) || binary.includes(FK_MARKER) || binary.includes(INDEX_MARKER)) {
    const selectedFkQueries = [...binary.matchAll(fkQuery)];
    // Other independent introspection queries in the installed Kit bundle can
    // retain this join shape. Validate only the FK query we actually rewrote.
    if (occurrences(binary, KEY_MARKER) !== 1 || occurrences(binary, FK_MARKER) !== 1 ||
        occurrences(binary, INDEX_MARKER) !== 2 ||
        [...binary.matchAll(indexExpression)].length !== 0 ||
        keyQuery.test(binary) || selectedFkQueries.length !== 1 ||
        !selectedFkQueries[0][0].includes("JOIN LATERAL ROWS FROM (pg_catalog.unnest(con.conkey), pg_catalog.unnest(con.confkey)) WITH ORDINALITY") ||
        !selectedFkQueries[0][0].includes("ORDER BY con.conname, fkcols.ord;")) fail("PARTIAL_OR_UNKNOWN_PATCH");
    return { content: binary, applied: false };
  }
  const keys = [...binary.matchAll(keyQuery)];
  const fks = [...binary.matchAll(fkQuery)];
  const indexPredicates = [...binary.matchAll(indexExpression)];
  // The exact release source has one copy of each query. A new upstream
  // package layout must not silently be treated as a supported hotfix.
  if (keys.length !== 1 || fks.length !== 1 || indexPredicates.length !== 2 ||
      !fkJoin.test(fks[0][0])) {
    fail("UNRECOGNIZED_UPSTREAM_QUERY");
  }
  const patchedKeys = keys[0][0]
    .replace(/SELECT\s+c\.column_name,\s+c\.data_type,\s+constraint_type,\s+constraint_name,\s+constraint_schema/,
      "SELECT c.column_name, c.data_type, tc.constraint_type AS constraint_type, tc.constraint_name AS constraint_name, tc.constraint_schema AS constraint_schema")
    .replace(keyJoin,
      "JOIN information_schema.key_column_usage AS kcu ON " +
      "kcu.constraint_catalog = tc.constraint_catalog AND " +
      "kcu.constraint_schema = tc.constraint_schema AND " +
      "kcu.constraint_name = tc.constraint_name AND " +
      "kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name " +
      "JOIN information_schema.columns AS c ON c.table_schema = tc.table_schema " +
      "AND tc.table_name = c.table_name AND kcu.column_name = c.column_name")
    .replace(/\band\s+constraint_schema\s*=/, "and tc.constraint_schema =")
    .replace(/;\s*$/, " ORDER BY tc.constraint_name, kcu.ordinal_position; /* " + KEY_MARKER + " */");
  if (!patchedKeys.includes(KEY_MARKER) || patchedKeys.includes("constraint_column_usage")) {
    fail("KEY_QUERY_REWRITE_INCOMPLETE");
  }
  const patchedFks = fks[0][0]
    .replace(fkJoin,
      // Schema-qualified pg_catalog.unnest(array,array) is not callable: use
      // ROWS FROM to zip two schema-qualified one-array calls by ordinality.
      "JOIN LATERAL ROWS FROM (pg_catalog.unnest(con.conkey), pg_catalog.unnest(con.confkey)) WITH ORDINALITY " +
      "AS fkcols(source_attnum, target_attnum, ord) ON true " +
      "JOIN pg_catalog.pg_attribute att ON att.attnum = fkcols.source_attnum " +
      "AND att.attrelid = con.conrelid " +
      "LEFT JOIN pg_catalog.pg_class frel ON frel.oid = con.confrelid " +
      "LEFT JOIN pg_catalog.pg_namespace fnsp ON fnsp.oid = frel.relnamespace " +
      "JOIN pg_catalog.pg_attribute fatt ON fatt.attnum = fkcols.target_attnum " +
      "AND fatt.attrelid = con.confrelid")
    .replace(/;\s*$/, " ORDER BY con.conname, fkcols.ord; /* " + FK_MARKER + " */");
  if (!patchedFks.includes(FK_MARKER) || fkJoin.test(patchedFks)) {
    fail("FK_QUERY_REWRITE_INCOMPLETE");
  }
  const rewritten = binary.replace(keys[0][0], patchedKeys).replace(fks[0][0], patchedFks)
    .replace(indexExpression,
      "CASE WHEN k.attnum = 0 THEN 1 ELSE 0 END AS is_expression /* " + INDEX_MARKER + " */");
  if (rewritten === binary || occurrences(rewritten, KEY_MARKER) !== 1 ||
      occurrences(rewritten, FK_MARKER) !== 1 ||
      occurrences(rewritten, INDEX_MARKER) !== 2 ||
      [...rewritten.matchAll(indexExpression)].length !== 0 || keyQuery.test(rewritten)) {
    fail("PATCH_VERIFICATION_FAILED");
  }
  return { content: rewritten, applied: true };
}

export function ensurePinnedKitOrdinalityPatch(binaryPath, env = process.env) {
  const pkg = JSON.parse(readFileSync(join(dirname(binaryPath), "package.json"), "utf8"));
  if (pkg.version === RC && env.CI === "true" && env.GITHUB_ACTIONS === "true") {
    // Existing separate RC-only GitHub jobs remain valid. The release
    // candidate is never installed into the application manifest here.
    return "ci-only-rc-exempt";
  }
  if (pkg.version !== VERSION) fail("UNSUPPORTED_KIT_VERSION");
  const binary = readFileSync(binaryPath, "utf8");
  const { content, applied } = patchPinnedIntrospectionBinary(binary);
  if (!applied) return "previously-patched";
  const tmp = binaryPath + ".1019." + process.pid + ".tmp";
  try {
    // Atomically replace only the local npm-installed binary. Verify the staged
    // bytes before rename; never re-open a path after the rename (TOCTOU).
    writeFileSync(tmp, content, { flag: "wx", mode: 0o600 });
    if (readFileSync(tmp, "utf8") !== content) fail("STAGED_WRITE_VERIFY_FAILED");
    renameSync(tmp, binaryPath);
  } finally {
    try { unlinkSync(tmp); } catch { /* successful rename or missing temp */ }
  }
  return "patched-pinned-kit";
}
