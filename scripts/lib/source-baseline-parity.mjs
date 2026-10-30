/**
 * Source -> isolated clean-baseline table/column coverage ratchet.
 * A separate additive type/constraint/index assertion follows below.
 * The presence-only function does not certify type/constraint parity, migration receipts,
 * production schema, or an applied migration.
 */
function checkedName(name, label) {
  // Identifiers here are *data*, never interpolated into SQL. PostgreSQL
  // permits quoted identifiers (mixed case, spaces, dots, dollar signs,
  // Unicode, etc.). The former snake_case regex rejected valid source
  // columns before performing any parity comparison. Retain exact spelling:
  // never normalize/case-fold a name or silently omit it.
  if (typeof name !== "string" || name.length === 0 || name.includes("\0")) {
    throw new Error("SOURCE_BASELINE_INVALID_" + label);
  }
  return name;
}

export function assertSourceBaselineParity(sourceTables, catalogRows) {
  if (!Array.isArray(sourceTables) || !Array.isArray(catalogRows) || sourceTables.length === 0) {
    throw new Error("SOURCE_BASELINE_INVALID_INPUT");
  }
  const expected = new Map();
  for (const table of sourceTables) {
    const name = checkedName(table?.name, "TABLE");
    if (expected.has(name) || !Array.isArray(table?.columns) || !table.columns.length) {
      throw new Error("SOURCE_BASELINE_DUPLICATE_OR_EMPTY_TABLE");
    }
    const columns = new Set();
    for (const column of table.columns) {
      const col = checkedName(column?.name, "COLUMN");
      if (columns.has(col)) throw new Error("SOURCE_BASELINE_DUPLICATE_SOURCE_COLUMN");
      columns.add(col);
    }
    expected.set(name, columns);
  }

  const actual = new Map();
  for (const row of catalogRows) {
    const table = checkedName(row?.table_name, "CATALOG_TABLE");
    const column = checkedName(row?.column_name, "CATALOG_COLUMN");
    if (!actual.has(table)) actual.set(table, new Set());
    if (actual.get(table).has(column)) throw new Error("SOURCE_BASELINE_DUPLICATE_CATALOG_COLUMN");
    actual.get(table).add(column);
  }

  const missingTables = [...expected.keys()].filter((name) => !actual.has(name)).sort();
  const missingColumns = [];
  const unmodeledColumns = [];
  let checkedColumns = 0;
  for (const [table, columns] of expected) {
    checkedColumns += columns.size;
    const present = actual.get(table) ?? new Set();
    for (const column of columns) if (!present.has(column)) missingColumns.push(table + "." + column);
    for (const column of present) if (!columns.has(column)) unmodeledColumns.push(table + "." + column);
  }
  missingColumns.sort();
  unmodeledColumns.sort();
  if (missingTables.length || missingColumns.length) {
    throw new Error("SOURCE_BASELINE_MISSING " + JSON.stringify({ missingTables, missingColumns }));
  }
  return {
    sourceTables: expected.size,
    sourceColumns: checkedColumns,
    migrationOrBaselineOnlyTables: [...actual.keys()].filter((name) => !expected.has(name)).sort(),
    unmodeledColumns,
    productionCertified: false,
  };
}

/**
 * Additive structural parity check for a clean, disposable PG18 catalog.
 * Preserve the original table/column-presence ratchet above. Only explicit
 * SQL type aliases and proven deparser forms are compared semantically;
 * physical table/column/constraint/index identifiers are NEVER normalized.
 * Extra migration-created objects are reported, not promoted to source evidence.
 * No migration receipts, production database, or actual Neon instance are certified.
 */
function sourceBaselineType(v) {
  if (typeof v !== "string" || v.length === 0) throw new Error("SOURCE_BASELINE_INVALID_TYPE");
  let type = v.trim().replace(/\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g, "($1,$2)")
    .replace(/\s*\(\s*(\d+)\s*\)/g, "($1)");
  if (/^serial$/i.test(type)) return "integer";
  if (/^bigserial$/i.test(type)) return "bigint";
  if (/^smallserial$/i.test(type)) return "smallint";
  if (/^int2$/i.test(type)) return "smallint";
  if (/^int4$/i.test(type)) return "integer";
  if (/^int8$/i.test(type)) return "bigint";
  if (/^bool$/i.test(type)) return "boolean";
  if (/^varchar(?:\(\d+\))?$/i.test(type)) return type.replace(/^varchar/i, "character varying");
  if (/^timestamptz(?:\(\d+\))?$/i.test(type)) return type.replace(/^timestamptz/i, "timestamp with time zone");
  if (/^timestamp(?:\(\d+\))?$/i.test(type)) return type.replace(/^timestamp/i, "timestamp without time zone");
  if (/^timestamp(?:\(\d+\))? with time zone$/i.test(type)) return type.toLowerCase();
  if (/^timestamp(?:\(\d+\))? without time zone$/i.test(type)) return type.toLowerCase();
  if (/^(?:numeric|decimal)(?:\(\d+,\d+\))?$/i.test(type)) return type.replace(/^decimal/i, "numeric").toLowerCase();
  return type; // Do not case-fold user-defined type identifiers.
}

