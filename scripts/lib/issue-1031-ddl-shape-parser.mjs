/**
 * Catalog-only parser for static numbered PostgreSQL source, never executes SQL.
 * Deliberately refuses dynamic/procedural or unsupported structural DDL.
 * This module does not assert any SQL has been applied to any database.
 */
export const SOURCE_EVIDENCE_TAG = "CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL";

export function sqlTokens(sql) {
  const out = [];
  let i = 0;
  while (i < sql.length) {
    const start = i, c = sql[i], next = sql[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && next === "-") {
      i += 2; while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; }
        else i++;
      }
      if (depth) throw Error("UNCLOSED_BLOCK_COMMENT");
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c; i++; let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) throw Error("UNCLOSED_QUOTE");
      out.push({ kind: quote === "'" ? "string" : "ident", raw: sql.slice(start, i), offset: start });
      continue;
    }
    if (c === "$") {
      const m = /^\$[a-zA-Z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        const d = m[0], end = sql.indexOf(d, i + d.length);
        if (end === -1) throw Error("UNTERMINATED_DOLLAR_BODY");
        i = end + d.length;
        out.push({ kind: "dollar", raw: sql.slice(start, i), offset: start });
        continue;
      }
    }
    if (/[a-zA-Z_]/.test(c)) {
      i++; while (i < sql.length && /[a-zA-Z_0-9$]/.test(sql[i])) i++;
      out.push({ kind: "word", raw: sql.slice(start, i), offset: start });
      continue;
    }
    if (/[0-9]/.test(c)) {
      i++; while (i < sql.length && /[0-9.]/.test(sql[i])) i++;
      out.push({ kind: "number", raw: sql.slice(start, i), offset: start });
      continue;
    }
    i++;
    out.push({ kind: "symbol", raw: c, offset: start });
  }
  return out;
}
const word = (t, n) => t?.kind === "word" && t.raw.toUpperCase() === n;
const words = ts => ts.map(t => t.raw.toUpperCase());
const name = t => t?.kind === "ident" ? t.raw.slice(1, -1).replaceAll('""', '"') : t?.kind === "word" ? t.raw.toLowerCase() : null;
function readName(ts, i) {
  let a = name(ts[i]); if (!a) return null;
  let j = i + 1;
  while (ts[j]?.raw === "." && name(ts[j + 1])) { a = name(ts[j + 1]); j += 2; }
  return { value: a, next: j };
}
const optional = (ts, i) => {
  if (word(ts[i], "IF")) {
    i++; if (word(ts[i], "NOT")) i++;
    if (!word(ts[i], "EXISTS")) throw Error("UNSUPPORTED_IF_CLAUSE");
    i++;
  }
  return i;
};
function matching(ts, start) {
  if (ts[start]?.raw !== "(") throw Error("EXPECTED_OPEN_PAREN");
  let depth = 0;
  for (let i = start; i < ts.length; i++) {
    if (ts[i].raw === "(") depth++;
    if (ts[i].raw === ")" && --depth === 0) return i;
  }
  throw Error("UNMATCHED_PAREN");
}
function items(ts) {
  const result = [], array = []; let depth = 0;
  for (const t of ts) {
    if (t.raw === "(") depth++;
    if (t.raw === ")") depth--;
    if (depth < 0) throw Error("NEGATIVE_PAREN_DEPTH");
    if (t.raw === "," && !depth) { result.push(array.splice(0)); continue; }
    array.push(t);
  }
  if (depth !== 0) throw Error("UNBALANCED_LIST");
  if (array.length) result.push(array);
  return result;
}
function expr(ts) {
  return ts.map(t => t.kind === "word" ? t.raw.toLowerCase() : t.raw).join(" ")
    .replace(/\s+([(),.;])/g, "$1").replace(/([(.])\s+/g, "$1")
    .replace(/\s+::\s+/g, "::").replace(/\s*:\s*:\s*/g, "::")
    .replace(/\s+/g, " ").trim();
}
function type(ts) {
  return expr(ts).replace(/\bvarchar\b/gi, "character varying")
    .replace(/\btimestamptz\b/gi, "timestamp with time zone")
    .replace(/\bint4\b/gi, "integer")
    .replace(/\bint8\b/gi, "bigint")
    .replace(/\bbool\b/gi, "boolean")
    .replace(/\bnumeric\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi, "numeric($1,$2)")
    .replace(/\bserial\b/gi, "serial");
}
function keyColumns(ts, i) {
  const end = matching(ts, i);
  const cols = items(ts.slice(i + 1, end)).map(seg => readName(seg, 0)?.value);
  if (cols.some(x => !x)) throw Error("UNSUPPORTED_CONSTRAINT_KEY");
  return { columns: cols, next: end + 1 };
}
function action(ts, i) {
  if (word(ts[i], "SET") && word(ts[i + 1], "NULL")) return { value: "set null", next: i + 2 };
  if (word(ts[i], "SET") && word(ts[i + 1], "DEFAULT")) return { value: "set default", next: i + 2 };
  if (word(ts[i], "NO") && word(ts[i + 1], "ACTION")) return { value: "no action", next: i + 2 };
  if (word(ts[i], "CASCADE") || word(ts[i], "RESTRICT")) return { value: ts[i].raw.toLowerCase(), next: i + 1 };
  throw Error("UNKNOWN_FK_ACTION");
}
function reference(ts, start, columns) {
  const target = readName(ts, start + 1); if (!target) throw Error("UNKNOWN_REFERENCED_TABLE");
  const k = keyColumns(ts, target.next);
  const fk = { columns, refTable: target.value, refColumns: k.columns, onDelete: "no action", onUpdate: "no action" };
  let i = k.next;
  while (i < ts.length) {
    if (word(ts[i], "ON") && word(ts[i + 1], "DELETE")) {
      const a = action(ts, i + 2); fk.onDelete = a.value; i = a.next; continue;
    }
    if (word(ts[i], "ON") && word(ts[i + 1], "UPDATE")) {
      const a = action(ts, i + 2); fk.onUpdate = a.value; i = a.next; continue;
    }
    if (word(ts[i], "DEFERRABLE") || word(ts[i], "MATCH") ||
        word(ts[i], "INITIALLY") ||
        (word(ts[i], "NOT") && (word(ts[i + 1], "DEFERRABLE") ||
                              word(ts[i + 1], "VALID"))) ||
        word(ts[i], "VALID"))
      throw Error("UNSUPPORTED_FK_MODIFIER");
    i++;
  }
  return fk;
}
const CLAUSES = new Set(["NOT","NULL","DEFAULT","PRIMARY","UNIQUE","REFERENCES","CHECK",
  "CONSTRAINT","GENERATED","COLLATE"]);
function checkIn(segment, i) {
  if (segment[i + 1]?.raw !== "(") throw Error("UNSUPPORTED_CHECK_EXPRESSION");
  const end = matching(segment, i + 1);
  return { expression: expr(segment.slice(i + 2, end)), next: end + 1 };
}
function columnDef(segment, table, result) {
  const col = name(segment[0]); if (!col) throw Error("COLUMN_NAME_NOT_IDENTIFIER");
  let i = 1; while (i < segment.length && !CLAUSES.has(segment[i].raw.toUpperCase())) i++;
  if (i === 1) throw Error("MISSING_SQL_COLUMN_TYPE");
  const sqlType = type(segment.slice(1, i));
  let pendingConstraintName = null;
  const c = { name: col, type: sqlType, nullable: true, default: sqlType === "serial" ? "__serial__" : null, identity: null };
  for (; i < segment.length; ) {
    if (word(segment[i], "NOT") && word(segment[i + 1], "NULL")) { c.nullable = false; i += 2; continue; }
    if (word(segment[i], "NULL")) { c.nullable = true; i++; continue; }
    if (word(segment[i], "PRIMARY") && word(segment[i + 1], "KEY")) {
      c.nullable = false; result.primary.push([col]); i += 2; continue;
    }
    if (word(segment[i], "UNIQUE")) {
      result.unique.push([col]); i++; continue;
    }
    if (word(segment[i], "REFERENCES")) {
      result.foreignKeys.push(reference(segment, i, [col]));
      const at = segment.findIndex((t, j) => j > i && (word(t, "CHECK") || word(t, "CONSTRAINT")));
      i = at >= 0 ? at : segment.length; continue;
    }
    if (word(segment[i], "DEFAULT")) {
      const from = ++i; let depth = 0;
      while (i < segment.length) {
        if (segment[i].raw === "(") depth++;
        if (segment[i].raw === ")") depth--;
        if (!depth && i > from && CLAUSES.has(segment[i].raw.toUpperCase())) break;
        i++;
      }
      if (i === from) throw Error("EMPTY_DEFAULT");
      c.default = expr(segment.slice(from, i)); continue;
    }
    if (word(segment[i], "CHECK")) {
      const item = checkIn(segment, i);
      result.checks.push(item.expression);
      result.checkNames.push(pendingConstraintName);
      pendingConstraintName = null;
      i = item.next; continue;
    }
    if (word(segment[i], "CONSTRAINT")) {
      if (!name(segment[i + 1])) throw Error("BAD_COLUMN_CONSTRAINT");
      pendingConstraintName = name(segment[i + 1]);
      i += 2; continue;
    }
    if (word(segment[i], "GENERATED") || word(segment[i], "COLLATE"))
      throw Error("UNSUPPORTED_COLUMN_GENERATION_OR_COLLATION");
    throw Error("UNKNOWN_COLUMN_CLAUSE_" + segment[i].raw);
  }
  result.columns.push(c);
}
function createTable(ts) {
  let i = 1;
  while (word(ts[i], "TEMP") || word(ts[i], "TEMPORARY") ||
         word(ts[i], "UNLOGGED")) i++;
  if (!word(ts[i], "TABLE")) return null;
  const obj = readName(ts, optional(ts, i + 1)); if (!obj) throw Error("CREATE_TABLE_NO_NAME");
  const out = { table: obj.value, columns: [], primary: [], unique: [], foreignKeys: [], checks: [], checkNames: [], indexes: [], rls: [], notes: [] };
  const open = obj.next; const close = matching(ts, open);
  for (const segment of items(ts.slice(open + 1, close))) {
    let j = 0, constraintName = null;
    if (word(segment[j], "CONSTRAINT")) {
      if (!name(segment[j + 1])) throw Error("INVALID_NAMED_CONSTRAINT");
      constraintName = name(segment[j + 1]);
      j += 2;
    }
    if (word(segment[j], "PRIMARY") && word(segment[j + 1], "KEY")) {
      out.primary.push(keyColumns(segment, j + 2).columns);
    } else if (word(segment[j], "UNIQUE")) {
      if (word(segment[j + 1], "NULLS")) throw Error("UNSUPPORTED_NULLS_DISTINCT");
      out.unique.push(keyColumns(segment, j + 1).columns);
    } else if (word(segment[j], "FOREIGN") && word(segment[j + 1], "KEY")) {
      const keys = keyColumns(segment, j + 2);
      if (!word(segment[keys.next], "REFERENCES")) throw Error("MISSING_FK_REFERENCES");
      out.foreignKeys.push(reference(segment, keys.next, keys.columns));
    } else if (word(segment[j], "CHECK")) {
      const ck = checkIn(segment, j);
      out.checks.push(ck.expression);
      out.checkNames.push(constraintName);
    } else {
      columnDef(segment, out.table, out);
    }
  }
  if (close !== ts.length - 1) throw Error("UNSUPPORTED_CREATE_TABLE_TRAILER");
  return out;
}
function createIndex(ts) {
  let i = 1, unique = false;
  if (word(ts[i], "UNIQUE")) { unique = true; i++; }
  if (!word(ts[i], "INDEX")) return null;
  i++; if (word(ts[i], "CONCURRENTLY")) i++;
  i = optional(ts, i);
  const index = readName(ts, i);
  if (!index || !word(ts[index.next], "ON")) throw Error("MALFORMED_CREATE_INDEX");
  i = index.next + 1;
  if (word(ts[i], "ONLY")) i++;
  const table = readName(ts, i); if (!table) throw Error("MALFORMED_INDEX_TABLE");
  i = table.next; let method = "btree";
  if (word(ts[i], "USING")) { method = name(ts[i + 1]); i += 2; }
  const close = matching(ts, i);
  const keys = items(ts.slice(i + 1, close)).map(seg => {
    if (!seg.length) throw Error("EMPTY_INDEX_KEY");
    // Preserve ordered index keys, expressions and NULLS FIRST/LAST verbatim.
    const k = expr(seg);
    return k;
  });
  i = close + 1; let predicate = null;
  if (word(ts[i], "WHERE")) { predicate = expr(ts.slice(i + 1)); i = ts.length; }
  if (i !== ts.length) throw Error("UNSUPPORTED_INDEX_CLAUSE");
  return { table: table.value, index: { name: index.value, unique, method, keys, predicate } };
}
export function structuralStatements(sql) {
  const ts = sqlTokens(sql), result = [], errors = []; let current = [];
  for (const tok of ts) {
    if (tok.raw === ";" && tok.kind === "symbol") {
      if (current.length) result.push(current);
      current = [];
    } else current.push(tok);
  }
  if (current.length) result.push(current);
  return result.map((s, i) => {
    const head = s[0]?.raw.toUpperCase();
    try {
      if (word(s[0], "CREATE")) {
        // A CREATE OR REPLACE FUNCTION, RULE or TRIGGER can affect a table
        // indirectly; never mistake it for a proven static table shape.
        if (word(s[1], "OR") && word(s[2], "REPLACE"))
          return { kind: "other", raw: expr(s), statement: i + 1 };
        const table = createTable(s);
        if (table) return { kind: "table", value: table, statement: i + 1 };
        const index = createIndex(s);
        if (index) return { kind: "index", value: index, statement: i + 1 };
        if (words(s).includes("POLICY")) return { kind: "policy", raw: expr(s), statement: i + 1 };
        return { kind: "other", raw: expr(s), statement: i + 1 };
      }
      if (word(s[0], "ALTER") && word(s[1], "TABLE")) {
        const obj = readName(s, optional(s, 2));
        return { kind: "alter", table: obj?.value, raw: expr(s), statement: i + 1 };
      }
      if (word(s[0], "DROP") && word(s[1], "TABLE")) {
        const obj = readName(s, optional(s, 2));
        return { kind: "drop", table: obj?.value, raw: expr(s), statement: i + 1 };
      }
      if (word(s[0], "DROP") && word(s[1], "INDEX")) {
        const obj = readName(s, optional(s, word(s[2], "CONCURRENTLY") ? 3 : 2));
        return { kind: "drop_index", index: obj?.value, raw: expr(s), statement: i + 1 };
      }
      if (word(s[0], "ALTER") && word(s[1], "INDEX")) {
        const obj = readName(s, optional(s, 2));
        return { kind: "alter_index", index: obj?.value, raw: expr(s), statement: i + 1 };
      }
      if (word(s[0], "DO") || word(s[0], "EXECUTE")) return { kind: "procedural", raw: expr(s), statement: i + 1 };
      if (word(s[0], "COMMENT") || word(s[0], "GRANT") || word(s[0], "REVOKE") ||
          word(s[0], "INSERT") || word(s[0], "UPDATE") || word(s[0], "DELETE") ||
          word(s[0], "SELECT") || word(s[0], "SET")) return { kind: "nonstructural", raw: expr(s), statement: i + 1 };
      return { kind: "unknown", raw: expr(s), statement: i + 1 };
    } catch (error) {
      return { kind: "unparseable", head, reason: String(error?.message ?? error), raw: expr(s), statement: i + 1 };
    }
  });
}
