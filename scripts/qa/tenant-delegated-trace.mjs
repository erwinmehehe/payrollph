/**
 * Read-only source call-chain tracer for the 34 flagged client-supplied-ID
 * routes. Traces local route helpers and imported @/lib helpers to depth 3.
 * Structural signal is NOT security approval; HTTP/PG evidence is separate.
 */
import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
export const FLAGGED = manifest.sourceTraceCandidates;
export const GATE_TOKENS = new Set([
  "assertMembership", "assertOrganizationRole", "assertOrganizationUnitAccess",
  "assertScope", "getAccess", "resolveMultiEntityContext", "authorizeExtendedV1Read",
]);
const PUBLIC = {
  "src/app/api/careers/route.ts":
    "Public published vacancy listing and consented applicant intake, not authenticated employer administration; prove published-only and other-tenant requisition filtering.",
  "src/app/api/webhooks/paymongo/transfers/route.ts":
    "Provider-origin signed webhook boundary, not employee-session authentication; require valid HMAC plus tenant-bound provider lookup and replay check.",
};
const sourceCache = new Map();
function sourceAt(path) {
  if (sourceCache.has(path)) return sourceCache.get(path);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map();
  const functions = new Map();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const modulePath = stmt.moduleSpecifier.text;
      if (!modulePath.startsWith("@/")) continue;
      const base = "src/" + modulePath.slice(2);
      const destination = [base + ".ts", base + ".tsx", base + "/index.ts"].find((p) => existsSync(p));
      if (!destination) continue;
      const named = stmt.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          imports.set(element.name.text, { file: destination,
            symbol: element.propertyName?.text ?? element.name.text });
        }
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      functions.set(stmt.name.text, stmt);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          functions.set(decl.name.text, decl.initializer);
        }
      }
    }
  }
  const data = { text, sf, imports, functions };
  sourceCache.set(path, data);
  return data;
}
function calls(node) {
  const names = new Set();
  function walk(n) {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
        names.add(e.name.text);
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return [...names];
}
function trace(path, symbol, remaining, seen = new Set()) {
  const key = path + ":" + symbol;
  if (seen.has(key) || remaining < 0) return [];
  seen.add(key);
  const info = sourceAt(path);
  if (!info) return [];
  const node = info.functions.get(symbol);
  if (!node) return [];
  const result = [];
  const called = calls(node);
  for (const name of called) {
    if (GATE_TOKENS.has(name)) {
      const line = info.sf.getLineAndCharacterOfPosition(node.pos).line + 1;
      result.push({ path, function: symbol, calls: name, functionStartLine: line,
        provenance: info.imports.get(name)?.file ?? path });
    }
    if (info.functions.has(name) && name !== symbol) {
      result.push(...trace(path, name, remaining - 1, seen));
    }
    const imported = info.imports.get(name);
    if (imported && remaining > 0 && !GATE_TOKENS.has(name)) {
      result.push(...trace(imported.file, imported.symbol, remaining - 1, seen));
    }
  }
  return result;
}
function routeMethods(info) {
  const methods = new Map();
  for (const [key, node] of info.functions.entries()) {
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(key)) continue;
    const stmt = info.sf.statements.find((s) => s === node);
    if (!stmt || !ts.isFunctionDeclaration(stmt) ||
      !stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    methods.set(key, node);
  }
  return methods;
}

/**
 * Conservative call-graph check: direct SQL/database calls inside an HTTP
 * handler plus local and @/lib delegation. A discovered gate is a structural
 * indicator ONLY. No static check can certify branch-sensitive authorization.
 */
export function inspectRouteHandler(path, method) {
  const root = sourceAt(path);
  const declaration = root?.functions.get(method);
  if (!declaration) return null;
  const seen = new Set(), databasePaths = [], gatePaths = [];
  function walk(file, name, remaining, chain) {
    const key = file + "::" + name;
    if (seen.has(key) || remaining < 0) return;
    seen.add(key);
    const parsed = sourceAt(file);
    const node = parsed?.functions.get(name);
    if (!node) return;
    const txt = node.getText(parsed.sf);
    if (/\b(?:db|tx|executor|transaction)\s*\.\s*(?:select|insert|update|delete|execute|transaction)\s*\(|\.from\s*\(/.test(txt)) {
      databasePaths.push([...chain, file + ":" + name].join(" -> "));
    }
    for (const called of calls(node)) {
      if (GATE_TOKENS.has(called)) {
        gatePaths.push([...chain, file + ":" + name + " -> " + called].join(" -> "));
      }
      if (remaining > 0 && parsed.functions.has(called) && called !== name) {
        walk(file, called, remaining - 1, [...chain, file + ":" + name]);
      }
      if (remaining > 0 && parsed.imports.has(called) && !GATE_TOKENS.has(called)) {
        const imported = parsed.imports.get(called);
        walk(imported.file, imported.symbol, remaining - 1,
          [...chain, file + ":" + name]);
      }
    }
  }
  walk(path, method, 2, []);
  return { path, method, accessesDatabase: databasePaths.length > 0,
    databasePaths: databasePaths.slice(0, 8),
    structuralAccessGuards: [...new Set(gatePaths)].slice(0, 12),
    needsHttpProof: true };
}

export function traceFlaggedSource() {
  if (!Array.isArray(FLAGGED) || FLAGGED.length !== 34) {
    throw new Error("The 34-source trace list changed: explicit triage required.");
  }
  return FLAGGED.map((candidate) => {
    const info = sourceAt(candidate.file);
    if (!info) throw new Error("Flagged route missing: " + candidate.file);
    const methods = routeMethods(info);
    const declaration = manifest.allApiRouteFiles[candidate.file];
    if (!declaration || !declaration.methods.every((m) => methods.has(m.name))) {
      throw new Error("Flagged methods missing from source: " + candidate.file);
    }
    const paths = [];
    for (const [name] of methods) {
      const findings = trace(candidate.file, name, 3);
      paths.push({ method: name, gates: findings,
        sourceGatePresent: findings.length > 0,
        status: declaration.methods.find((m) => m.name === name)?.status,
        requiresRealHttp: true });
    }
    return {
      file: candidate.file, suspiciousSourceLines: candidate.lines,
      publicBoundaryReason: PUBLIC[candidate.file] ?? null,
      structuralStatus: PUBLIC[candidate.file] ? "PUBLIC_OR_SIGNED_BOUNDARY_TO_VERIFY" :
        paths.every((p) => p.sourceGatePresent) ? "DELEGATED_GATE_FOUND_NOT_VERIFIED" :
        "UNRESOLVED_DELEGATED_SCOPE",
      methods: paths,
      actualProofStatus: "NOT_CERTIFIED_BY_SOURCE_TRACE",
    };
  });
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/qa/tenant-delegated-trace.mjs")) {
  const result = traceFlaggedSource();
  const tallies = Object.fromEntries([...new Set(result.map((x) => x.structuralStatus))]
    .map((status) => [status, result.filter((x) => x.structuralStatus === status).length]));
  console.log(JSON.stringify({ flaggedRoutes: result.length, structuralCategories: tallies,
    evidenceRequired: true, routes: result }));
}