function sourceBaselineSQL(value) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("SOURCE_BASELINE_INVALID_SQL");
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'") {
      out += ch;
      let closed = false;
      for (i++; i < value.length; i++) {
        out += value[i];
        if (value[i] === "'") {
          if (value[i + 1] === "'") { out += "'"; i++; continue; }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("SOURCE_BASELINE_INVALID_SQL_LITERAL");
      continue;
    }
    if (ch === '"') {
      let identifier = "";
      let closed = false;
      for (i++; i < value.length; i++) {
        if (value[i] === '"') {
          if (value[i + 1] === '"') { identifier += '"'; i++; continue; }
          closed = true;
          break;
        }
        identifier += value[i];
      }
      if (!closed) throw new Error("SOURCE_BASELINE_INVALID_SQL_IDENTIFIER");
      out += /^[a-z_][a-z0-9_]*$/.test(identifier)
        ? identifier : '"' + identifier.replaceAll('"', '""') + '"';
      continue;
    }
    if (/\s/.test(ch)) {
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    out += ch.toLowerCase();
  }
  return out.trim();
}

function sourceBaselineDefault(column, table, name) {
  if (column.default === "__serial__") return "serial:" + table + "_" + name + "_seq";
  const value = sourceBaselineSQL(column.default);
  const serial = value?.match(/^nextval\('((?:[^']|'')+)'::regclass\)$/);
  if (serial) {
    // regclass quotes physical mixed-case/dotted names INSIDE the string.
    // Strip only the explicit public schema and SQL identifier delimiters.
    let sequence = serial[1].replaceAll("''", "'");
    if (sequence.startsWith("public.")) sequence = sequence.slice(7);
    if (sequence.startsWith('"') && sequence.endsWith('"')) {
      sequence = sequence.slice(1, -1).replaceAll('""', '"');
    }
    return "serial:" + sequence;
  }
  if (value === null) return null;
  const type = sourceBaselineType(column.type);
  const literal = /^'(?:[^']|'')*'$/;
  if (/^character varying(?:\(\d+\))?$/.test(type)) {
    const bare = value.endsWith("::character varying")
      ? value.slice(0, -"::character varying".length) : value;
    if (literal.test(bare)) return bare + "::character varying";
  }
  if (/^numeric(?:\(\d+,\d+\))?$/.test(type)) {
    const bare = value.endsWith("::numeric") ? value.slice(0, -"::numeric".length) : value;
    if (/^'[-+]?(?:\d+(?:\.\d*)?|\.\d+)'$/.test(bare)) return bare + "::numeric";
  }
  return value;
}

function sourceBaselineCheck(expression, columnTypes, table) {
  const value = sourceBaselineSQL(expression);
  if (value === null) throw new Error("SOURCE_BASELINE_INVALID_CHECK");
  // Only recognize the proven PostgreSQL VARCHAR IN-list deparse form.
  // Do not simplify arbitrary expressions or case-fold quoted identifiers.
  const source = /^(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*) in \(([^()]*)\)$/.exec(value);
  const catalog = /^\(\(([a-z_][a-z0-9_]*)\)::text = any \(\(array\[([^\]]*)\]\)::text\[\]\)\)$/.exec(value);
  if (!source && !catalog) return value;
  if (source?.[1] && source[1] !== table) return value;
  const column = source ? source[2] : catalog[1];
  if (!/^character varying(?:\(\d+\))?$/.test(sourceBaselineType(columnTypes.get(column) ?? "unknown"))) return value;
  const values = (source ? source[3] : catalog[2]).split(",").map((s) => s.trim());
  if (values.length < 2) return value;
  const literals = values.map((v) => catalog && v.endsWith("::character varying")
    ? v.slice(0, -"::character varying".length) : v);
  if (literals.some((v, i) => !/^'(?:[^']|'')*'$/.test(v) ||
    (catalog && !values[i].endsWith("::character varying")))) return value;
  return "varchar-in:" + column + ":" + JSON.stringify(literals);
}

