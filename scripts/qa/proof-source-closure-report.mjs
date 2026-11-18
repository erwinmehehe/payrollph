#!/usr/bin/env node
/**
 * READ-ONLY evidence tool. Grants no credit, changes no manifest and is NOT a guard.
 *
 * Answers: "which API routes reach a given source file through local imports, and through which chain?"
 * It uses the same resolution rules as tests/wage-order-transitive-import-inventory.test.mjs
 * (TypeScript AST; @/ and relative specifiers; index files; non-type-only import/export/require/import()).
 * It additionally records type-only edges separately, because the sealed 668-file receipt closure
 * (scripts/qa/payroll-run-renewal-inputs.mjs, ts.preProcessFile) does not distinguish them.
 *
 *   node scripts/qa/proof-source-closure-report.mjs [--targets a.ts,b.ts] [--routes route1,route2] [--json]
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import ts from "typescript";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const RECEIPT = "scripts/qa/wage-registry-renewal-receipt.json";
const EXT = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1].split(",") : fallback;
};
const DEFAULT_TARGETS = [
  "src/lib/wage-orders.ts", "src/lib/statutory-rule-watch.ts",
  "src/lib/payroll-engine.ts", "src/lib/payroll-money.ts",
  "src/lib/payroll-assurance.ts", "src/lib/payroll-finding-explanations.ts",
  "src/db/seed.ts",
];
const targets = opt("--targets", DEFAULT_TARGETS);

const norm = (p) => normalize(p).replaceAll("\\", "/");
const filesIn = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = norm(join(dir, e.name));
  return e.isDirectory() ? filesIn(p)
    : EXT.includes(extname(p)) && !p.endsWith(".d.ts") && !p.endsWith(".d.mts") ? [p] : [];
});
const exists = new Set(filesIn("src"));
const unresolved = [], dynamicSpecifiers = [];
function resolveLocal(file, spec) {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;
  const stem = spec.startsWith("@/") ? "src/" + spec.slice(2) : norm(join(dirname(file), spec));
  const found = [stem, ...EXT.map((e) => stem + e), ...EXT.map((e) => stem + "/index" + e)].find((p) => exists.has(p));
  if (!found) unresolved.push({ file, spec });
  return found ?? null;
}
const edgeCache = new Map();
/** Returns { runtime: string[], typeOnly: string[] } (typeOnly = reachable ONLY through erased imports). */
function edges(file) {
  if (edgeCache.has(file)) return edgeCache.get(file);
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const runtime = new Set(), typeOnly = new Set();
  const add = (node, isType) => {
    if (!node || !ts.isStringLiteralLike(node)) { dynamicSpecifiers.push(file); return; }
    const target = resolveLocal(file, node.text);
    if (target) (isType ? typeOnly : runtime).add(target);
  };
  const walk = (node) => {
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause;
      const onlyType = c?.isTypeOnly || (c?.namedBindings && ts.isNamedImports(c.namedBindings) && !c.name &&
        c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly));
      add(node.moduleSpecifier, Boolean(onlyType));
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier, Boolean(node.isTypeOnly));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, false);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node.arguments[0], false);
    }
    ts.forEachChild(node, walk);
  };
  walk(ast);
  for (const t of runtime) typeOnly.delete(t);
  const result = { runtime: [...runtime], typeOnly: [...typeOnly] };
  edgeCache.set(file, result);
  return result;
}
/** Shortest import chain; includeTypeOnly=false follows only runtime edges. */
function chainTo(start, goal, includeTypeOnly) {
  const queue = [[start]], seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const chain = queue[i], file = chain[chain.length - 1];
    if (file === goal) return chain;
    const e = edges(file);
    for (const next of includeTypeOnly ? [...e.runtime, ...e.typeOnly] : e.runtime) {
      if (!seen.has(next)) { seen.add(next); queue.push([...chain, next]); }
    }
  }
  return null;
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const receipt = JSON.parse(readFileSync(RECEIPT, "utf8"));
const routes = Object.entries(manifest.allApiRouteFiles);
const methodCount = (rec, pred = () => true) => rec.methods.filter(pred).length;
const report = { routesInManifest: routes.length, methodsInManifest: routes.reduce((n, [, r]) => n + r.methods.length, 0), targets: {} };

