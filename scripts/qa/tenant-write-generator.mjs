/** Offline proposals only. No DB connection, route execution, or coverage credits. */
import ts from "typescript";
import { is, getTableColumns, getTableName } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

export const WRITE_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);

export function describeTables(schema) {
  return Object.fromEntries(Object.entries(schema).filter(([, table]) => is(table, PgTable)).map(([symbol, table]) => {
    const config = getTableConfig(table);
    const properties = new Map(Object.entries(getTableColumns(table)).map(([key, col]) => [col, key]));
    const names = new Map(Object.entries(getTableColumns(table)).map(([key, col]) => [col.name, key]));
    return [symbol, { symbol, name: config.name,
      columns: config.columns.map(col => ({ key: properties.get(col), name: col.name, type: col.dataType,
        sqlType: col.getSQLType(), required: col.notNull && !col.hasDefault && !col.generated && !col.generatedIdentity,
        generated: Boolean(col.generated || col.generatedIdentity || col.columnType.includes("Serial")),
        hasDefault: col.hasDefault, enumValues: col.enumValues ?? [], primary: col.primary,
        length: col.length ?? null })),
      foreignKeys: config.foreignKeys.map(fk => { const ref = fk.reference(); return {
        columns: ref.columns.map(c => names.get(c.name)), table: getTableName(ref.foreignTable),
        refColumns: ref.foreignColumns.map(c => c.name) }; }),
      checks: config.checks.map(c => c.name),
      uniqueConstraints: [...config.uniqueConstraints.map(c => c.columns.map(v => v.name)),
        ...config.columns.filter(c => c.isUnique).map(c => [c.name]),
        ...config.indexes.filter(i => i.config.unique).map(i => i.config.columns.map(c => c.name ?? "expression"))],
    }];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

const knownContext = {
  organizationId: "organizationId", employeeId: "employeeId", legalEntityId: "legalEntityId",
  orgUnitId: "orgUnitId", userId: "userId", actorUserId: "userId", createdByUserId: "userId",
};

export function fictionalValue(field, column = {}, context = {}) {
  if (Object.hasOwn(knownContext, field)) return context[knownContext[field]];
  if (field === "id") return context.rowId;
  // Never invent an existing foreign/business ID, bank identifier, token, or secret.
  if (/Ids?$/.test(field) || /password|token|secret|accountNumber|bankAccount/i.test(field)) return undefined;
  if (column.enumValues?.length) return column.enumValues[0];
  if (/email/i.test(field)) return (context.marker ?? "fictional") + "@example.invalid";
  if (column.type === "boolean") return false;
  if (column.type === "number" || /amount|rate|count|days|hours|year/i.test(field)) return /year/i.test(field) ? 2026 : 1;
  if (column.type === "date") return "2026-01-05T00:00:00.000Z";
  if (column.type === "json") return {};
  if (column.type === "array") return [];
  if (/date|^start$|^end$/i.test(field)) return "2026-01-05";
  if (column.sqlType === "uuid") return context.uuid;
  return ((context.marker ?? "fictional") + " " + field).slice(0, column.length ?? 160);
}

export function proposeFixture(table, context, overrides = {}) {
  const values = {}, unresolved = [];
  const columns = new Map(table.columns.map(c => [c.key, c]));
  for (const key of Object.keys(overrides)) {
    if (!columns.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw Error("UNKNOWN_FIXTURE_COLUMN");
  }
  const references = new Map();
  for (const fk of table.foreignKeys) fk.columns.forEach((key, index) => references.set(key, fk.table + "." + fk.refColumns[index]));
  for (const col of table.columns) {
    if (col.generated) continue;
    const ref = references.get(col.key);
    let value = overrides[col.key] ?? (ref ? context.references?.[ref] : undefined);
    const scoped = Object.hasOwn(knownContext, col.key) ? context[knownContext[col.key]] : undefined;
    if (scoped !== undefined && value !== undefined && value !== scoped) {
      unresolved.push({ field: col.key, reason: "context-reference-conflict" }); continue;
    }
    if (value === undefined && !ref && (col.required || Object.hasOwn(knownContext, col.key))) value = fictionalValue(col.key, col, context);
    if (value !== undefined) values[col.key] = value;
    else if (col.required) unresolved.push({ field: col.key, reason: ref ? "foreign-key" : "unsupported-value", ...(ref ? { reference: ref } : {}) });
  }
  return { table: table.symbol, values, unresolved, checksNeedingReview: table.checks, uniqueConstraints: table.uniqueConstraints };
}

function walk(node, fn) { fn(node); ts.forEachChild(node, child => walk(child, fn)); }
function literal(node) { return node && (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : undefined; }

/** TypeScript AST, scoped to the selected exported handler. Never imports a route. */
export function inspectWriteHandler(source, method) {
  const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw Error("ROUTE_AST_INVALID");
  let handler;
  for (const node of file.statements) {
    if (!node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(node) && node.name?.text === method) handler = node;
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) {
      if (d.name.getText(file) === method && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) handler = d.initializer;
    }
  }
  if (!handler?.body) return { supported: false, fields: [], tables: [], flags: [], actions: [], reason: "delegated-or-unresolved-handler" };
  const imports = new Map();
  for (const node of file.statements) if (ts.isImportDeclaration(node) && /(?:@\/db\/schema|db\/schema)$/.test(node.moduleSpecifier.text)) {
    for (const item of node.importClause?.namedBindings?.elements ?? []) imports.set(item.name.text, item.propertyName?.text ?? item.name.text);
  }
  const bodies = new Set(), fields = new Map(), aliases = new Map(), tables = new Set(), flags = new Set(), actions = new Set();
  let multipart = false;
  const requestNames = new Set(handler.parameters.filter(p => ts.isIdentifier(p.name)).map(p => p.name.text));
  walk(handler.body, node => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    walk(node.initializer, child => {
      if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)
        && requestNames.has(child.expression.expression.getText(file))) {
        if (child.expression.name.text === "json") bodies.add(node.name.text);
        if (child.expression.name.text === "formData") multipart = true;
      }
    });
  });
  function fieldAccess(node) {
    if (ts.isPropertyAccessExpression(node) && bodies.has(node.expression.getText(file))) return node.name.text;
    if (ts.isElementAccessExpression(node) && bodies.has(node.expression.getText(file))) return literal(node.argumentExpression);
    return undefined;
  }
  walk(handler.body, node => {
    const field = fieldAccess(node);
    if (field && !["__proto__", "prototype", "constructor"].includes(field)) {
      const entry = fields.get(field) ?? { name: field, type: "unknown", defaults: [] };
      let parent = node.parent;
      for (let depth = 0; parent && depth < 4; parent = parent.parent, depth++) {
        if (ts.isCallExpression(parent) && ["Number", "String", "Boolean"].includes(parent.expression.getText(file))) entry.type = parent.expression.getText(file).toLowerCase();
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          const value = literal(parent.right); if (value !== undefined && value !== "" && !entry.defaults.includes(value)) entry.defaults.push(value);
        }
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) aliases.set(parent.name.text, field);
      }
      fields.set(field, entry);
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && bodies.has(node.initializer.getText(file))) {
      for (const item of node.name.elements) { const key = (item.propertyName ?? item.name).getText(file); fields.set(key, { name: key, type: "unknown", defaults: [] }); aliases.set(item.name.getText(file), key); }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["insert", "update", "delete"].includes(node.expression.name.text)) {
      const symbol = imports.get(node.arguments[0]?.getText(file)); if (symbol) tables.add(symbol);
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) {
      if ((fieldAccess(node.left) ?? aliases.get(node.left.getText(file))) === "action" && literal(node.right)) actions.add(literal(node.right));
    }
  });
  walk(file, node => { if (ts.isPropertyAccessExpression(node) && node.expression.getText(file) === "process.env" && /_ENABLED$/.test(node.name.text)) flags.add(node.name.text); });
  return { supported: true, fields: [...fields.values()].sort((a,b) => a.name.localeCompare(b.name)), tables: [...tables], flags: [...flags].sort(), actions: [...actions].sort(), multipart };
}