function sourceBaselineIndexKey(key, columnTypes) {
  if (typeof key !== "string" || !key.length || key.includes("\0")) {
    throw new Error("SOURCE_BASELINE_INVALID_INDEX_KEY");
  }
  // The manifest stores a bare column name, while pg_get_indexdef quotes
  // mixed-case, dotted, Unicode and space-containing physical names. Compare
  // exact decoded identifiers, not lowercased SQL tokens or guessed aliases.
  let column;
  let trailing = "";
  const quoted = /^"((?:[^"]|"")*)"(?=$|\s)(.*)$/.exec(key);
  if (quoted) {
    const physical = quoted[1].replaceAll('""', '"');
    if (columnTypes.has(physical)) {
      column = physical;
      trailing = quoted[2];
    }
  }
  if (column === undefined) {
    const found = [...columnTypes.keys()]
      .sort((a, b) => b.length - a.length)
      .find((name) => key === name || key.startsWith(name + " "));
    if (found !== undefined) {
      column = found;
      trailing = key.slice(found.length);
    }
  }
  if (column !== undefined) {
    return { column, modifiers: sourceBaselineSQL(trailing) };
  }
  return { expression: sourceBaselineSQL(key) };
}

function sourceBaselineSignature(kind, x, table, name, columnTypes) {
  const names = (value) => {
    if (!Array.isArray(value)) throw new Error("SOURCE_BASELINE_INVALID_OBJECT_COLUMNS");
    return value.map((v) => checkedName(v, "OBJECT_COLUMN"));
  };
  const action = (v) => {
    if (typeof v !== "string") throw new Error("SOURCE_BASELINE_INVALID_FK_ACTION");
    return v.toLowerCase().replaceAll("_", " ").trim();
  };
  switch (kind) {
    case "column": {
      if (typeof x.type !== "string" || typeof x.nullable !== "boolean") {
        throw new Error("SOURCE_BASELINE_INVALID_COLUMN_METADATA");
      }
      const identity = x.identity === "a" ? "always" :
        x.identity === "d" ? "byDefault" : x.identity ?? null;
      return { type: sourceBaselineType(x.type), nullable: x.nullable,
        default: sourceBaselineDefault(x, table, name), identity };
    }
    case "primary_key":
      return { columns: names(x.columns), validated: x.validated !== false };
    case "foreign_key":
      return { columns: names(x.columns), refTable: checkedName(x.refTable ?? x.ref_table, "REFERENCE_TABLE"),
        refColumns: names(x.refColumns ?? x.ref_columns),
        onDelete: action(x.onDelete ?? x.on_delete ?? "no action"),
        onUpdate: action(x.onUpdate ?? x.on_update ?? "no action"),
        validated: x.validated !== false };
    case "unique_constraint":
      return { columns: names(x.columns),
        nullsNotDistinct: !!(x.nullsNotDistinct ?? x.nulls_not_distinct),
        validated: x.validated !== false };
    case "check":
      return { expression: sourceBaselineCheck(x.expression, columnTypes, table),
        validated: x.validated !== false };
    case "index":
      if (typeof x.unique !== "boolean" || typeof x.method !== "string") {
        throw new Error("SOURCE_BASELINE_INVALID_INDEX_METADATA");
      }
      return { unique: x.unique, method: x.method.toLowerCase(),
        keys: names(x.keys).map((key) => sourceBaselineIndexKey(key, columnTypes)),
        include: names(x.include ?? x.included_columns ?? [])
          .map((key) => sourceBaselineIndexKey(key, columnTypes)),
        options: names(x.options ?? x.storage_options ?? []).sort(),
        nullsNotDistinct: !!(x.nullsNotDistinct ?? x.nulls_not_distinct),
        tablespace: x.tablespace ?? null,
        predicate: sourceBaselineSQL(x.predicate), valid: x.valid !== false,
        ready: x.ready !== false };
    default:
      throw new Error("SOURCE_BASELINE_INVALID_OBJECT_KIND");
  }
}

