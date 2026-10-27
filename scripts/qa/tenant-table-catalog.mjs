import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { TENANT_TABLE_PROFILES } from "./tenant-table-env.mjs";
import { validateTenantPathBinding } from "./tenant-table-path.mjs";

export const FAMILY_ROOT = new URL("./tenant-table-rows/", import.meta.url);
const nameOf = (property) => property.name?.text ?? property.name?.getText();
const prop = (node, name) => node.properties.find((p) => nameOf(p) === name)?.initializer;

/** Offline source catalog: never imports the application, a database, or a row factory. */
export function tenantFamilyCatalog(kind, root = FAMILY_ROOT) {
  assert.ok(["read", "write"].includes(kind), "unknown tenant table kind");
  const directory = new URL(kind + "/", root);
  const records = [];
  const files = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of files) {
    assert.ok(entry.isFile() && /^[a-z][a-z0-9-]*\.mjs$/.test(entry.name), "unexpected family entry: " + entry.name);
    const url = new URL(entry.name, directory);
    const file = relative(process.cwd(), fileURLToPath(url)).split(sep).join("/");
    const source = readFileSync(url, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0, file + ": invalid JavaScript");
    const factory = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "createRows" &&
      s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    const rows = factory?.body?.statements.find(ts.isReturnStatement)?.expression;
    assert.ok(rows && ts.isArrayLiteralExpression(rows), file + ": createRows must return a literal row array");
    const orderDeclaration = ast.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations])
      .find((d) => d.name.getText(ast) === "fixtureOrder");
    const order = new Map();
    if (orderDeclaration) {
      assert.ok(ts.isObjectLiteralExpression(orderDeclaration.initializer), file + ": fixtureOrder must be literal");
      for (const p of orderDeclaration.initializer.properties) {
        assert.ok(ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && ts.isNumericLiteral(p.initializer), file + ": invalid fixture order");
        assert.ok(!order.has(p.name.text), file + ": duplicate fixture order key");
        const position = Number(p.initializer.text);
        assert.ok(Number.isSafeInteger(position) && position >= 0, file + ": fixture order must be a nonnegative safe integer");
        order.set(p.name.text, position);
      }
    }
    for (const node of rows.elements) {
      assert.ok(ts.isObjectLiteralExpression(node), file + ": rows cannot use spreads or dynamic construction");
      const keyNode = prop(node, "key");
      assert.ok(keyNode && ts.isStringLiteral(keyNode), file + ": method key must be literal");
      const key = keyNode.text;
      assert.match(key, kind === "read" ? /^GET (?:[a-z0-9-]+|\[[A-Za-z][A-Za-z0-9]*\])(?:\/(?:[a-z0-9-]+|\[[A-Za-z][A-Za-z0-9]*\]))*$/ : /^(POST|PATCH|PUT|DELETE) (?:[a-z0-9-]+|\[[A-Za-z][A-Za-z0-9]*\])(?:\/(?:[a-z0-9-]+|\[[A-Za-z][A-Za-z0-9]*\]))*$/, file + ": incorrect method identity");
      const pathNode = prop(node, "pathIds"); let pathIds;
      if (pathNode) {
        assert.ok(ts.isObjectLiteralExpression(pathNode), key + ": path binding must be literal"); pathIds = {};
        for (const field of pathNode.properties) {
          assert.ok(ts.isPropertyAssignment(field) && ts.isStringLiteral(field.initializer), key + ": path field must be literal");
          const name = nameOf(field); assert.ok(!Object.hasOwn(pathIds, name), key + ": duplicate path field"); pathIds[name] = field.initializer.text;
        }
      }
      validateTenantPathBinding(key, pathIds);
      const profileNode = prop(node, "profile");
      assert.ok(!profileNode || ts.isStringLiteral(profileNode), key + ": profile must be literal");
      const profile = profileNode?.text ?? "default";
      assert.ok(Object.hasOwn(TENANT_TABLE_PROFILES, profile), key + ": unknown profile");
      const flagNode = prop(node, "flags");
      assert.ok(!flagNode || ts.isArrayLiteralExpression(flagNode), key + ": flags must be literal");
      const flags = [...(flagNode?.elements ?? [])].map((flag) => {
        assert.ok(ts.isStringLiteral(flag), key + ": flag must be literal");
        assert.equal(TENANT_TABLE_PROFILES[profile][flag.text], "true", key + ": profile does not enable " + flag.text);
        return flag.text;
      });
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      records.push({ key, kind, profile, flags, pathIds, file, url, line, text: node.getText(ast), order: order.get(key) ?? Number.MAX_SAFE_INTEGER });
    }
    for (const key of order.keys()) assert.ok(records.some((r) => r.file === file && r.key === key), file + ": stale fixture order key " + key);
  }
  const keys = new Set(), positions = new Set();
  for (const row of records) {
    assert.ok(!keys.has(row.key), "duplicate tenant method: " + row.key); keys.add(row.key);
    if (row.order !== Number.MAX_SAFE_INTEGER) {
      assert.ok(!positions.has(row.order), "duplicate fixture order: " + row.order); positions.add(row.order);
    }
  }
  return records.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file) || a.line - b.line);
}
