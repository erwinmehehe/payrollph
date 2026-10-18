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
  return o.kind === "column" ? `column:${o.table}.${o.name}` : `${o.kind}:${o.name}`;
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
  return { files, scanned: objects.length, missing };
}
