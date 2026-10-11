#!/usr/bin/env node
/**
 * Conservative, read-only source inventory of request/runtime SQL DDL and
 * opportunistic schema/data backfills. No database or network connection.
 *
 * A guarded finding means only that an early read-only exit is visible in
 * source. It is NOT proof that runtime DDL is retired or production safe.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DDL = /\b(?:CREATE\s+(?:(?:OR\s+REPLACE|UNIQUE|TEMP(?:ORARY)?|UNLOGGED)\s+)*(?:TABLE|INDEX|SCHEMA|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TRIGGER|TYPE|EXTENSION|POLICY)|ALTER\s+(?:TABLE|INDEX|SCHEMA|TYPE|FUNCTION)|DROP\s+(?:TABLE|INDEX|SCHEMA|VIEW|FUNCTION|TRIGGER|TYPE)|TRUNCATE\s+(?:TABLE\s+)?)\b/i;
const BACKFILL = /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_][\w.]*\s+SET|DELETE\s+FROM)\b/i;
const LIFECYCLE = /^(?:ensure|migrate|bootstrap|repair|upgrade|initialize|sync|backfill|seed)(?:[A-Z_]|$)/;
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs']);

function listSources(root) {
  const files = [];
  function visit(directory) {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const child of children) {
      if (child.isSymbolicLink()) throw new Error('Refusing symlinked source: ' + join(directory, child.name));
      const path = join(directory, child.name);
      if (child.isDirectory()) {
        if (!['node_modules', '.next', '.git', 'generated', '__fixtures__'].includes(child.name)) visit(path);
      } else if (child.isFile() && EXTENSIONS.has(extname(path)) && !/\.d\.ts$/.test(path)) {
        files.push(path);
      }
    }
  }
  visit(root);
  return files;
}

function sqlText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans
    .map(span => '?DYNAMIC?' + span.literal.text).join('');
  if (ts.isTaggedTemplateExpression(node)) return sqlText(node.template);
  if (ts.isParenthesizedExpression(node)) return sqlText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = sqlText(node.left), right = sqlText(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  // A common form used in legacy migration helpers: ["CREATE ...", "ALTER ..."].join(";")
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'join' && ts.isArrayLiteralExpression(node.expression.expression)) {
    const parts = node.expression.expression.elements.map(sqlText);
    const separator = node.arguments[0] ? sqlText(node.arguments[0]) : ',';
    return parts.every(part => part !== null) && separator !== null
      ? parts.join(separator) : null;
  }
  return null;
}

function isQueryCall(node) {
  if (!ts.isCallExpression(node) || !node.arguments.length) return false;
  if (ts.isPropertyAccessExpression(node.expression)) {
    return ['query', 'execute', 'unsafe', 'exec', 'run'].includes(node.expression.name.text);
  }
  return false;
}

function isSqlTag(node) {
  if (!ts.isTaggedTemplateExpression(node)) return false;
  const name = node.tag.getText().replace(/\s+/g, '');
  return /(?:^|\.)sql$/.test(name);
}

function namedFunction(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name?.getText() ?? null;
  }
  if (ts.isVariableDeclaration(node) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return node.name.getText();
  }
  return null;
}

function containsReturn(node) {
  if (ts.isReturnStatement(node)) return true;
  // A nested callback's return must not count as the enclosing function's exit.
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, containsReturn) || false;
}

function classifyGuard(functionNode, sourceFile, firstMutation) {
  if (!functionNode) return { state: 'unguarded', evidence: 'no named enclosing function' };
  let body = functionNode.body;
  if (ts.isVariableDeclaration(functionNode)) body = functionNode.initializer?.body;
  if (!body || !ts.isBlock(body)) {
    return { state: 'unguarded', evidence: 'no inspectable function body' };
  }
  const source = body.getText(sourceFile);
  if (!source.includes('CORE_SCHEMA_COMPATIBILITY_MODE') ||
      !source.includes('coreSchemaCompatibilityMode')) {
    return { state: 'unguarded', evidence: 'no strict core compatibility-mode parser' };
  }
  const parserAt = source.indexOf('coreSchemaCompatibilityMode(');
  if (parserAt === -1) return { state: 'unguarded', evidence: 'compatibility parser is not called' };
  for (const stmt of body.statements) {
    if (!ts.isIfStatement(stmt) || stmt.getStart(sourceFile) >= firstMutation) continue;
    if (body.getStart(sourceFile) + parserAt > stmt.getStart(sourceFile)) continue;
    const condition = stmt.expression.getText(sourceFile).replace(/\s+/g, '');
    if (!/mode===['"]read-only['"]/.test(condition) &&
        !/['"]read-only['"]===mode/.test(condition)) continue;
    if (!containsReturn(stmt.thenStatement)) continue;
    // We only claim a source-level early exit, not the completeness of
    // structural verification or the identity of the DB connection.
    return {
      state: 'early-readonly-exit',
      evidence: /verify\w+SchemaReadOnly/.test(stmt.thenStatement.getText(sourceFile))
        ? 'early read-only catalog branch with return'
        : 'early read-only branch with return; nested writes still require review',
    };
  }
  return { state: 'unguarded', evidence: 'no early read-only exit before mutation' };
}

/** Scan a single TS/JS source file without evaluating code or connecting to DB. */
export function auditSource(source, file = 'src/unknown.ts') {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) {
    throw new Error(`Cannot parse ${file}; source audit must fail closed`);
  }
  const found = [];
  const seen = new Set();

  function record(owner, node, text, type) {
    const key = node.getStart(sf) + ':' + type;
    if (seen.has(key)) return;
    seen.add(key);
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({
      file, line: pos.line + 1, column: pos.character + 1,
      owner: owner?.name ?? '(module)', type,
      statement: (text ?? 'non-literal SQL expression').replace(/\s+/g, ' ').trim().slice(0, 130),
      nodePos: node.getStart(sf), ownerNode: owner?.node ?? null,
    });
  }

  function walk(node, currentOwner = null) {
    const fn = namedFunction(node);
    const owner = fn ? { name: fn, node, start: node.getStart(sf) } : currentOwner;
    if (isQueryCall(node)) {
      const arg = node.arguments[0];
      const literal = sqlText(arg);
      const lifecycle = Boolean(owner && LIFECYCLE.test(owner.name));
      if (literal !== null && DDL.test(literal)) record(owner, arg, literal, 'DDL');
      else if (literal !== null && lifecycle && BACKFILL.test(literal)) {
        record(owner, arg, literal, 'IMPLICIT_BACKFILL');
      } else if (literal === null && lifecycle) {
        record(owner, arg, null, 'DYNAMIC_QUERY_REVIEW');
      }
    }
    if (isSqlTag(node) && !(ts.isCallExpression(node.parent) && isQueryCall(node.parent) && node.parent.arguments[0] === node)) {
      // A SQL tagged template may be passed through a variable or to execute;
      // record even when it is not the first argument of a known query method.
      const literal = sqlText(node);
      const lifecycle = Boolean(owner && LIFECYCLE.test(owner.name));
      if (literal !== null && DDL.test(literal)) record(owner, node, literal, 'DDL');
      else if (literal !== null && lifecycle && BACKFILL.test(literal)) {
        record(owner, node, literal, 'IMPLICIT_BACKFILL');
      }
    }
    ts.forEachChild(node, child => walk(child, owner));
  }
  walk(sf);
  return found.map(({ nodePos, ownerNode, ...item }) => ({
    ...item, ...classifyGuard(ownerNode, sf, nodePos),
  }));
}

