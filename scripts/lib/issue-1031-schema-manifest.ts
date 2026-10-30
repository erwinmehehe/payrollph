import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { is, SQL, getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../src/db/schema";
import type { SchemaManifest, SchemaTable } from "../../src/lib/issue-1031-full-schema-diff";

/**
 * AST locates EVERY exported pgTable call. Drizzle's own runtime metadata then
 * resolves types, FKs, composite definitions and SQL expressions. Regex is
 * deliberately never used to discover tables or parse table declarations.
 */
const dialect = new PgDialect();

function sqlText(value: SQL): string {
  const rendered = dialect.sqlToQuery(value.inlineParams());
  if (rendered.params.length) throw new Error("Unresolved SQL parameters in schema declaration");
  return rendered.sql;
}

function defaultValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (is(value, SQL)) return sqlText(value);
  if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return "'" + value.toISOString() + "'";
  if (typeof value === "object") return "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  throw new Error("Unsupported column SQL default encountered");
}

function astDeclarations(sourceText: string): Map<string, string> {
  const file = ts.createSourceFile("src/db/schema.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0) throw new Error("Cannot parse Drizzle source with TypeScript AST");
  const declarations = new Map<string, string>();
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "pgTable") {
      const first = node.initializer.arguments[0];
      if (!first || !ts.isStringLiteral(first)) throw new Error("Nonliteral pgTable name: " + node.name.text);
      if (declarations.has(first.text)) throw new Error("Duplicate pgTable name " + first.text);
      declarations.set(first.text, node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (declarations.size === 0) throw new Error("Zero pgTable nodes discovered");
  return declarations;
}

/**
 * PostgreSQL stores identifier names in NAMEDATALEN=64, at most 63 UTF-8
 * bytes. Preserve code point boundaries; collision detection is performed
 * after truncation by named(). Never silently equate differently named FKs.
 */
export function postgresIdentifier(name: string): string {
  let result = "", bytes = 0;
  for (const char of name) {
    const width = Buffer.byteLength(char, "utf8");
    if (bytes + width > 63) break;
    result += char;
    bytes += width;
  }
  return result;
}

function named<T extends { name: string }>(items: T[]): T[] {
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.name === items[i - 1]!.name) {
      throw new Error("Duplicate schema object name: " + items[i]!.name);
    }
  }
  return items;
}

export function generateSchemaManifest(): SchemaManifest {
  const source = readFileSync(resolve(process.cwd(), "src/db/schema.ts"), "utf8");
  const declarations = astDeclarations(source);
  const runtime = schema as Record<string, unknown>;
  const tables: SchemaTable[] = [];

  for (const [name, symbol] of declarations) {
    const model = runtime[symbol];
    if (!model) throw new Error("AST pgTable export not found: " + symbol);
    const config = getTableConfig(model as Parameters<typeof getTableConfig>[0]);
    if (config.name !== name || (config.schema && config.schema !== "public")) {
      throw new Error("AST/Drizzle table name or schema mismatch: " + name);
    }
    const columns = named(config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      nullable: !column.notNull,
      default: column.getSQLType().toLowerCase() === "serial" ? "__serial__" : defaultValue(column.default),
      identity: column.generatedIdentity?.type ?? null,
    })));

    const foreignKeys = named(config.foreignKeys.map((fk) => {
      const reference = fk.reference();
      return {
        name: postgresIdentifier(fk.getName()),
        columns: reference.columns.map((c) => c.name),
        refTable: getTableName(reference.foreignTable),
        refColumns: reference.foreignColumns.map((c) => c.name),
        onDelete: fk.onDelete ?? "no action",
        onUpdate: fk.onUpdate ?? "no action",
      };
    }));

    const indexes = named(config.indexes.map((index) => {
      const c = index.config;
      if (!c.name) throw new Error("Unnamed index on " + name + "; cannot compare catalog by name");
      // Retain optional definition fields too: otherwise an INCLUDE or
      // storage-option drift could evade the source/index ratchet.
      const extended = c as typeof c & {
        include?: { name: string }[];
        with?: Record<string, string | number | boolean>;
        nullsNotDistinct?: boolean;
      };
      return {
        name: c.name,
        unique: c.unique,
        method: c.method ?? "btree",
        include: (extended.include ?? []).map((col) => col.name),
        options: Object.entries(extended.with ?? {})
          .map(([key, value]) => key + "=" + String(value)).sort(),
        nullsNotDistinct: extended.nullsNotDistinct ?? false,
        keys: c.columns.map((col) => {
          if (is(col, SQL)) return sqlText(col);
          const indexed = col as { name?: string; indexConfig?: { opClass?: string; order?: string; nulls?: string } };
          if (!indexed.name) throw new Error("Unnamed column in index " + c.name);
          const settings = indexed.indexConfig;
          return indexed.name
            + (settings?.opClass ? " " + settings.opClass : "")
            + (settings?.order === "desc" ? " DESC" : "")
            + (settings?.nulls === "first" ? " NULLS FIRST" : "");
        }),
        predicate: c.where ? sqlText(c.where) : null,
      };
    }));

    const checks = named(config.checks.map((check) => ({
      name: check.name, expression: sqlText(check.value),
    })));

    const primaryKeys = config.primaryKeys.map((pk) => ({
      name: pk.getName(), columns: pk.columns.map((c) => c.name),
    }));
    const inlinePrimaryKeys = config.columns.filter((c) => c.primary).map((c) => c.name);
    if (inlinePrimaryKeys.length && primaryKeys.length) {
      throw new Error("Ambiguous inline and table-level primary key " + name);
    }
    if (inlinePrimaryKeys.length) primaryKeys.push({ name: name + "_pkey", columns: inlinePrimaryKeys });

    const uniqueConstraints = named([
      ...config.uniqueConstraints.map((c) => ({
        name: c.getName() ?? name + "_" + c.columns.map((col) => col.name).join("_") + "_unique", columns: c.columns.map((col) => col.name), nullsNotDistinct: c.nullsNotDistinct,
      })),
      ...config.columns.filter((c) => c.isUnique).map((c) => ({
        name: c.uniqueName ?? name + "_" + c.name + "_unique", columns: [c.name], nullsNotDistinct: c.uniqueType === "not distinct",
      })),
    ]);
    tables.push({ name, columns, foreignKeys, indexes, checks,
      primaryKeys: named(primaryKeys), uniqueConstraints });
  }

  if (tables.length !== declarations.size || tables.length < 270) {
    throw new Error("Incomplete schema AST inventory: expected at least the 270 reviewed tables");
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return {
    formatVersion: 1,
    evidenceScope: "CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL",
    source: "src/db/schema.ts",
    tables,
  };
}
