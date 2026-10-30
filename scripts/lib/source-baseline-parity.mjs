import { canonicalSourceBaselineExpression } from "./source-baseline-sql-expression.mjs";

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
  const type = v.trim().replace(/\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g, "($1,$2)")
    .replace(/\s*\(\s*(\d+)\s*\)/g, "($1)");
  if (/^serial$/i.test(type)) return "integer";
  if (/^bigserial$/i.test(type)) return "bigint";
  if (/^smallserial$/i.test(type)) return "smallint";
  if (/^int2$/i.test(type)) return "smallint";
  if (/^int4$/i.test(type)) return "integer";
  if (/^int8$/i.test(type)) return "bigint";
  if (/^bool$/i.test(type)) return "boolean";
  if (/^varchar(?:\(\d+\))?$/i.test(type)) return type.replace(/^varchar/i, "character varying");
  const withZone = /^timestamptz(?:\((\d+)\))?$/i.exec(type);
  if (withZone) return "timestamp" + (withZone[1] ? "(" + withZone[1] + ")" : "") + " with time zone";
  const withoutZone = /^timestamp(?:\((\d+)\))?$/i.exec(type);
  if (withoutZone) return "timestamp" + (withoutZone[1] ? "(" + withoutZone[1] + ")" : "") + " without time zone";
  if (/^time$/i.test(type)) return "time without time zone";
  if (/^timetz$/i.test(type)) return "time with time zone";
  if (/^char(?:\(\d+\))?$/i.test(type)) return type.replace(/^char/i, "character");
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
  // The PG jsonb deparser sorts object keys and changes JSON whitespace.
  // Compare parsed JSON values, never the spelling/order of object keys.
  if (type === "jsonb") {
    const json = /^'((?:[^']|'')*)'::jsonb$/.exec(value);
    if (json) {
      const stable = (item) => Array.isArray(item) ? item.map(stable) :
        item !== null && typeof item === "object" ?
          Object.fromEntries(Object.entries(item).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : item;
      try { return "jsonb:" + JSON.stringify(stable(JSON.parse(json[1].replaceAll("''", "'")))); }
      catch { return value; } // malformed default never passes by guessing
    }
  }
  const literal = /^'(?:[^']|'')*'$/;
  if (/^character varying(?:\(\d+\))?$/.test(type)) {
    const bare = value.endsWith("::character varying")
      ? value.slice(0, -"::character varying".length) : value;
    if (literal.test(bare)) return bare + "::character varying";
  }
  if (/^numeric(?:\(\d+,\d+\))?$/.test(type)) {
    const bare = value.endsWith("::numeric")
      ? value.slice(0, -"::numeric".length) : value;
    const numeric = bare.startsWith("'") && bare.endsWith("'")
      ? bare.slice(1, -1) : bare;
    if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numeric)) {
      // PostgreSQL emits both '60.00'::numeric and 60.00 for numeric defaults.
      // Compare the exact finite decimal value without JS floating-point loss.
      const sign = numeric.startsWith("-") ? "-" : "";
      const pieces = numeric.replace(/^[-+]/, "").split(".");
      const whole = (pieces[0] || "0").replace(/^0+(?=\d)/, "");
      const fraction = (pieces[1] || "").replace(/0+$/, "");
      const positive = whole + (fraction ? "." + fraction : "");
      return "numeric:" + (positive === "0" ? "" : sign) + positive;
    }
  }
  // PostgreSQL's deparser appends the *column's own* type to bare string
  // literals. Accept only identical values and a matching built-in cast.
  // This never erases a different literal or an unrelated ::text cast.
  const typedLiterals = {
    text: ["text"],
    uuid: ["uuid"],
    date: ["date"],
    "time without time zone": ["time without time zone"],
    "time with time zone": ["time with time zone"],
    "timestamp without time zone": ["timestamp without time zone"],
    "timestamp with time zone": ["timestamp with time zone"],
  };
  const castType = type.replace(/\(\d+\)/, "");
  for (const cast of typedLiterals[castType] ?? []) {
    const suffix = "::" + cast;
    const bare = value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
    if (literal.test(bare)) return bare + suffix;
  }
  return value;
}

function sourceBaselineIndexKey(key, columnTypes, table, indexOrder) {
  if (typeof key !== "string" || !key.length || key.includes("\0")) {
    throw new Error("SOURCE_BASELINE_INVALID_INDEX_KEY");
  }
  // Identifier parsing is exact: quoted table/column names are decoded, not
  // lowercased. PostgreSQL default ordering is ASC NULLS LAST or DESC NULLS
  // FIRST; compare effective B-tree order, not optional spelling of defaults.
  let column, trailing = "";
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
  const modifiers = sourceBaselineSQL(trailing) ?? "";
  const declaredDesc = /(?:^|\s)desc(?:\s|$)/.test(modifiers);
  const declaredFirst = /(?:^|\s)nulls first(?:\s|$)/.test(modifiers);
  const desc = indexOrder?.desc ?? declaredDesc;
  // Drizzle's source index-column builder uses NULLS LAST unless the
  // declaration explicitly calls nullsFirst(), including with desc().
  // PostgreSQL's actual indoption flags always win on the catalog side.
  const nullsFirst = indexOrder?.nullsFirst ?? declaredFirst;
  if (column !== undefined) {
    // Preserve any operator class rather than dropping it along with sort
    // modifiers. No identifier case folding or normalization occurs.
    const opclass = modifiers.replace(/(?:^|\s)(?:asc|desc)(?=\s|$)/g, " ")
      .replace(/(?:^|\s)nulls (?:first|last)(?=\s|$)/g, " ").trim();
    return { column, opclass, desc, nullsFirst };
  }
  return { expression: canonicalSourceBaselineExpression(key, table, columnTypes),
    desc, nullsFirst };
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
      return { expression: canonicalSourceBaselineExpression(x.expression, table, columnTypes),
        validated: x.validated !== false };
    case "index":
      if (typeof x.unique !== "boolean" || typeof x.method !== "string") {
        throw new Error("SOURCE_BASELINE_INVALID_INDEX_METADATA");
      }
      return { unique: x.unique, method: x.method.toLowerCase(),
        keys: names(x.keys).map((key, i) => sourceBaselineIndexKey(key, columnTypes, table,
          Array.isArray(x.key_desc) && Array.isArray(x.key_nulls_first)
            ? { desc: x.key_desc[i], nullsFirst: x.key_nulls_first[i] } : undefined)),
        include: names(x.include ?? x.included_columns ?? [])
          .map((key) => sourceBaselineIndexKey(key, columnTypes, table)),
        options: names(x.options ?? x.storage_options ?? []).sort(),
        nullsNotDistinct: !!(x.nullsNotDistinct ?? x.nulls_not_distinct),
        tablespace: x.tablespace ?? null,
        predicate: x.predicate == null ? null :
          canonicalSourceBaselineExpression(x.predicate, table, columnTypes),
        valid: x.valid !== false,
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