export function auditDirectory(root, base = process.cwd()) {
  const files = listSources(root);
  const findings = files.flatMap(file => auditSource(readFileSync(file, 'utf8'),
    relative(base, file).replace(/\\/g, '/')));
  return {
    kind: 'runtime-schema-source-inventory',
    sourceOnly: true,
    databaseConnected: false,
    productionReleaseApproved: false,
    filesScanned: files.length,
    findings,
    unguarded: findings.filter(x => x.state === 'unguarded').length,
    earlyReadOnlyExit: findings.filter(x => x.state === 'early-readonly-exit').length,
    warning: 'Static early-exit checks do not prove all runtime paths or migration safety.',
  };
}

const launched = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launched) {
  const strict = process.argv.includes('--strict');
  const argumentsWithoutFlags = process.argv.slice(2).filter(x => x !== '--strict');
  if (argumentsWithoutFlags.length > 1) {
    console.error('Usage: node scripts/audit-runtime-schema-writers.mjs [--strict] [src]');
    process.exitCode = 2;
  } else {
    const src = resolve(argumentsWithoutFlags[0] ?? 'src');
    try {
      const audit = auditDirectory(src, process.cwd());
      console.log(JSON.stringify(audit, null, 2));
      if (strict && audit.unguarded) process.exitCode = 1;
    } catch (error) {
      console.error('Runtime schema source audit could not complete: ' + error.message);
      process.exitCode = 2;
    }
  }
}
