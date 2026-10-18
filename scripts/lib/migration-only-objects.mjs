// Inventory of objects that numbered drizzle/ migrations create by name, checked
// against a live catalog. Used to prove a source-first baseline (schema.ts push +
// 0109 + docs/sql/source-baseline-supplement.sql) keeps migration-only protections.
// Heuristic static scan: names created inside EXECUTE/format() strings are not seen.
import { readdirSync, readFileSync } from "node:fs";

const id = "\"?([A-Za-z_][A-Za-z0-9_]*)\"?";
const qual = "(?:\"?public\"?\\.)?";
const CREATE = {
  function: new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${qual}${id}\\s*\\(`, "gi"),
  trigger: new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+${id}[\\s\\S]*?\\bON\\s+${qual}${id}`, "gi"),
  index: new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${id}\\s+ON\\s+(?:ONLY\\s+)?${qual}${id}`, "gi"),
  constraint: new RegExp(`(?:ADD\\s+)?CONSTRAINT\\s+${id}\\s+(CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)`, "gi"),
  policy: new RegExp(`CREATE\\s+POLICY\\s+${id}\\s+ON\\s+${qual}${id}`, "gi"),
  view: new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${qual}${id}`, "gi"),
  extension: new RegExp(`CREATE\\s+EXTENSION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${id}`, "gi"),
  rls: new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${qual}${id}\\s+(?:FORCE|ENABLE)\\s+ROW\\s+LEVEL\\s+SECURITY`, "gi"),
  column: new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${qual}${id}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${id}`, "gi"),
};
const DROP = {
  function: new RegExp(`DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${qual}${id}`, "gi"),
  trigger: new RegExp(`DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?${id}`, "gi"),
  index: new RegExp(`DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?${qual}${id}`, "gi"),
  constraint: new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${id}`, "gi"),
  policy: new RegExp(`DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?${id}`, "gi"),
  view: new RegExp(`DROP\\s+(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+EXISTS\\s+)?${qual}${id}`, "gi"),
  column: new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${id}`, "gi"),
};
const RENAMES = [
  new RegExp(`RENAME\\s+CONSTRAINT\\s+${id}\\s+TO\\s+${id}`, "gi"),
  new RegExp(`ALTER\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?${qual}${id}\\s+RENAME\\s+TO\\s+${id}`, "gi"),
];
const DROP_TABLE = new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${qual}${id}`, "gi");

const CATALOG = {
  function: "SELECT p.proname k FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'",
  trigger: "SELECT t.tgname k FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal",
  index: "SELECT indexname k FROM pg_indexes WHERE schemaname='public'",
  constraint: "SELECT k.conname k FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public'",
  policy: "SELECT policyname k FROM pg_policies WHERE schemaname='public'",
  view: "SELECT c.relname k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')",
  extension: "SELECT extname k FROM pg_extension",
  rls: "SELECT c.relname k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity",
  column: "SELECT c.relname||'.'||a.attname k FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped",
};

/** Objects created by numbered migrations, minus those a later migration drops or renames. */
export function migrationCreatedObjects(dir = "drizzle") {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const created = [];
  const removed = new Map();
  const renamed = new Map();
  const droppedTables = new Map();
  for (const file of files) {
    const sql = readFileSync(`${dir}/${file}`, "utf8").replace(/--[^\n]*/g, "");
    for (const [kind, re] of Object.entries(CREATE)) {
      for (const m of sql.matchAll(re)) {
        const lower = (s) => s.toLowerCase();
        if (kind === "trigger" || kind === "index" || kind === "policy") created.push({ kind, name: lower(m[1]), table: lower(m[2]), file });
        else if (kind === "rls") created.push({ kind, name: lower(m[1]), table: lower(m[1]), file });
        else if (kind === "column") created.push({ kind, name: lower(m[2]), table: lower(m[1]), file });
        else created.push({ kind, name: lower(m[1]), file });
      }
    }
    for (const [kind, re] of Object.entries(DROP)) for (const m of sql.matchAll(re)) removed.set(`${kind}:${m[1].toLowerCase()}`, file);
    for (const re of RENAMES) for (const m of sql.matchAll(re)) renamed.set(m[1].toLowerCase(), file);
    for (const m of sql.matchAll(DROP_TABLE)) droppedTables.set(m[1].toLowerCase(), file);
  }
  const seen = new Set();
  const objects = [];
  for (const o of created) {
    const key = objectKey(o);
    if (seen.has(key)) continue;
    seen.add(key);
    const later = (f) => f !== undefined && f > o.file;
    if (later(removed.get(`${o.kind}:${o.name}`)) || later(renamed.get(o.name)) || (o.table && later(droppedTables.get(o.table)))) continue;
    objects.push(o);
  }
  return { files: files.length, objects };
}

export function objectKey(o) {
  if (o.kind === "column") return `column:${o.table}.${o.name}`;
  if (o.kind === "column-check") return `column-check:${o.table}.${o.name}`;
  return `${o.kind}:${o.name}`;
}

// --- Unnamed column-level CHECK constraints -------------------------------
// "status varchar(16) NOT NULL CHECK (status IN (...))" has no name in the
// migration; PostgreSQL generates one. They are matched by meaning, not name.

function splitStatements(sql) {
  const out = []; let cur = ""; let i = 0;
  while (i < sql.length) {
    const ch = sql[i], two = sql.slice(i, i + 2);
    if (two === "--") { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j; continue; }
    if (two === "/*") { const j = sql.indexOf("*/", i + 2); i = j < 0 ? sql.length : j + 2; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue; } break; } j++; }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) { const j = sql.indexOf(m[0], i + m[0].length); const end = j < 0 ? sql.length : j + m[0].length; cur += sql.slice(i, end); i = end; continue; }
    }
    if (ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function topLevelParts(body) {
  const parts = []; let depth = 0, cur = "", quote = null;
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parenBody(s, open) {
  let depth = 0, quote = null;
  for (let k = open; k < s.length; k++) {
    const ch = s[k];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return s.slice(open + 1, k); }
  }
  return null;
}

/** Unnamed column CHECKs from CREATE TABLE and ALTER TABLE ... ADD COLUMN; latest per column. */
export function unnamedColumnChecks(dir = "drizzle") {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const latest = new Map();
  const record = (file, table, column, part) => {
    const at = part.search(/\bCHECK\s*\(/i);
    if (at < 0 || /CONSTRAINT\s+"?[a-z0-9_]+"?\s+CHECK/i.test(part)) return;
    const expr = parenBody(part, part.indexOf("(", at));
    if (expr) latest.set(`${table}.${column}`, { kind: "column-check", table, name: column, expr: expr.replace(/\s+/g, " ").trim(), file });
  };
  for (const file of files) {
    let text = readFileSync(`${dir}/${file}`, "utf8");
    // drizzle/0093 closes "DO $$" with "END $;"; keep the scan from swallowing the rest of the file.
    if (file.startsWith("0093_")) text = text.replace(/END \$;/, "END $$$$;");
    for (const s of splitStatements(text)) {
      const ct = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(/i.exec(s);
      if (ct) {
        const body = parenBody(s, s.indexOf("(", ct.index + ct[0].length - 1)) ?? "";
        for (const part of topLevelParts(body)) {
          if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)\b/i.test(part)) continue;
          const column = /^"?([a-z0-9_]+)"?\s/i.exec(part);
          if (column) record(file, ct[1].toLowerCase(), column[1].toLowerCase(), part);
        }
      }
      const at = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s+([\s\S]*)$/i.exec(s);
      if (at) {
        for (const part of topLevelParts(at[2])) {
          const column = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s/i.exec(part);
          if (column) record(file, at[1].toLowerCase(), column[1].toLowerCase(), part);
        }
      }
    }
  }
  return [...latest.values()];
}

const KEYWORDS = new Set(["and", "or", "not", "is", "null", "in", "between", "any", "array", "true", "false", "like",
  "text", "character", "varying", "integer", "numeric", "date", "jsonb_typeof", "length", "char_length", "btrim", "lower", "upper"]);

// Top-level AND conjuncts of a pg_get_constraintdef CHECK, so one combined
// CHECK (a > 0 AND b > 0) can satisfy two unnamed per-column CHECKs.
function conjuncts(def) {
  let body = def.replace(/^\s*CHECK\s*/i, "").trim();
  const unwrap = (s) => {
    while (s.startsWith("(") && parenBody(s, 0)?.length === s.length - 2) s = s.slice(1, -1).trim();
    return s;
  };
  body = unwrap(body);
  const out = []; let depth = 0, quote = null, start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /^\sAND\s/i.test(body.slice(i, i + 5))) { out.push(unwrap(body.slice(start, i).trim())); start = i + 5; i += 4; }
  }
  out.push(unwrap(body.slice(start).trim()));
  return out;
}

function checkSatisfied(check, defs, tableColumns) {
  const literals = [...check.expr.matchAll(/'([^']*)'/g)].map((m) => m[1].toLowerCase());
  const numbers = [...check.expr.replace(/'[^']*'/g, "").matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0]);
  return defs.flatMap((def) => [def, ...conjuncts(def)]).some((def) => {
    const lower = def.toLowerCase();
    const referenced = new Set([...lower.replace(/'[^']*'/g, "").matchAll(/[a-z_][a-z0-9_]*/g)]
      .map((m) => m[0]).filter((w) => !KEYWORDS.has(w) && tableColumns.has(w)));
    return referenced.size === 1 && referenced.has(check.name)
      && literals.every((l) => lower.includes("'" + l + "'"))
      && numbers.every((n) => new RegExp("\\b" + n.replace(".", "\\.") + "\\b").test(lower));
  });
}

/** Created objects (whose table exists in the catalog) that the connected database lacks. */
export async function missingMigrationObjects(client, dir = "drizzle") {
  const { files, objects } = migrationCreatedObjects(dir);
  const have = {};
  for (const [kind, sql] of Object.entries(CATALOG)) have[kind] = new Set((await client.query(sql)).rows.map((r) => r.k));
  const tables = new Set((await client.query("SELECT tablename k FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.k));
  const missing = objects.filter((o) => {
    if (o.table && !tables.has(o.table)) return false; // table is not part of the source schema
    return o.kind === "column" ? !have.column.has(`${o.table}.${o.name}`) : !have[o.kind].has(o.name);
  });
  const checks = unnamedColumnChecks(dir);
  const defsByTable = new Map();
  for (const row of (await client.query(`SELECT t.relname tbl, pg_catalog.pg_get_constraintdef(k.oid) def
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class t ON t.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND k.contype = 'c'`)).rows) {
    defsByTable.set(row.tbl, [...(defsByTable.get(row.tbl) ?? []), row.def]);
  }
  const columnsByTable = new Map();
  for (const key of have.column) {
    const [table, column] = key.split(".");
    columnsByTable.set(table, (columnsByTable.get(table) ?? new Set()).add(column));
  }
  for (const check of checks) {
    if (!tables.has(check.table) || !have.column.has(`${check.table}.${check.name}`)) continue;
    if (!checkSatisfied(check, defsByTable.get(check.table) ?? [], columnsByTable.get(check.table) ?? new Set())) missing.push(check);
  }
  return { files, scanned: objects.length + checks.length, missing };
}