for (const target of targets) {
  const row = {
    inReceiptPins: Object.hasOwn(receipt.sourcePins, target),
    routesRuntime: 0, methodsRuntime: 0, routesViaTypeOnlyOnly: 0, methodsViaTypeOnlyOnly: 0,
    statusOfRuntimeMethods: {}, sampleChains: [],
  };
  for (const [route, rec] of routes) {
    const runtime = chainTo(route, target, false);
    const withTypes = runtime ?? chainTo(route, target, true);
    if (runtime) {
      row.routesRuntime++; row.methodsRuntime += rec.methods.length;
      for (const m of rec.methods) row.statusOfRuntimeMethods[m.status] = (row.statusOfRuntimeMethods[m.status] ?? 0) + 1;
      if (row.sampleChains.length < 3) row.sampleChains.push(runtime);
    } else if (withTypes) {
      row.routesViaTypeOnlyOnly++; row.methodsViaTypeOnlyOnly += rec.methods.length;
    }
  }
  report.targets[target] = row;
}
const wanted = opt("--routes", []);
report.routeChains = Object.fromEntries(wanted.map((route) => [route, Object.fromEntries(targets.map((t) => [t, chainTo(route, t, false) ?? chainTo(route, t, true)]))]));
report.unresolvedInternalImports = unresolved.length;
report.nonLiteralDynamicImportFiles = [...new Set(dynamicSpecifiers)].length;

// --held: score the methods that carry a reviewedUncertified hold against each changed-source group.
if (args.includes("--held")) {
  const GROUPS = {
    "#1989 wage data (wage-orders, statutory-rule-watch)": ["src/lib/wage-orders.ts", "src/lib/statutory-rule-watch.ts"],
    "#2006 payroll calculation (engine, money, assurance, finding-explanations)": ["src/lib/payroll-engine.ts", "src/lib/payroll-money.ts", "src/lib/payroll-assurance.ts", "src/lib/payroll-finding-explanations.ts"],
  };
  const heldKinds = {};
  const held = routes.flatMap(([route, rec]) => rec.methods
    .filter((m) => m.status === "GAP" && m.reviewedUncertified?.kind)
    .map((m) => ({ route, verb: m.name, kind: m.reviewedUncertified.kind })));
  for (const h of held) heldKinds[h.kind] = (heldKinds[h.kind] ?? 0) + 1;
  report.held = { total: held.length, byKind: heldKinds, perGroup: {} };
  const wageKinds = (k) => k.startsWith("wage-registry-");
  for (const [label, files] of Object.entries(GROUPS)) {
    const reach = (h) => files.some((f) => chainTo(h.route, f, false));
    const wage = held.filter((h) => wageKinds(h.kind));
    const reached = wage.filter(reach);
    report.held.perGroup[label] = {
      wageRegistryHeldMethods: wage.length, reachedByRuntimeImport: reached.length, notReached: wage.length - reached.length,
      notReachedByKind: Object.fromEntries(Object.entries(wage.filter((h) => !reach(h)).reduce((a, h) => ({ ...a, [h.kind]: (a[h.kind] ?? 0) + 1 }), {}))),
    };
  }
  const allGroupFiles = Object.values(GROUPS).flat();
  const wageHeld = held.filter((h) => wageKinds(h.kind));
  report.held.wageHeldReachingNoChangedFile = wageHeld.filter((h) => !allGroupFiles.some((f) => chainTo(h.route, f, false))).length;
}

if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`manifest: ${report.routesInManifest} route files, ${report.methodsInManifest} methods; unresolved internal imports: ${report.unresolvedInternalImports}; files with non-literal dynamic import/require: ${report.nonLiteralDynamicImportFiles}`);
  for (const [t, r] of Object.entries(report.targets)) {
    console.log(`\n${t}\n  in sealed receipt pins: ${r.inReceiptPins}\n  reached by runtime imports: ${r.routesRuntime} routes / ${r.methodsRuntime} methods ${JSON.stringify(r.statusOfRuntimeMethods)}\n  reached ONLY through type-only imports: ${r.routesViaTypeOnlyOnly} routes / ${r.methodsViaTypeOnlyOnly} methods`);
    for (const c of r.sampleChains) console.log("  e.g. " + c.join(" -> "));
  }
  if (report.held) console.log("\nHELD METHODS\n" + JSON.stringify(report.held, null, 2));
}