function assertSourceBaselineConstraintParity(sourceTables, catalogRows) {
  if (!Array.isArray(sourceTables) || sourceTables.length === 0 || !Array.isArray(catalogRows)) {
    throw new Error("SOURCE_BASELINE_INVALID_INPUT");
  }
  // Names are exact PostgreSQL catalog identifiers. No filtering, trimming,
  // snake-case validation, case folding, or name-based SQL reconstruction.
  const groups = [
    ["column", "columns", "Columns"],
    ["primary_key", "primaryKeys", "PrimaryKeys"],
    ["foreign_key", "foreignKeys", "ForeignKeys"],
    ["unique_constraint", "uniqueConstraints", "UniqueConstraints"],
    ["check", "checks", "Checks"],
    ["index", "indexes", "Indexes"],
  ];
  const expected = new Map();
  const expectedTables = new Set();
  const expectedColumnTypes = new Map();
  for (const table of sourceTables) {
    const tableName = checkedName(table?.name, "TABLE");
    if (expectedTables.has(tableName) || !Array.isArray(table?.columns) || !table.columns.length) {
      throw new Error("SOURCE_BASELINE_DUPLICATE_OR_EMPTY_TABLE");
    }
    expectedTables.add(tableName);
    const types = new Map();
    for (const column of table.columns) {
      const name = checkedName(column?.name, "COLUMN");
      if (types.has(name)) throw new Error("SOURCE_BASELINE_DUPLICATE_SOURCE_COLUMN");
      types.set(name, column.type);
    }
    expectedColumnTypes.set(tableName, types);
    for (const [kind, property] of groups) {
      const items = table[property];
      if (!Array.isArray(items)) throw new Error("SOURCE_BASELINE_INCOMPLETE_SOURCE_METADATA");
      for (const item of items) {
        const name = checkedName(item?.name, "OBJECT");
        const key = JSON.stringify([tableName, kind, name]);
        if (expected.has(key)) throw new Error("SOURCE_BASELINE_DUPLICATE_SOURCE_OBJECT");
        expected.set(key, { table: tableName, kind, name, details: item });
      }
    }
  }

  const actual = new Map();
  const actualTables = new Set();
  const observedColumnTypes = new Map();
  const supported = new Set(groups.map(([kind]) => kind));
  for (const row of catalogRows) {
    const table = checkedName(row?.table_name, "CATALOG_TABLE");
    const kind = row?.kind;
    if (!supported.has(kind)) throw new Error("SOURCE_BASELINE_INVALID_CATALOG_KIND");
    const name = checkedName(row?.object_name, "CATALOG_OBJECT");
    const key = JSON.stringify([table, kind, name]);
    if (actual.has(key)) throw new Error("SOURCE_BASELINE_DUPLICATE_CATALOG_OBJECT");
    actual.set(key, { table, kind, name, details: row });
    if (kind === "column") {
      actualTables.add(table);
      const types = observedColumnTypes.get(table) ?? new Map();
      types.set(name, row.type);
      observedColumnTypes.set(table, types);
    }
  }

  const report = {
    missingTables: [...expectedTables].filter((name) => !actualTables.has(name)).sort(),
    missingColumns: [], unmodeledColumns: [], driftedColumns: [],
    missingPrimaryKeys: [], unmodeledPrimaryKeys: [], driftedPrimaryKeys: [],
    missingForeignKeys: [], unmodeledForeignKeys: [], driftedForeignKeys: [],
    missingUniqueConstraints: [], unmodeledUniqueConstraints: [], driftedUniqueConstraints: [],
    missingChecks: [], unmodeledChecks: [], driftedChecks: [],
    missingIndexes: [], unmodeledIndexes: [], driftedIndexes: [],
  };
  const suffix = new Map(groups.map(([kind, , name]) => [kind, name]));
  const failFields = ["missingTables"];
  for (const [, , name] of groups) failFields.push("missing" + name, "drifted" + name);
  for (const [key, e] of expected) {
    const s = suffix.get(e.kind);
    const found = actual.get(key);
    if (!found) {
      report["missing" + s].push({ table: e.table, name: e.name });
      continue;
    }
    const expectedSignature = sourceBaselineSignature(e.kind, e.details, e.table, e.name,
      expectedColumnTypes.get(e.table));
    const actualSignature = sourceBaselineSignature(e.kind, found.details, e.table, e.name,
      observedColumnTypes.get(e.table));
    if (JSON.stringify(expectedSignature) !== JSON.stringify(actualSignature)) {
      report["drifted" + s].push({
        table: e.table, name: e.name, expected: expectedSignature, actual: actualSignature,
      });
    }
  }
  for (const [key, a] of actual) {
    if (!expected.has(key) && expectedTables.has(a.table)) {
      report["unmodeled" + suffix.get(a.kind)].push({ table: a.table, name: a.name });
    }
  }
  for (const [field, values] of Object.entries(report)) {
    if (field === "missingTables") continue;
    values.sort((a, b) =>
      a.table < b.table ? -1 : a.table > b.table ? 1 :
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  if (failFields.some((field) => report[field].length > 0)) {
    throw new Error("SOURCE_BASELINE_CONSTRAINT_DRIFT " + JSON.stringify(report));
  }
  return {
    sourceTables: expectedTables.size,
    sourceColumns: [...expected.values()].filter((item) => item.kind === "column").length,
    sourceConstraints: [...expected.values()].filter((item) =>
      !["column", "index"].includes(item.kind)).length,
    sourceIndexes: [...expected.values()].filter((item) => item.kind === "index").length,
    ...report,
    migrationOrBaselineOnlyTables: [...actualTables].filter((name) => !expectedTables.has(name)).sort(),
    scope: "disposable PG18 source-vs-catalog types, nullability, defaults, identity, named PK/FK/unique/check constraints and modeled indexes only; not applied migration, receipt, production, or Neon certification",
    productionCertified: false,
  };
}

export { assertSourceBaselineConstraintParity };