export function proposeBody(handler, table, context) {
  const columns = new Map((table?.columns ?? []).map(c => [c.key, c]));
  const body = {}, unresolved = [];
  for (const field of handler.fields) {
    if (field.name === "action") body.action = field.defaults[0] ?? handler.actions[0];
    else body[field.name] = fictionalValue(field.name, columns.get(field.name) ?? { type: field.type }, context);
    if (body[field.name] === undefined) { delete body[field.name]; unresolved.push(field.name); }
  }
  return { body, unresolved };
}

// Deliberately bounded execution surface. Everything is still inventoried.
export function probeEligibility(route, method, handler) {
  if (!handler.supported || handler.multipart) return "unsupported-handler-or-multipart";
  if (!/^(?:(?:discipline|delegations|dynamic-worker-groups|documents|performance)(?:\/|$)|hcm\/(?:engagement-surveys|employment-terms|employment-term-decisions|effective-changes|lifecycle-policy)(?:\/|$))/.test(route)) return "manual-review";
  if (handler.tables.length !== 1 || !handler.fields.length) return "ambiguous-write-target-or-body";
  const actions = [...handler.actions, ...handler.fields.filter(f => f.name === "action").flatMap(f => f.defaults)];
  if (actions.some(a => /release|approve|send|sync|pay|settle|invite|execute|activate/i.test(a))) return "manual-review-action";
  if (!WRITE_METHODS.includes(method)) return "unsupported-method";
  return null;
}

export function buildWritePlan(manifest, readSource, tables) {
  const rows = [];
  for (const [file, route] of Object.entries(manifest.allApiRouteFiles)) {
    if (!/^src\/app\/api\/[a-zA-Z0-9_./\[\]-]+\/route\.ts$/.test(file) || file.includes("..")) throw Error("INVALID_ROUTE_SOURCE_PATH");
    if (route.route !== file.slice("src/app/api/".length, -"/route.ts".length)) throw Error("ROUTE_SOURCE_MISMATCH");
    for (const entry of route.methods) {
      if (entry.status !== "GAP" || !WRITE_METHODS.includes(entry.name)) continue;
      const handler = inspectWriteHandler(readSource(file), entry.name);
      const table = tables[handler.tables[0]];
      const context = { marker: "fictional-preview", uuid: "00000000-0000-4000-8000-000000000001" };
      rows.push({ key: entry.name + " " + route.route, method: entry.name, route: route.route, source: file,
        handler, fixture: table ? proposeFixture(table, context) : null,
        proposal: proposeBody(handler, table, context),
        executionHold: probeEligibility(route.route, entry.name, handler),
        coverageCredits: 0 });
    }
  }
  return { kind: "tenant-write-discovery-plan", schemaVersion: 1, coverageCredits: 0,
    writes: rows.sort((a,b) => a.key.localeCompare(b.key)) };
}
